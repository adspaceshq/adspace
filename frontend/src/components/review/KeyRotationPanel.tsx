"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api/v2";
import { queryKeys } from "@/lib/query";
import { userErrorMessage } from "@/lib/errors";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Admin-only. After the multisig rotates the review authority to a new reviewer key (and the server runs
// with it), live listings still name the former key as their rent payer: it keeps the power to close
// them and co-sign spots, proof and disputes, and the server can't close them. adopt_listing moves each
// one to the current key. Safe to run again; listings already moved are skipped.
export function KeyRotationPanel() {
  const queryClient = useQueryClient();
  const adopt = useMutation({
    mutationFn: () => api.admin.adoptListings(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminRent }),
  });
  const report = adopt.data;
  const alreadyCurrent = report?.skipped.filter((item) => item.reason === "already on the current key").length ?? 0;
  const notOnChain = (report?.skipped.length ?? 0) - alreadyCurrent;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-body font-semibold">
            <KeyRound aria-hidden className="size-4" /> key rotation
          </p>
          <p className="text-small text-muted">
            after rotating the reviewer key, adopt listings: every live listing still recorded to the former key moves to the current one, so the old key loses
            its power over them and their rent comes back to the new key.
          </p>
        </div>
        <Button variant="secondary" onClick={() => adopt.mutate()} loading={adopt.isPending}>
          adopt listings
        </Button>
      </div>
      <ol className="flex list-decimal flex-col gap-1 rounded-card bg-canvas py-3 pl-8 pr-3 text-small text-muted">
        <li>the multisig sets the review authority to the new key</li>
        <li>the server is restarted with the new reviewer key</li>
        <li>adopt listings here (run it again until nothing is left)</li>
      </ol>
      {adopt.isError && <p className="text-small text-danger">{userErrorMessage(adopt.error)}</p>}
      {report && (
        <div className="flex flex-col gap-2 text-small" aria-live="polite">
          <p className="flex flex-wrap items-center gap-2 text-muted">
            current key <Address value={report.reviewer} chars={6} />
          </p>
          <p>
            <span className="font-medium text-success">{report.adopted.length} adopted</span>
            <span className="text-muted">
              {" "}
              · {alreadyCurrent} already on the current key{notOnChain > 0 ? ` · ${notOnChain} not on-chain` : ""}
            </span>
            {report.failed.length > 0 && <span className="font-medium text-danger"> · {report.failed.length} failed</span>}
          </p>
          {report.adopted.length > 0 && (
            <ul className="flex flex-col gap-1">
              {report.adopted.map((item) => (
                <li key={item.listingId} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate">{item.title}</span>
                  <span className="text-caption text-subtle">from</span>
                  <Address value={item.previousRentPayer} chars={4} className="text-muted" />
                  <Address value={item.signature} kind="tx" chars={4} className="text-muted" />
                </li>
              ))}
            </ul>
          )}
          {report.failed.length > 0 && (
            <ul className="flex flex-col gap-1">
              {report.failed.map((item) => (
                <li key={item.listingId} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate">{item.title}</span>
                  <span className="text-danger">{userErrorMessage(new Error(item.error), "failed")}</span>
                </li>
              ))}
            </ul>
          )}
          {report.failed.length > 0 && <p className="text-muted">run it again to retry the failed ones.</p>}
        </div>
      )}
    </Card>
  );
}
