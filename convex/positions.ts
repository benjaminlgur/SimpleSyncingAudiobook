import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

const positionReturnValidator = v.object({
  _id: v.id("positions"),
  _creationTime: v.number(),
  audiobookId: v.id("audiobooks"),
  chapterIndex: v.number(),
  positionMs: v.number(),
  updatedAt: v.number(),
});

async function resolveCanonicalId(
  ctx: QueryCtx,
  audiobookId: Id<"audiobooks">
): Promise<Id<"audiobooks">> {
  const asLinked = await ctx.db
    .query("audiobookLinks")
    .withIndex("by_linked", (q) => q.eq("linkedId", audiobookId))
    .unique();
  return asLinked ? asLinked.canonicalId : audiobookId;
}

export const get = query({
  args: { audiobookId: v.id("audiobooks") },
  returns: v.union(positionReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const canonicalId = await resolveCanonicalId(ctx, args.audiobookId);
    return await ctx.db
      .query("positions")
      .withIndex("by_audiobook", (q) => q.eq("audiobookId", canonicalId))
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
    const canonicalId = await resolveCanonicalId(ctx, args.audiobookId);

    const existing = await ctx.db
      .query("positions")
      .withIndex("by_audiobook", (q) => q.eq("audiobookId", canonicalId))
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
      audiobookId: canonicalId,
      chapterIndex: args.chapterIndex,
      positionMs: args.positionMs,
      updatedAt: now,
    });
  },
});
