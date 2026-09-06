import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  assertOwnership,
  resolveAuthIdentity,
} from "./lib/auth";
import { checkRateLimit } from "./lib/limits";
import { resolveCanonicalAudiobookId, getLatestGroupPosition } from "./lib/audiobookLinks";


const positionReturnValidator = v.object({
  _id: v.id("positions"),
  _creationTime: v.number(),
  audiobookId: v.id("audiobooks"),
  chapterIndex: v.number(),
  positionMs: v.number(),
  updatedAt: v.number(),
  userId: v.optional(v.string()),
});

export const get = query({
  args: { audiobookId: v.id("audiobooks") },
  returns: v.union(positionReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);

    const book = await ctx.db.get(args.audiobookId);
    await assertOwnership(ctx, book);

    return await getLatestGroupPosition(ctx, identity, args.audiobookId);
  },
});

export const update = mutation({
  args: {
    audiobookId: v.id("audiobooks"),
    chapterIndex: v.number(),
    positionMs: v.number(),
    clientUpdatedAt: v.number(),
  },
  returns: v.object({
    positionId: v.id("positions"),
    accepted: v.boolean(),
    serverPosition: v.union(
      v.object({
        chapterIndex: v.number(),
        positionMs: v.number(),
        updatedAt: v.number(),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx, args) => {
    const identity = await resolveAuthIdentity(ctx);
    const userId = identity.userId;
    await checkRateLimit(ctx, "positionUpdate", userId);

    const book = await ctx.db.get(args.audiobookId);
    await assertOwnership(ctx, book);

    if (!book) throw new Error("Audiobook not found");
    const canonicalId = await resolveCanonicalAudiobookId(ctx, identity, args.audiobookId);
    const existing = await getLatestGroupPosition(ctx, identity, args.audiobookId);

    if (existing && existing.updatedAt > args.clientUpdatedAt) {
      return {
        positionId: existing._id,
        accepted: false,
        serverPosition: {
          chapterIndex: existing.chapterIndex,
          positionMs: existing.positionMs,
          updatedAt: existing.updatedAt,
        },
      };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        audiobookId: canonicalId,
        userId,
        chapterIndex: args.chapterIndex,
        positionMs: args.positionMs,
        updatedAt: args.clientUpdatedAt,
      });
      return { positionId: existing._id, accepted: true, serverPosition: null };
    }

    const id = await ctx.db.insert("positions", {
      audiobookId: canonicalId,
      chapterIndex: args.chapterIndex,
      positionMs: args.positionMs,
      updatedAt: args.clientUpdatedAt,
      userId,
    });
    return { positionId: id, accepted: true, serverPosition: null };
  },
});
