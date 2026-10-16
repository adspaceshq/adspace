"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AlertOctagon, ArrowLeft, CheckCircle2, PauseCircle, PlayCircle } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { SquadsPending } from "@/lib/api/types";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { TeamPanel } from "./TeamPanel";
import { RentPanel } from "./RentPanel";
import { Address } from "@/components/ui/Address";
import { SquadsPendingNote } from "./SquadsPendingNote";
import { GuardianPause } from "./GuardianPause";
import { userErrorMessage } from "@/lib/errors";

type Report = { checkedTxs: number; confirmedTxs: number; failedTxs: number; withdrawalsUpdated: number; disputesResolved?: number; spotDrift: Array<{ spotId: string; dbState: string; chainStatus: string }> };

// Reviewers see protocol state; only admins can change it.
export function OpsPanel() {
  const { session } = useSession();
  const isAdmin = Boolean(session?.isAdmin);
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.adminStatus, queryFn: () => api.admin.status(), refetchInterval: 30_000 });
  const [confirmPause, setConfirmPause] = useState(false);
  const [typed, setTyped] = useState("");
  const [days, setDays] = useState("");
  const [report, setReport] = useState<Report>();
  const [resumeProposal, setResumeProposal] = useState<SquadsPending>();
  // Kept here: the guardian card unmounts once the refetched status says paused.
  const [guardianSignature, setGuardianSignature] = useState<string>();

  const pause = useMutation({
    mutationFn: (paused: boolean) => api.admin.setPaused(paused),
    onSuccess: (result) => {
      setConfirmPause(false);
      setTyped("");
      if (result.pending) setResumeProposal(result.pending);
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
    },
  });
  const timeout = useMutation({
    mutationFn: (seconds: number) => api.admin.setDisputeTimeout(seconds),
    onSuccess: () => {
      setDays("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
    },
  });
  const reconcile = useMutation({ mutationFn: () => api.review.reconcile() as Promise<Report>, onSuccess: setReport });

  if (status.isPending) return <Skeleton className="h-64 w-full" />;
  if (status.isError) return <p className="text-body text-danger">{userErrorMessage(status.error)}</p>;
  const data = status.data;
  const paused = data.paused;
  // With the multisig as config authority the server can't pause, and resuming becomes a Squads proposal.
  const viaMultisig = !data.serverIsAuthority;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/review" className="inline-flex items-center gap-1.5 self-start text-small text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> queue
      </Link>
      <h1 className="text-title font-semibold sm:text-display">ops</h1>

      <div
        role="status"
        className={`flex items-center gap-3 rounded-card border px-5 py-4 ${paused ? "border-danger/30 bg-danger-soft" : "border-success/30 bg-success-soft"}`}
      >
        {paused ? <AlertOctagon aria-hidden className="size-6 shrink-0 text-danger" /> : <CheckCircle2 aria-hidden className="size-6 shrink-0 text-success" />}
        <div>
          <p className="text-title font-semibold">{paused ? "protocol paused" : "protocol running"}</p>
          <p className="text-small text-muted">{paused ? "new listings, claims and bids are blocked on-chain." : "read from the on-chain config every 30 seconds."}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <Stat label="protocol" value={paused ? "paused" : "running"} hint={paused ? "new listings and purchases blocked" : undefined} />
        </Card>
        <Card className="p-4">
          <Stat label="dispute timeout" value={`${(data.disputeTimeoutSeconds / 86_400).toLocaleString(undefined, { maximumFractionDigits: 2 })} days`} />
        </Card>
        <Card className="p-4">
          <Stat label="fee floor" value={`${data.feeBps / 100}%`} />
        </Card>
      </div>
      <Card className="flex flex-col gap-2 p-4 text-small">
        {[
          ["treasury", data.treasury],
          ["config authority", data.authority],
          ["pause guardian", data.pauseGuardian],
          ["squads multisig", data.squadsMultisig],
        ].map(([label, address]) => (
          <p key={label} className="flex flex-wrap items-center gap-2">
            <span className="w-32 text-muted">{label}</span>
            {address ? <Address value={address} chars={6} /> : <span className="text-subtle">not set</span>}
          </p>
        ))}
      </Card>

      {isAdmin && <TeamPanel />}

      {isAdmin && <RentPanel />}

      {isAdmin ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-5">
            <p className="text-body font-semibold">emergency pause</p>
            <p className="text-small text-muted">blocks new listings, spots, claims and bids. payouts, refunds and disputes keep working so no funds get stuck.</p>
            {viaMultisig && !paused ? (
              <GuardianPause
                guardian={data.pauseGuardian}
                onPaused={(signature) => {
                  setGuardianSignature(signature);
                  void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
                }}
              />
            ) : (
              <Button variant={paused ? "primary" : "danger"} onClick={() => setConfirmPause(true)}>
                {paused ? <PlayCircle className="size-4" aria-hidden /> : <PauseCircle className="size-4" aria-hidden />}
                {paused ? (viaMultisig ? "propose resume to the multisig" : "resume protocol") : "pause protocol"}
              </Button>
            )}
            {guardianSignature && paused && (
              <p className="flex flex-wrap items-center gap-2 text-small text-success">
                paused by the guardian <Address value={guardianSignature} kind="tx" chars={6} />
              </p>
            )}
            {resumeProposal && paused && (
              <SquadsPendingNote index={resumeProposal.transactionIndex} url={resumeProposal.url}>
                the protocol stays paused until multisig members approve and execute the resume.
              </SquadsPendingNote>
            )}
            {pause.isError && !confirmPause && <p className="text-small text-danger">{userErrorMessage(pause.error)}</p>}
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <p className="text-body font-semibold">dispute timeout</p>
            <p className="text-small text-muted">unresolved disputes refund the sponsor after this long. applies to open disputes too.</p>
            <div className="flex items-end gap-2">
              <Input label="days" inputMode="decimal" placeholder="3" value={days} onChange={(event) => setDays(event.target.value)} />
              <Button variant="secondary" loading={timeout.isPending} disabled={!Number(days)} onClick={() => timeout.mutate(Math.round(Number(days) * 86_400))}>
                update
              </Button>
            </div>
            {timeout.isError && <p className="text-small text-danger">{userErrorMessage(timeout.error)}</p>}
          </Card>
        </div>
      ) : (
        <p className="text-small text-muted">only admins can pause the protocol or change settings.</p>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-body font-semibold">reconciliation</p>
            <p className="text-small text-muted">checks stuck transactions against Solana and reports spots that disagree with the chain. runs every 5 minutes.</p>
          </div>
          <Button variant="secondary" onClick={() => reconcile.mutate()} loading={reconcile.isPending}>
            run now
          </Button>
        </div>
        {report && (
          <div className="flex flex-col gap-2 text-small">
            <p className="text-muted">
              checked {report.checkedTxs} transactions · {report.confirmedTxs} confirmed · {report.failedTxs} marked failed · {report.withdrawalsUpdated} withdrawals updated · {report.disputesResolved ?? 0} multisig resolutions settled
            </p>
            {report.spotDrift.length === 0 ? (
              <p className="text-success">every spot matches the chain.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {report.spotDrift.map((drift) => (
                  <li key={drift.spotId} className="font-mono">
                    <Link href={`/dashboard/spots/${drift.spotId}`} className="text-accent hover:underline">
                      {drift.spotId.slice(0, 8)}
                    </Link>{" "}
                    db {drift.dbState} · chain {drift.chainStatus}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Modal
        open={confirmPause}
        onClose={() => setConfirmPause(false)}
        title={paused ? (viaMultisig ? "propose a resume?" : "resume the protocol?") : "pause the protocol?"}
        description={
          paused
            ? viaMultisig
              ? "opens a Squads proposal for pause_protocol(false). nothing changes until multisig members approve and execute it."
              : "new listings and purchases will be allowed again."
            : `type "${"pause"}" to confirm. sellers and sponsors can't start anything new until you resume.`
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmPause(false)}>
              cancel
            </Button>
            <Button variant={paused ? "primary" : "danger"} loading={pause.isPending} disabled={!paused && typed !== "pause"} onClick={() => pause.mutate(!paused)}>
              {paused ? (viaMultisig ? "propose resume" : "resume") : "pause"}
            </Button>
          </>
        }
      >
        {!paused && (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1 rounded-card bg-canvas p-3 text-small text-muted">
              <li>stops: new listings, claims and bids</li>
              <li>keeps working: proof, payouts, refunds, disputes and withdrawals, so no money gets stuck</li>
              <li className="text-warning">deadlines keep running: auctions that end while paused go to the current top bidder</li>
            </ul>
            <Input label="confirmation" value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus />
          </div>
        )}
        {pause.isError && <p className="mt-2 text-small text-danger">{userErrorMessage(pause.error)}</p>}
      </Modal>
    </div>
  );
}
