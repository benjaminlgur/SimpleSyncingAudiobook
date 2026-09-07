import { createContext, createElement, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useMutation, useQuery, useConvexConnectionState, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference, OptionalRestArgs } from "convex/server";

/** Local scope is independent of cloud authorization. Never queue writes under
 * an unverified account and replay them after an account switch. */
export const CloudContext = createContext<{ ready: boolean; canSync: () => boolean }>({ ready: true, canSync: () => true });

/** The application owns this capability so background services observe changes
 * even after the screen that created their push adapter has unmounted. */
export function CloudProvider({ ready, children }: { ready: boolean; children: ReactNode }) {
  const connection = useConvexConnectionState();
  const allowed = ready && connection.isWebSocketConnected;
  const current = useRef(allowed);
  current.current = allowed;
  useEffect(() => { current.current = allowed; return () => { current.current = false; }; }, [allowed]);
  const canSync = useCallback(() => current.current, []);
  return createElement(CloudContext.Provider, { value: { ready: allowed, canSync } }, children);
}

export function useCloudQuery<Q extends FunctionReference<"query">>(query: Q, ...args: OptionalRestArgsOrSkip<Q>) {
  const { ready } = useContext(CloudContext);
  return useQuery(query, ...(ready ? args : ["skip"]) as OptionalRestArgsOrSkip<Q>);
}

export function useCloudMutation<M extends FunctionReference<"mutation">>(reference: M) {
  const mutation = useMutation(reference);
  const access = useContext(CloudContext);
  return useCallback((...args: OptionalRestArgs<M>) => {
    if (!access.canSync()) return Promise.reject(new Error("Local progress saved. Sign in or reconnect to sync."));
    return mutation(...args);
  }, [mutation, access.canSync]);
}
