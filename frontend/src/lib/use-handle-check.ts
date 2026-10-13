"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/v2";
import { handleError } from "@/lib/onboarding";

// Format check runs instantly; availability is asked of the API after typing pauses.
export function useHandleCheck(input: string, enabled: boolean) {
  const clean = input.trim().replace(/^@+/, "");
  const [debounced, setDebounced] = useState(clean);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(clean), 350);
    return () => clearTimeout(timer);
  }, [clean]);
  const availability = useQuery({
    queryKey: ["handle-available", debounced],
    queryFn: () => api.handles.available(debounced),
    enabled: enabled && !handleError(debounced),
    staleTime: 30_000,
  });
  const formatError = enabled ? handleError(clean) : null;
  const taken = availability.data && !availability.data.available ? (availability.data.reason ?? "that handle is taken") : null;
  return {
    clean,
    error: clean ? (formatError ?? taken) : null,
    available: Boolean(clean && debounced === clean && availability.data?.available),
  };
}
