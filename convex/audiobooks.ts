import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertOwnership,
  matchesUserId,
  resolveAuthIdentity,
  type ResolvedAuthIdentity,
} from "./lib/auth";
import {
  checkRateLimit,
  checkAudiobookCap,
  checkDeviceCap,
} from "./lib/limits";

const chapterValidator = v.object({
  index: v.number(),
  filename: v.string(),
  title: v.optional(v.string()),
  durationMs: v.optional(v.number()),
  startMs: v.optional(v.number()),
  endMs: v.optional(v.number()),
});

const audiobookReturnValidator = v.object({
  _id: v.id("audiobooks"),
  _creationTime: v.number(),
  name: v.string(),
  checksum: v.string(),
  chapters: v.array(chapterValidator),
  userId: v.optional(v.string()),
});

const platformValidator = v.union(v.literal("mobile"), v.literal("desktop"));

async function deleteAudiobookCascade(
  ctx: MutationCtx,
  audiobookId: Id<"audiobooks">,
) {
  const linksAsCanonical = await ctx.db
    .query("audiobookLinks")
    .withIndex("by_canonical", (q) => q.eq("canonicalId", audiobookId))
    .collect();
  for (const link of linksAsCanonical) {
    await ctx.db.delete(link._id);
  }

  const linksAsLinked = await ctx.db
    .query("audiobookLinks")
    .withIndex("by_linked", (q) => q.eq("linkedId", audiobookId))
    .collect();
  for (const link of linksAsLinked) {
    await ctx.db.delete(link._id);
  }

  const positions = await ctx.db
    .query("positions")
    .withIndex("by_audiobook", (q) => q.eq("audiobookId", audiobookId))
    .collect();
  for (const pos of positions) {
    await ctx.db.delete(pos._id);
  }

  const deviceCopies = await ctx.db
    .query("audiobookDeviceCopies")
    .withIndex("by_audiobook", (q) => q.eq("audiobookId", audiobookId))
    .collect();
  for (const copy of deviceCopies) {
    await ctx.db.delete(copy._id);
  }

  const audiobook = await ctx.db.get(audiobookId);
  if (audiobook) {
    await ctx.db.delete(audiobookId);
  }
}

function mergeOwnedDocs<T extends { _id: string }>(docs: T[]): T[] {
  const merged = new Map<string, T>();
  for (const doc of docs) {
    merged.set(doc._id, doc);
  }
  return [...merged.values()];
}

async function listLegacyAudiobooks(
  ctx: QueryCtx | MutationCtx,
  identity: ResolvedAuthIdentity,
): Promise<Doc<"audiobooks">[]> {
  const docs: Doc<"audiobooks">[] = [];

  for (const legacyUserId of identity.exactUserIds) {
    if (legacyUserId === identity.userId) continue;
    const rows = await ctx.db
      .query("audiobooks")
      .withIndex("by_user", (q) => q.eq("userId", legacyUserId))
      .collect();
    for (const row of rows) {
      if (matchesUserId(row.userId, identity)) {
        docs.push(row);
      }
    }
  }

  for (const prefix of identity.legacyUserPrefixes) {
    const rows = await ctx.db
      .query("audiobooks")
      .withIndex("by_user", (q) =>
        q.gte("userId", prefix).lt("userId", `${prefix}\uffff`),
      )
      .collect();
    for (const row of rows) {
      if (matchesUserId(row.userId, identity)) {
        docs.push(row);
      }
    }
  }

  return mergeOwnedDocs(docs);
}

async function listLegacyDeviceCopies(
  ctx: QueryCtx | MutationCtx,
  identity: ResolvedAuthIdentity,
): Promise<Doc<"audiobookDeviceCopies">[]> {
  const docs: Doc<"audiobookDeviceCopies">[] = [];

  for (const legacyUserId of identity.exactUserIds) {
    if (legacyUserId === identity.userId) continue;
    const rows = await ctx.db
      .query("audiobookDeviceCopies")
      .withIndex("by_user", (q) => q.eq("userId", legacyUserId))
      .collect();
    for (const row of rows) {
      if (matchesUserId(row.userId, identity)) {
        docs.push(row);
      }
    }
  }

  for (const prefix of identity.legacyUserPrefixes) {
    const rows = await ctx.db
      .query("audiobookDeviceCopies")
      .withIndex("by_user", (q) =>
        q.gte("userId", prefix).lt("userId", `${prefix}\uffff`),
      )
      .collect();
    for (const row of rows) {
      if (matchesUserId(row.userId, identity)) {
        docs.push(row);
      }
    }
  }

  return mergeOwnedDocs(docs);
}

async function listOwnedAudiobooks(
  ctx: QueryCtx | MutationCtx,
  identity: ResolvedAuthIdentity,
) {
  const current = await ctx.db
    .query("audiobooks")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  const legacy = await listLegacyAudiobooks(ctx, identity);
  return mergeOwnedDocs([...current, ...legacy]);
}

async function listOwnedDeviceCopies(
  ctx: QueryCtx | MutationCtx,
  identity: ResolvedAuthIdentity,
) {
  const current = await ctx.db
    .query("audiobookDeviceCopies")
    .withIndex("by_user", (q) => q.eq("userId", identity.userId))
    .collect();
  const legacy = await listLegacyDeviceCopies(ctx, identity);
  return mergeOwnedDocs([...current, ...legacy]);
}

async function findOwnedDeviceCopies(
  ctx: MutationCtx,
  identity: ResolvedAuthIdentity,
  audiobookId: Id<"audiobooks">,
  deviceId: string,
) {
  const copies = await ctx.db
    .query("audiobookDeviceCopies")
    .withIndex("by_audiobook_device", (q) =>
      q.eq("audiobookId", audiobookId).eq("deviceId", deviceId),
    )
    .collect();
  return copies.filter((copy) => matchesUserId(copy.userId, identity));
}

async function findOwnedLinksByLinkedId(
  ctx: QueryCtx | MutationCtx,
  identity: ResolvedAuthIdentity,
  linkedId: Id<"audiobooks">,
) {
  const links = await ctx.db
    .query("audiobookLinks")
    .withIndex("by_linked", (q) => q.eq("linkedId", linkedId))
    .collect();
  return links.filter((link) => matchesUserId(link.userId, identity));
}

async function findOwnedLinksByCanonicalId(
  ctx: QueryCtx | MutationCtx,
  identity: ResolvedAuthIdentity,
  canonicalId: Id<"audiobooks">,
) {
  const links = await ctx.db
    .query("audiobookLinks")
    .withIndex("by_canonical", (q) => q.eq("canonicalId", canonicalId))
    .collect();
  return links.filter((link) => matchesUserId(link.userId, identity));
}

async function resolveCanonicalAudiobookId(
  ctx: QueryCtx | MutationCtx,
  identity: ResolvedAuthIdentity,
  audiobookId: Id<"audiobooks">,
): Promise<Id<"audiobooks">> {
  const ownedLink = (await findOwnedLinksByLinkedId(ctx, identity, audiobookId))[0];
  return ownedLink ? ownedLink.canonicalId : audiobookId;
}

export const getOrCreate = mutation({
  args: {
    name: v.string(),
    checksum: v.string(),
    chapters: v.array(chapterValidator),
  },
  returns: v.object({
    audiobookId: v.id("audiobooks"),
    isNew: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);
    const userId = identity.userId;
    await checkRateLimit(ctx, "getOrCreate", userId);

    const existing = await ctx.db
      .query("audiobooks")
      .withIndex("by_user_and_name_checksum", (q) =>
        q.eq("userId", userId).eq("name", args.name).eq("checksum", args.checksum),
      )
      .unique();

    if (existing) {
      return { audiobookId: existing._id, isNew: false };
    }

    const legacyExisting = (await listOwnedAudiobooks(ctx, identity)).find(
      (book) => book.name === args.name && book.checksum === args.checksum,
    );
    if (legacyExisting) {
      if (legacyExisting.userId !== userId) {
        await ctx.db.patch(legacyExisting._id, { userId });
      }
      return { audiobookId: legacyExisting._id, isNew: false };
    }

    await checkAudiobookCap(ctx, userId);

    const id = await ctx.db.insert("audiobooks", {
      name: args.name,
      checksum: args.checksum,
      chapters: args.chapters,
      userId,
    });

    return { audiobookId: id, isNew: true };
  },
});

export const list = query({
  args: {},
  returns: v.array(audiobookReturnValidator),
  handler: async (ctx) => {
    const identity = await resolveAuthIdentity(ctx);
    return await listOwnedAudiobooks(ctx, identity);
  },
});

export const listRemoteForDevice = query({
  args: {
    deviceId: v.string(),
    refreshToken: v.optional(v.number()),
  },
  returns: v.array(audiobookReturnValidator),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);
    const allUserCopies = await listOwnedDeviceCopies(ctx, identity);
    const localCopies = allUserCopies.filter(
      (row) => row.deviceId === args.deviceId,
    );
    const localCanonicalIds = new Set<Id<"audiobooks">>();
    for (const copy of localCopies) {
      localCanonicalIds.add(
        await resolveCanonicalAudiobookId(ctx, identity, copy.audiobookId),
      );
    }

    const remoteCanonicalIds = new Set<Id<"audiobooks">>();
    for (const copy of allUserCopies) {
      const canonicalId = await resolveCanonicalAudiobookId(
        ctx,
        identity,
        copy.audiobookId,
      );
      if (localCanonicalIds.has(canonicalId)) continue;
      remoteCanonicalIds.add(canonicalId);
    }

    const books = [];
    for (const audiobookId of remoteCanonicalIds) {
      const book = await ctx.db.get(audiobookId);
      if (book) books.push(book);
    }
    return books;
  },
});

export const get = query({
  args: { id: v.id("audiobooks") },
  returns: v.union(audiobookReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    try {
      await assertOwnership(ctx, doc);
    } catch {
      return null;
    }
    return doc;
  },
});

export const findByName = query({
  args: { name: v.string() },
  returns: v.array(audiobookReturnValidator),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);
    return (await listOwnedAudiobooks(ctx, identity)).filter(
      (book) => book.name === args.name,
    );
  },
});

export const link = mutation({
  args: {
    canonicalId: v.id("audiobooks"),
    linkedId: v.id("audiobooks"),
  },
  returns: v.id("audiobookLinks"),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);
    const userId = identity.userId;
    await checkRateLimit(ctx, "linkUnlink", userId);

    const canonical = await ctx.db.get(args.canonicalId);
    await assertOwnership(ctx, canonical);
    const linked = await ctx.db.get(args.linkedId);
    await assertOwnership(ctx, linked);

    const existing = (await findOwnedLinksByLinkedId(ctx, identity, args.linkedId))[0];

    if (existing) {
      await ctx.db.patch(existing._id, {
        canonicalId: args.canonicalId,
        userId,
      });
      return existing._id;
    }

    return await ctx.db.insert("audiobookLinks", {
      canonicalId: args.canonicalId,
      linkedId: args.linkedId,
      userId,
    });
  },
});

export const unlink = mutation({
  args: {
    audiobookId: v.id("audiobooks"),
    peerId: v.id("audiobooks"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);
    const userId = identity.userId;
    await checkRateLimit(ctx, "linkUnlink", userId);

    const book = await ctx.db.get(args.audiobookId);
    await assertOwnership(ctx, book);
    const peer = await ctx.db.get(args.peerId);
    await assertOwnership(ctx, peer);

    const asLinked = await findOwnedLinksByLinkedId(ctx, identity, args.peerId);
    for (const row of asLinked) {
      if (row.canonicalId === args.audiobookId) {
        await ctx.db.delete(row._id);
        return true;
      }
    }

    const asCanonical = await findOwnedLinksByCanonicalId(
      ctx,
      identity,
      args.peerId,
    );
    for (const row of asCanonical) {
      if (row.linkedId === args.audiobookId) {
        await ctx.db.delete(row._id);
        return true;
      }
    }

    return false;
  },
});

export const getLinked = query({
  args: { audiobookId: v.id("audiobooks") },
  returns: v.array(audiobookReturnValidator),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);

    const book = await ctx.db.get(args.audiobookId);
    await assertOwnership(ctx, book);

    const asCanonical = await findOwnedLinksByCanonicalId(
      ctx,
      identity,
      args.audiobookId,
    );

    const asLinked = await findOwnedLinksByLinkedId(
      ctx,
      identity,
      args.audiobookId,
    );

    const relatedIds: Id<"audiobooks">[] = [];
    for (const l of asCanonical) relatedIds.push(l.linkedId);
    for (const l of asLinked) relatedIds.push(l.canonicalId);

    const seen = new Set<string>();
    const results = [];
    for (const id of relatedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const related = await ctx.db.get(id);
      if (related) results.push(related);
    }
    return results;
  },
});

export const remove = mutation({
  args: { id: v.id("audiobooks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const book = await ctx.db.get(args.id);
    await assertOwnership(ctx, book);
    await deleteAudiobookCascade(ctx, args.id);
    return null;
  },
});

export const registerOnDevice = mutation({
  args: {
    audiobookId: v.id("audiobooks"),
    deviceId: v.string(),
    platform: platformValidator,
  },
  returns: v.id("audiobookDeviceCopies"),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);
    const userId = identity.userId;
    await checkRateLimit(ctx, "registerOnDevice", userId);

    const book = await ctx.db.get(args.audiobookId);
    await assertOwnership(ctx, book);
    await checkDeviceCap(ctx, userId, args.deviceId);

    const existing = (await findOwnedDeviceCopies(
      ctx,
      identity,
      args.audiobookId,
      args.deviceId,
    ))[0];

    if (existing) {
      await ctx.db.patch(existing._id, {
        platform: args.platform,
        updatedAt: Date.now(),
        userId,
      });
      return existing._id;
    }

    return await ctx.db.insert("audiobookDeviceCopies", {
      audiobookId: args.audiobookId,
      deviceId: args.deviceId,
      platform: args.platform,
      updatedAt: Date.now(),
      userId,
    });
  },
});

export const removeFromDevice = mutation({
  args: {
    audiobookId: v.id("audiobooks"),
    deviceId: v.string(),
  },
  returns: v.object({
    removedFromDevice: v.boolean(),
    deletedAudiobook: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);

    const book = await ctx.db.get(args.audiobookId);
    await assertOwnership(ctx, book);

    const existing = await findOwnedDeviceCopies(
      ctx,
      identity,
      args.audiobookId,
      args.deviceId,
    );

    let removedFromDevice = false;
    for (const copy of existing) {
      await ctx.db.delete(copy._id);
      removedFromDevice = true;
    }

    const remainingCopies = await ctx.db
      .query("audiobookDeviceCopies")
      .withIndex("by_audiobook", (q) => q.eq("audiobookId", args.audiobookId))
      .take(1);

    if (remainingCopies.length === 0) {
      await deleteAudiobookCascade(ctx, args.audiobookId);
      return {
        removedFromDevice,
        deletedAudiobook: true,
      };
    }

    return {
      removedFromDevice,
      deletedAudiobook: false,
    };
  },
});
