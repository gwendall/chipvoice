"use client";
import { useSyncExternalStore } from "react";
import { EMPTY_SESSION, sessionSnapshot, subscribeSession, type SessionView } from "./session-cache";
export type SessionState = SessionView["status"];
/** All consumers share one request and the same cached presentation state. */
export function useSession() {
  return useSyncExternalStore(subscribeSession, sessionSnapshot, () => EMPTY_SESSION);
}
