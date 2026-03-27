import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const positionReturnValidator = v.object({
  _id: v.id("positions"),
  _creationTime: v.number(),
  audiobookId: v.id("audiobooks"),
  chapterIndex: v.number(),
  positionMs: v.number(),
  updatedAt: v.number(),
});

export const get = query({
  args: { audiobookId: v.id("audiobooks") },
  returns: v.union(positionReturnValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("positions")
      .withIndex("by_audiobook", (q) => q.eq("audiobookId", args.audiobookId))
      .unique();
  },
});

export const update = mutation({
  args: {
    audiobookId: v.id("audiobooks"),
    chapterIndex: v.number(),
    positionMs: v.number(),
  },
  returns: v.id("positions"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("positions")
      .withIndex("by_audiobook", (q) => q.eq("audiobookId", args.audiobookId))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        chapterIndex: args.chapterIndex,
        positionMs: args.positionMs,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("positions", {
      audiobookId: args.audiobookId,
      chapterIndex: args.chapterIndex,
      positionMs: args.positionMs,
      updatedAt: now,
    });
  },
});
