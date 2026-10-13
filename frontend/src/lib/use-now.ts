"use client";

import { useEffect, useState } from "react";

// A clock that re-renders on an interval, so time-based UI (deadlines, availability) stays pure and current.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
