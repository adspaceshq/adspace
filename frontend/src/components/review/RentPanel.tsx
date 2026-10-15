"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api/v2";
import type { RentReport } from "@/lib/api/types";
import { queryKeys } from "@/lib/query";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";

type Target = { kind: "spot" | "listing"; id: string; label: string };
type LogEntry = Target & { signature?: string; error?: string };

const sol = (lamports: number) => `${(lamports / 1e9).toFixed(4)} SOL`;
const spotLabel = (spot: RentReport["spots"][number]) => `${spot.listingTitle} · spot ${spot.index + 1}`;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "close failed");

// Admin-only: the platform paid rent for every listing and spot account, so admins close unsold
// spots past their deadline and finished listings to get it back.
export function RentPanel() {
  const queryClient = useQueryClient();
  const rent = useQuery({ queryKey: queryKeys.adminRent, queryFn: () => api.admin.rent() });
  const [log, setLog] = useState<LogEntry[]>([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const [progress, setProgress] = useState<{ done: number; current: string } | null>(null);

  const record = (entry: LogEntry) => setLog((entries) => [entry, ...entries].slice(0, 20));
  const runClose = async (target: Target) => {
    const result = target.kind === "spot" ? await api.admin.closeSpot(target.id) : await api.admin.closeListing(target.id);
    record({ ...target, signature: result.signature });
  };
  const close = useMutation({
    mutationFn: runClose,
    onError: (error, target) => record({ ...target, error: errorMessage(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminRent }),
  });

  // Spots first, then refetch so listings whose spots just closed show up; stops on the first error.
  const fresh = () => queryClient.fetchQuery({ queryKey: queryKeys.adminRent, queryFn: () => api.admin.rent(), staleTime: 0 });
  const closeAll = async () => {
    setConfirmAll(false);
    let done = 0;
    const step = async (target: Target) => {
      setProgress({ done, current: target.label });
      try {
        await runClose(target);
        done += 1;
        return true;
      } catch (error) {
        record({ ...target, error: errorMessage(error) });
        return false;
      }
    };
    try {
      for (const spot of (await fresh()).spots) {
        if (!(await step({ kind: "spot", id: spot.id, label: spotLabel(spot) }))) return;
      }
      for (const listing of (await fresh()).listings) {
        if (!(await step({ kind: "listing", id: listing.id, label: listing.title }))) return;
      }
    } catch (error) {
      record({ kind: "listing", id: "report", label: "rent report", error: errorMessage(error) });
    } finally {
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminRent });
    }
  };

  const busy = close.isPending || progress !== null;
  const pendingId = close.isPending ? close.variables?.id : undefined;
  const data = rent.data;
  const empty = data && data.spots.length === 0 && data.listings.length === 0;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-body font-semibold">rent</p>
          <p className="text-small text-muted">close unsold spots past their deadline and finished listings. rent goes back to the platform.</p>
        </div>
        {data && !empty && (
          <Button variant="secondary" onClick={() => setConfirmAll(true)} loading={progress !== null} disabled={busy}>
            close all
          </Button>
        )}
      </div>

      {rent.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : rent.isError ? (
        <p className="text-small text-danger">{rent.error.message}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="reclaimable" value={sol(rent.data.reclaimableLamports)} />
            <Stat label="spots" value={rent.data.spots.length} />
            <Stat label="listings" value={rent.data.listings.length} />
          </div>

          {progress && (
            <p className="text-small text-muted" aria-live="polite">
              closed {progress.done} · now closing {progress.current}
            </p>
          )}

          {empty ? (
            <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-small text-muted">nothing to reclaim</p>
          ) : (
            <>
              {rent.data.spots.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-small font-medium">spots</p>
                  <ul className="divide-y divide-line rounded-card border border-line">
                    {rent.data.spots.map((spot) => (
                      <li key={spot.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-small">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {spot.listingTitle} · spot {spot.index + 1}
                          </p>
                          <p className="truncate text-caption text-muted">
                            {spot.listingSlug} · past deadline {new Date(spot.deadline).toLocaleDateString()}
                          </p>
                        </div>
                        <span className="font-mono tabular-nums">{sol(spot.lamports)}</span>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={pendingId === spot.id}
                          disabled={busy}
                          onClick={() => close.mutate({ kind: "spot", id: spot.id, label: spotLabel(spot) })}
                        >
                          close
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {rent.data.listings.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-small font-medium">listings</p>
                  <ul className="divide-y divide-line rounded-card border border-line">
                    {rent.data.listings.map((listing) => (
                      <li key={listing.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-small">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{listing.title}</p>
                          <p className="truncate text-caption text-muted">{listing.slug} · every spot finished</p>
                        </div>
                        <span className="font-mono tabular-nums">{sol(listing.lamports)}</span>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={pendingId === listing.id}
                          disabled={busy}
                          onClick={() => close.mutate({ kind: "listing", id: listing.id, label: listing.title })}
                        >
                          close listing
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}

      {log.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-small font-medium">recent</p>
          <ul className="flex flex-col gap-1 text-small">
            {log.map((entry, i) => (
              <li key={`${entry.kind}:${entry.id}:${i}`} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate">{entry.label}</span>
                {entry.signature ? (
                  <Address value={entry.signature} kind="tx" className="text-muted" />
                ) : (
                  <span className="text-danger">{entry.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="close everything?"
        description="closes every spot listed here, then every listing whose spots are all closed. stops on the first error."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmAll(false)}>
              cancel
            </Button>
            <Button onClick={() => void closeAll()}>close all</Button>
          </>
        }
      >
        {data && <p className="text-small text-muted">about {sol(data.reclaimableLamports)} comes back to the platform.</p>}
      </Modal>
    </Card>
  );
}
