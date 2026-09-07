import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { matchesUserId, type ResolvedAuthIdentity } from "./auth";

export async function resolveCanonicalAudiobookId(
  ctx: QueryCtx | MutationCtx,
  identity: ResolvedAuthIdentity,
  audiobookId: Id<"audiobooks">,
): Promise<Id<"audiobooks">> {
  const original = await ctx.db.get(audiobookId);
  if (original?.recordingId) {
    const recording = await ctx.db.get(original.recordingId);
    if (recording && matchesUserId(recording.userId, identity)) return recording._id;
  }
  const path: Id<"audiobooks">[] = [];
  let current = audiobookId;
  while (!path.includes(current)) {
    path.push(current);
    let next: Id<"audiobooks"> | undefined;
    for await (const link of ctx.db.query("audiobookLinks")
      .withIndex("by_linked", (q) => q.eq("linkedId", current))) {
      if (matchesUserId(link.userId, identity)) { next = link.canonicalId; break; }
    }
    if (!next) return current;
    const book = await ctx.db.get(next);
    if (!book || !matchesUserId(book.userId, identity)) return current;
    current = next;
  }
  // Old data may already contain a cycle. Every entry into that cycle must
  // resolve to the same root; new links are flattened by the mutation.
  return path.slice(path.indexOf(current)).sort()[0];
}

export async function getLinkedGroup(
  ctx: QueryCtx | MutationCtx,
  identity: ResolvedAuthIdentity,
  audiobookId: Id<"audiobooks">,
): Promise<Id<"audiobooks">[]> {
  const root = await resolveCanonicalAudiobookId(ctx, identity, audiobookId);
  const group = new Set<Id<"audiobooks">>([root]);
  for (const id of group) {
    for await (const link of ctx.db.query("audiobookLinks")
      .withIndex("by_canonical", (q) => q.eq("canonicalId", id))) {
      if (!matchesUserId(link.userId, identity)) continue;
      const book = await ctx.db.get(link.linkedId);
      if (book && matchesUserId(book.userId, identity)) group.add(link.linkedId);
    }
  }
  return [...group];
}

export async function getLatestGroupPosition(
  ctx: QueryCtx | MutationCtx,
  identity: ResolvedAuthIdentity,
  audiobookId: Id<"audiobooks">,
  scanGroup = false,
) {
  const root = await resolveCanonicalAudiobookId(ctx, identity, audiobookId);
  if (!scanGroup) {
    for await (const position of ctx.db.query("positions").withIndex("by_audiobook", (q) => q.eq("audiobookId", root))) {
      if (position.revision !== undefined && matchesUserId(position.userId, identity)) return position;
    }
  }
  const positions = [];
  for (const id of await getLinkedGroup(ctx, identity, audiobookId)) {
    for await (const position of ctx.db.query("positions")
      .withIndex("by_audiobook", (q) => q.eq("audiobookId", id))) {
      if (matchesUserId(position.userId, identity)) positions.push(position);
    }
  }
  return positions.sort((a, b) => (b.revision === undefined ? 0 : 1) - (a.revision === undefined ? 0 : 1) || b.updatedAt - a.updatedAt)[0] ?? null;
}
