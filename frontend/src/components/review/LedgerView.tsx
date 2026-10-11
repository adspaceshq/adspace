"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleX, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/v2";
import type { LedgerMove, LedgerVerification, ListingLedger } from "@/lib/api/types";
import { formatUsd } from "@/lib/money";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ListingStateBadge, SpotStateBadge } from "@/components/ui/StateBadge";
import { UserLink } from "@/components/ui/UserLink";

const OP_LABEL: Record<string, string> = {
  publish_listing: "published",
  claim_spot: "claimed",
  place_bid: "bid",
  submit_proof: "proof submitted",
  raise_dispute: "dispute opened",
  withdraw_dispute: "dispute withdrawn",
  resolve_dispute: "dispute resolved",
  timeout_dispute: "dispute timed out",
  withdraw_seller: "payout",
  refund_spot: "refund",
  close_spot: "spot closed",
  close_listing: "listing closed",
};

export function LedgerView() {
  const params = useSearchParams();
  const router = useRouter();
  const listingId = params.get("listing");
  return (
    <div className="flex flex-col gap-6">
      <Link href="/review" className="inline-flex items-center gap-1.5 self-start text-small text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> queue
      </Link>
      <div>
        <h1 className="text-title font-semibold">ledger</h1>
        <p className="text-small text-muted">every transaction on a listing, the USDC it moved, and whether each escrow balances.</p>
      </div>
      <ListingSearch onPick={(id) => router.replace(`/review/ledger?listing=${id}`)} />
      {listingId ? <Ledger listingId={listingId} /> : <RecentListings onPick={(id) => router.replace(`/review/ledger?listing=${id}`)} />}
    </div>
  );
}

function ListingSearch({ onPick }: { onPick: (id: string) => void }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const hits = useQuery({ queryKey: ["ledger-search", query], queryFn: () => api.review.searchListings(query), enabled: query.length > 0 });
  return (
    <div className="relative max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="search listings"
        aria-label="search listings"
        className="h-10 w-full rounded-control border border-line bg-surface pl-9 pr-3 text-body outline-none focus:border-line-strong"
      />
      {query && hits.data && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-card border border-line bg-surface shadow-card">
          {hits.data.length === 0 && <li className="px-3 py-2 text-small text-muted">no listings found</li>}
          {hits.data.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(hit.id);
                  setText("");
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-small hover:bg-ink/5"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{hit.title}</span> <UserLink handle={hit.sellerHandle} nested className="text-muted" />
                </span>
                <ListingStateBadge state={hit.state} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Ledger({ listingId }: { listingId: string }) {
  const ledger = useQuery({ queryKey: ["ledger", listingId], queryFn: () => api.review.ledger(listingId) });
  const verify = useMutation({ mutationFn: () => api.review.verifyLedger(listingId) });
  if (ledger.isPending) return <Skeleton className="h-96 w-full" />;
  if (ledger.isError) return <p className="text-body text-danger">{ledger.error.message}</p>;
  const data = ledger.data;
  const checks = new Map((verify.data ?? []).map((row) => [row.entryId, row]));
  const mismatches = (verify.data ?? []).filter((row) => !row.matches).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-lead font-semibold">
            {data.listing.title} <ListingStateBadge state={data.listing.state} />
          </p>
          <p className="text-small text-muted">
            <UserLink handle={data.listing.seller.handle} /> · {data.listing.mode} · {data.entries.length} transactions
          </p>
        </div>
        <div className="flex items-center gap-3">
          {verify.data && (
            <span className={`flex items-center gap-1.5 text-small ${mismatches ? "text-danger" : "text-success"}`}>
              {mismatches ? <CircleX className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              {mismatches ? `${mismatches} transaction${mismatches === 1 ? "" : "s"} differ from chain` : "every transaction matches the chain"}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={() => verify.mutate()} loading={verify.isPending}>
            <ShieldCheck className="size-4" aria-hidden /> verify on chain
          </Button>
        </div>
      </div>
      {verify.isError && <p className="text-small text-danger">{verify.error.message}</p>}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["sponsors paid in", data.totals.sponsorsPaid],
          ["refunded to sponsors", data.totals.refundedToSponsors],
          ["creator earned", data.totals.creatorEarned],
          ["platform fees", data.totals.platformFees],
          ["held in escrow", data.totals.heldInEscrow],
        ].map(([label, value]) => (
          <Card key={label} className="p-3">
            <dt className="text-caption text-muted">{label}</dt>
            <dd className="text-lead font-semibold tabular-nums">{formatUsd(value)}</dd>
          </Card>
        ))}
      </dl>

      {data.flags.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-card border border-warning/40 bg-warning-soft p-3 text-small">
          {data.flags.map((flag, index) => (
            <li key={index} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {flag.message}
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-body font-semibold">escrow per spot</h2>
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-small">
            <thead className="text-left text-caption text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">spot</th>
                <th className="px-3 py-2 font-medium">state</th>
                <th className="px-3 py-2 text-right font-medium">in</th>
                <th className="px-3 py-2 text-right font-medium">out</th>
                <th className="px-3 py-2 text-right font-medium">held</th>
                <th className="px-3 py-2 font-medium">check</th>
              </tr>
            </thead>
            <tbody>
              {data.spots.map((spot) => (
                <tr key={spot.index} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-medium">{spot.index + 1}</td>
                  <td className="px-3 py-2">
                    <SpotStateBadge state={spot.state} perspective="creator" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatUsd(spot.escrowIn)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatUsd(spot.escrowOut)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatUsd(spot.held)}</td>
                  <td className="px-3 py-2">
                    {spot.balanced ? (
                      <span className="text-success">balanced</span>
                    ) : (
                      <span className="text-danger">should hold {formatUsd(spot.expectedHeld)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-body font-semibold">transactions</h2>
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[760px] text-small">
            <thead className="text-left text-caption text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">when</th>
                <th className="px-3 py-2 font-medium">spot</th>
                <th className="px-3 py-2 font-medium">action</th>
                <th className="px-3 py-2 font-medium">USDC moved</th>
                <th className="px-3 py-2 font-medium">status</th>
                <th className="px-3 py-2 font-medium">transaction</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-line align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {new Date(entry.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-2">{entry.spotIndex === null ? "all" : entry.spotIndex + 1}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{OP_LABEL[entry.op] ?? entry.op.replace(/_/g, " ")}</span>
                    {entry.actor && (
                      <span className="block text-caption text-muted">
                        by <UserLink handle={entry.actor.handle} />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Moves moves={entry.moves} />
                  </td>
                  <td className="px-3 py-2">
                    <Status entry={entry} check={checks.get(entry.id)} />
                  </td>
                  <td className="px-3 py-2">{entry.signature ? <Address value={entry.signature} kind="tx" /> : <span className="text-subtle">none</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const PARTY_LABEL: Record<LedgerMove["party"], string> = { sponsor: "sponsor", creator: "creator", treasury: "platform", escrow: "escrow" };

function Moves({ moves }: { moves: LedgerMove[] }) {
  if (moves.length === 0) return <span className="text-subtle">none</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {moves.map((move, index) => {
        const amount = BigInt(move.amount);
        return (
          <li key={index} className="flex items-center gap-2 whitespace-nowrap">
            <span className={`w-20 text-right tabular-nums ${amount < 0n ? "text-danger" : "text-success"}`}>
              {amount < 0n ? "−" : "+"}
              {formatUsd(amount < 0n ? -amount : amount)}
            </span>
            <span className="text-muted">
              {PARTY_LABEL[move.party]}
              {move.handle && (
                <>
                  {" "}
                  <UserLink handle={move.handle} />
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Status({ entry, check }: { entry: ListingLedger["entries"][number]; check?: LedgerVerification }) {
  const tone = entry.status === "confirmed" ? "text-success" : entry.status === "failed" ? "text-danger" : "text-warning";
  return (
    <div className="flex flex-col gap-0.5">
      <span className={tone}>{entry.status}</span>
      {entry.error && <span className="max-w-56 text-caption text-muted">{entry.error}</span>}
      {check && (
        <span className={`text-caption ${check.matches ? "text-success" : "text-danger"}`}>
          {check.chain === "missing" ? "not found on chain" : check.matches ? "matches chain" : "differs from chain"}
        </span>
      )}
    </div>
  );
}

// Shown before a search: the newest listings, so there's always something to open.
function RecentListings({ onPick }: { onPick: (id: string) => void }) {
  const recent = useQuery({ queryKey: ["ledger-search", ""], queryFn: () => api.review.searchListings("") });
  if (recent.isPending) return <Skeleton className="h-64 w-full" />;
  if (!recent.data?.length) return <EmptyState icon={Search} title="no listings yet" description="listings show up here as soon as creators start drafting." />;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-body font-semibold">recent listings</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {recent.data.map((hit) => (
          <li key={hit.id}>
            <button type="button" onClick={() => onPick(hit.id)} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-small hover:bg-ink/5">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{hit.title}</span> <UserLink handle={hit.sellerHandle} nested className="text-muted" />
              </span>
              <span className="hidden text-muted sm:inline">{hit.mode}</span>
              <span className="hidden w-20 text-right text-subtle sm:inline">{new Date(hit.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <ListingStateBadge state={hit.state} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
