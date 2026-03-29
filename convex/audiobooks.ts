import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

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
});

const platformValidator = v.union(v.literal("mobile"), v.literal("desktop"));

async function deleteAudiobookCascade(
  ctx: MutationCtx,
  audiobookId: Id<"audiobooks">
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
    const existing = await ctx.db
      .query("audiobooks")
      .withIndex("by_name_checksum", (q) =>
        q.eq("name", args.name).eq("checksum", args.checksum)
      )
      .unique();

    if (existing) {
      return { audiobookId: existing._id, isNew: false };
    }

    const id = await ctx.db.insert("audiobooks", {
      name: args.name,
      checksum: args.checksum,
      chapters: args.chapters,
    });

    return { audiobookId: id, isNew: true };
  },
});

export const list = query({
  args: {},
  returns: v.array(audiobookReturnValidator),
  handler: async (ctx) => {
    return await ctx.db.query("audiobooks").collect();
  },
});

export const listRemoteForDevice = query({
  args: {
    deviceId: v.string(),
    refreshToken: v.optional(v.number()),
  },
  returns: v.array(audiobookReturnValidator),
  handler: async (ctx, args) => {
    const localCopies = await ctx.db
      .query("audiobookDeviceCopies")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .collect();
    const localAudiobookIds = new Set(localCopies.map((row) => row.audiobookId));

    const allCopies = await ctx.db.query("audiobookDeviceCopies").collect();
    const remoteAudiobookIds = new Set<Id<"audiobooks">>();
    for (const copy of allCopies) {
      if (localAudiobookIds.has(copy.audiobookId)) continue;
      remoteAudiobookIds.add(copy.audiobookId);
    }

    const books = [];
    for (const audiobookId of remoteAudiobookIds) {
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
    return await ctx.db.get(args.id);
  },
});

export const findByName = query({
  args: { name: v.string() },
  returns: v.array(audiobookReturnValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("audiobooks")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .collect();
  },
});

export const link = mutation({
  args: {
    canonicalId: v.id("audiobooks"),
    linkedId: v.id("audiobooks"),
  },
  returns: v.id("audiobookLinks"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("audiobookLinks")
      .withIndex("by_linked", (q) => q.eq("linkedId", args.linkedId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        canonicalId: args.canonicalId,
      });
      return existing._id;
    }

    return await ctx.db.insert("audiobookLinks", {
      canonicalId: args.canonicalId,
      linkedId: args.linkedId,
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
    // The link row could have either ordering, so check both directions
    const asLinked = await ctx.db
      .query("audiobookLinks")
      .withIndex("by_linked", (q) => q.eq("linkedId", args.peerId))
      .collect();
    for (const row of asLinked) {
      if (row.canonicalId === args.audiobookId) {
        await ctx.db.delete(row._id);
        return true;
      }
    }

    const asCanonical = await ctx.db
      .query("audiobookLinks")
      .withIndex("by_canonical", (q) => q.eq("canonicalId", args.peerId))
      .collect();
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
    const asCanonical = await ctx.db
      .query("audiobookLinks")
      .withIndex("by_canonical", (q) => q.eq("canonicalId", args.audiobookId))
      .collect();

    const asLinked = await ctx.db
      .query("audiobookLinks")
      .withIndex("by_linked", (q) => q.eq("linkedId", args.audiobookId))
      .collect();

    const relatedIds: Id<"audiobooks">[] = [];
    for (const l of asCanonical) relatedIds.push(l.linkedId);
    for (const l of asLinked) relatedIds.push(l.canonicalId);

    const seen = new Set<string>();
    const results = [];
    for (const id of relatedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const book = await ctx.db.get(id);
      if (book) results.push(book);
    }
    return results;
  },
});

export const remove = mutation({
  args: { id: v.id("audiobooks") },
  returns: v.null(),
  handler: async (ctx, args) => {
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
    const existing = await ctx.db
      .query("audiobookDeviceCopies")
      .withIndex("by_audiobook_device", (q) =>
        q.eq("audiobookId", args.audiobookId).eq("deviceId", args.deviceId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        platform: args.platform,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("audiobookDeviceCopies", {
      audiobookId: args.audiobookId,
      deviceId: args.deviceId,
      platform: args.platform,
      updatedAt: Date.now(),
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
    const existing = await ctx.db
      .query("audiobookDeviceCopies")
      .withIndex("by_audiobook_device", (q) =>
        q.eq("audiobookId", args.audiobookId).eq("deviceId", args.deviceId)
      )
      .unique();

    let removedFromDevice = false;
    if (existing) {
      await ctx.db.delete(existing._id);
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
