import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  audiobooks: defineTable({
    name: v.string(),
    checksum: v.string(),
    recordingId: v.optional(v.id("audiobooks")),
    chapters: v.array(
      v.object({
        index: v.number(),
        filename: v.string(),
        title: v.optional(v.string()),
        durationMs: v.optional(v.number()),
        startMs: v.optional(v.number()),
        endMs: v.optional(v.number()),
      })
    ),
    userId: v.optional(v.string()),
  })
    .index("by_name", ["name"])
    .index("by_checksum", ["checksum"])
    .index("by_userId_and_checksum", ["userId", "checksum"])
    .index("by_name_checksum", ["name", "checksum"])
    .index("by_user", ["userId"])
    .index("by_user_and_name", ["userId", "name"])
    .index("by_user_and_name_checksum", ["userId", "name", "checksum"]),

  positions: defineTable({
    audiobookId: v.id("audiobooks"),
    chapterIndex: v.number(),
    positionMs: v.number(),
    updatedAt: v.number(),
    revision: v.optional(v.number()),
    operationId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    userId: v.optional(v.string()),
  })
    .index("by_audiobook", ["audiobookId"])
    .index("by_user_and_audiobook", ["userId", "audiobookId"]),

  positionHistory: defineTable({
    audiobookId: v.id("audiobooks"),
    userId: v.string(),
    chapterIndex: v.number(),
    positionMs: v.number(),
    updatedAt: v.number(),
    revision: v.number(),
    sessionId: v.optional(v.string()),
  }).index("by_userId_and_audiobookId", ["userId", "audiobookId"]),

  audiobookLinks: defineTable({
    canonicalId: v.id("audiobooks"),
    linkedId: v.id("audiobooks"),
    userId: v.optional(v.string()),
  })
    .index("by_linked", ["linkedId"])
    .index("by_canonical", ["canonicalId"])
    .index("by_user_and_linked", ["userId", "linkedId"])
    .index("by_user_and_canonical", ["userId", "canonicalId"]),

  audiobookDeviceCopies: defineTable({
    audiobookId: v.id("audiobooks"),
    deviceId: v.string(),
    platform: v.union(v.literal("mobile"), v.literal("desktop")),
    updatedAt: v.number(),
    userId: v.optional(v.string()),
  })
    .index("by_audiobook", ["audiobookId"])
    .index("by_device", ["deviceId"])
    .index("by_audiobook_device", ["audiobookId", "deviceId"])
    .index("by_user", ["userId"])
    .index("by_user_and_device", ["userId", "deviceId"])
    .index("by_user_and_audiobook_device", ["userId", "audiobookId", "deviceId"]),
});
