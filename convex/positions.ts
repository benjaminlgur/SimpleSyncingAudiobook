import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  assertOwnership,
  resolveAuthIdentity,
} from "./lib/auth";
import { checkRateLimit } from "./lib/limits";
import { resolveCanonicalAudiobookId, getLatestGroupPosition, getLinkedGroup } from "./lib/audiobookLinks";


const positionReturnValidator = v.object({
  _id: v.id("positions"),
  _creationTime: v.number(),
  audiobookId: v.id("audiobooks"),
  chapterIndex: v.number(),
  positionMs: v.number(),
  updatedAt: v.number(),
  userId: v.optional(v.string()),
  revision: v.optional(v.number()),
  operationId: v.optional(v.string()),
  sessionId: v.optional(v.string()),
});

export const get = query({
  args: { audiobookId: v.id("audiobooks") },
  returns: v.union(positionReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);

    const book = await ctx.db.get(args.audiobookId);
    await assertOwnership(ctx, book);

    if (!book) return null;
    const position = await getLatestGroupPosition(ctx, identity, args.audiobookId);
    return position ? { ...position, revision: position.revision ?? 0 } : null;
  },
});

export const history = query({
  args: { audiobookId: v.id("audiobooks") },
  returns: v.array(v.object({ chapterIndex: v.number(), positionMs: v.number(), updatedAt: v.number(), revision: v.number() })),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);
    const book = await ctx.db.get(args.audiobookId);
    await assertOwnership(ctx, book);
    if (!book) return [];
    const root = await resolveCanonicalAudiobookId(ctx, identity, args.audiobookId);
    const rows = await ctx.db.query("positionHistory")
      .withIndex("by_userId_and_audiobookId", (q) => q.eq("userId", identity.userId).eq("audiobookId", root)).order("desc").take(20);
    return rows.map(({ chapterIndex, positionMs, updatedAt, revision }) => ({ chapterIndex, positionMs, updatedAt, revision }));
  },
});

export const update = mutation({
  args: {
    audiobookId: v.id("audiobooks"),
    chapterIndex: v.number(),
    positionMs: v.number(),
    clientUpdatedAt: v.number(),
    baseRevision: v.optional(v.number()),
    operationId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
  },
  returns: v.object({
    positionId: v.id("positions"),
    accepted: v.boolean(),
    revision: v.optional(v.number()),
    serverPosition: v.union(
      v.object({
        chapterIndex: v.number(),
        positionMs: v.number(),
        updatedAt: v.number(),
        revision: v.optional(v.number()),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.chapterIndex) || args.chapterIndex < 0 ||
        !Number.isFinite(args.positionMs) || args.positionMs < 0 ||
        !Number.isFinite(args.clientUpdatedAt)) throw new Error("Invalid playback position");
    const versioned = args.baseRevision !== undefined;
    if (versioned && (!Number.isSafeInteger(args.baseRevision) || args.baseRevision! < 0 ||
        !args.operationId || args.operationId.length > 200 || !args.sessionId || args.sessionId.length > 200)) throw new Error("Invalid sync revision or session");
    const identity = await resolveAuthIdentity(ctx);
    const userId = identity.userId;
    await checkRateLimit(ctx, "positionUpdate", userId);

    const book = await ctx.db.get(args.audiobookId);
    await assertOwnership(ctx, book);

    if (!book) throw new Error("Audiobook not found");
    const canonicalId = await resolveCanonicalAudiobookId(ctx, identity, args.audiobookId);
    const existing = await getLatestGroupPosition(ctx, identity, args.audiobookId);

    if (!versioned && existing?.revision !== undefined) throw new Error("Upgrade all devices to version 1.0 to sync this recording");
    if (versioned && existing?.operationId === args.operationId) {
      return { positionId: existing._id, accepted: true, revision: existing.revision, serverPosition: null };
    }
    if (existing && (versioned ? (existing.revision ?? 0) !== args.baseRevision : existing.updatedAt > args.clientUpdatedAt)) {
      return {
        positionId: existing._id, accepted: false, revision: existing.revision ?? 0,
        serverPosition: { chapterIndex: existing.chapterIndex, positionMs: existing.positionMs, updatedAt: existing.updatedAt, revision: existing.revision ?? 0 },
      };
    }
    // Missing server progress is a new lineage; do not reuse a deleted revision.
    if (!existing && versioned && args.baseRevision !== 0) throw new Error("Server progress was removed; reconnect this recording before syncing");
    if (versioned && book.recordingId === undefined) {
      for (const member of await getLinkedGroup(ctx, identity, args.audiobookId)) await ctx.db.patch(member, { recordingId: canonicalId });
    }
    const revision = versioned ? (existing?.revision ?? 0) + 1 : undefined;
    const protocol = versioned ? { revision, operationId: args.operationId, sessionId: args.sessionId } : {};
    const updatedAt = versioned ? Date.now() : args.clientUpdatedAt;
    if (existing && versioned) {
      await ctx.db.insert("positionHistory", {
        audiobookId: canonicalId, userId, chapterIndex: existing.chapterIndex,
        positionMs: existing.positionMs, updatedAt: existing.updatedAt,
        revision: existing.revision ?? 0, sessionId: existing.sessionId,
      });
      const history = await ctx.db.query("positionHistory")
        .withIndex("by_userId_and_audiobookId", (q) => q.eq("userId", userId).eq("audiobookId", canonicalId)).order("desc").take(21);
      for (const row of history.slice(20)) await ctx.db.delete(row._id);
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        audiobookId: canonicalId,
        userId,
        chapterIndex: args.chapterIndex,
        positionMs: args.positionMs,
        updatedAt,
        ...protocol,
      });
      return { positionId: existing._id, accepted: true, revision, serverPosition: null };
    }

    const id = await ctx.db.insert("positions", {
      audiobookId: canonicalId,
      chapterIndex: args.chapterIndex,
      positionMs: args.positionMs,
      updatedAt,
        ...protocol,
      userId,
    });
    return { positionId: id, accepted: true, revision, serverPosition: null };
  },
});
