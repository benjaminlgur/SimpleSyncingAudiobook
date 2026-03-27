import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const chapterValidator = v.object({
  index: v.number(),
  filename: v.string(),
  durationMs: v.optional(v.number()),
});

const audiobookReturnValidator = v.object({
  _id: v.id("audiobooks"),
  _creationTime: v.number(),
  name: v.string(),
  checksum: v.string(),
  chapters: v.array(chapterValidator),
});

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
    const linksAsCanonical = await ctx.db
      .query("audiobookLinks")
      .withIndex("by_canonical", (q) => q.eq("canonicalId", args.id))
      .collect();
    for (const link of linksAsCanonical) {
      await ctx.db.delete(link._id);
    }

    const linksAsLinked = await ctx.db
      .query("audiobookLinks")
      .withIndex("by_linked", (q) => q.eq("linkedId", args.id))
      .collect();
    for (const link of linksAsLinked) {
      await ctx.db.delete(link._id);
    }

    const positions = await ctx.db
      .query("positions")
      .withIndex("by_audiobook", (q) => q.eq("audiobookId", args.id))
      .collect();
    for (const pos of positions) {
      await ctx.db.delete(pos._id);
    }

    await ctx.db.delete(args.id);
    return null;
  },
});
