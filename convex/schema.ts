import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  audiobooks: defineTable({
    name: v.string(),
    checksum: v.string(),
    chapters: v.array(
      v.object({
        index: v.number(),
        filename: v.string(),
        durationMs: v.optional(v.number()),
      })
    ),
  })
    .index("by_name", ["name"])
    .index("by_checksum", ["checksum"])
    .index("by_name_checksum", ["name", "checksum"]),

  positions: defineTable({
    audiobookId: v.id("audiobooks"),
    chapterIndex: v.number(),
    positionMs: v.number(),
    updatedAt: v.number(),
  }).index("by_audiobook", ["audiobookId"]),

  audiobookLinks: defineTable({
    canonicalId: v.id("audiobooks"),
    linkedId: v.id("audiobooks"),
  })
    .index("by_linked", ["linkedId"])
    .index("by_canonical", ["canonicalId"]),
});
