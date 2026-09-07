import type { QueryCtx } from "../_generated/server";

/** Every public data function must pass this boundary before reading any data. */
export async function checkAccess(ctx: Pick<QueryCtx, "auth">, syncKey?: string) {
  if (process.env.REQUIRE_AUTH === "true") {
    if (!await ctx.auth.getUserIdentity()) throw new Error("Not authenticated");
    return;
  }
  const expected = process.env.SYNC_ACCESS_KEY;
  if (!expected || expected.length < 32) {
    if (process.env.ALLOW_INSECURE_SELF_HOSTED === "true") return;
    throw new Error("Self-hosted sync requires SYNC_ACCESS_KEY (at least 32 characters)");
  }
  const supplied = syncKey ?? "";
  let difference = expected.length ^ supplied.length;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ (supplied.charCodeAt(i) || 0);
  if (difference !== 0) throw new Error("Invalid self-hosted access key");
}
