import { v } from "convex/values";
import { query } from "./_generated/server";
import { checkAccess } from "./lib/access";

export const checkConnection = query({
  args: { syncKey: v.optional(v.string()) },
  returns: v.object({ protocolVersion: v.number() }),
  handler: async (ctx, args) => {
    await checkAccess(ctx, args.syncKey);
    return { protocolVersion: 1 };
  },
});

export const viewerScope = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const [userId] = identity.subject.split("|");
    if (!userId) {
      throw new Error("Unable to determine user scope");
    }

    return userId;
  },
});
