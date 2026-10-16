"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, CircleCheck, Hourglass, ShieldCheck, Wallet, Zap } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "@/lib/api/v2";
import type { ActivityItem, Withdrawal } from "@/lib/api/types";
import { activityLabel } from "@/lib/activity";
import { queryKeys } from "@/lib/query";
import { isMoneyEvent, pendingEarnings } from "@/lib/wallet-history";
import { cx } from "@/lib/cx";
import { Countdown } from "@/components/ui/Countdown";
import { DepositDetails } from "./DepositDetails";
import { formatUsd, toBaseUnits, toInputValue } from "@/lib/money";
import { useSession } from "@/lib/session";
import { useUsdcBalance } from "@/lib/use-balance";
import { useNow } from "@/lib/use-now";
import { useTx } from "@/lib/use-tx";
import { userErrorMessage } from "@/lib/errors";
import { DAILY_WITHDRAWAL_LIMIT, usedInLastDay, validateWithdrawal, withdrawable, type WithdrawErrors } from "@/lib/withdraw";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { TxStatus } from "@/components/ui/TxStatus";

const STATE_LABEL: Record<Withdrawal["state"], string> = { pending: "queued", submitted: "sending", confirmed: "sent", failed: "failed" };

export function WalletView() {
  const { session } = useSession();
  const address = session?.walletAddress;
  const balance = useUsdcBalance(address);
  // The latest withdrawals feed the 24-hour limit; the history below pages on its own.
  const history = useQuery({ queryKey: ["withdrawals"], queryFn: () => api.me.withdrawals(), enabled: Boolean(address) });

  if (!address) return <EmptyState icon={Wallet} title="your wallet is being created" description="refresh in a moment. privy creates it the first time you sign in." />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-title font-semibold sm:text-display">wallet</h1>
        <p className="text-body text-muted">earnings land here in USDC. send them to any Solana wallet or exchange.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-4">
          <BalanceCard address={address} balance={balance.data} loading={balance.isPending} onRetry={() => void balance.refetch()} />
          <PendingCard />
          <DepositCard address={address} />
        </div>
        <WithdrawCard address={address} balance={balance.data ? BigInt(balance.data) : undefined} history={history.data ?? []} />
      </div>
      <History />
    </div>
  );
}

function BalanceCard({ address, balance, loading, onRetry }: { address: string; balance?: string; loading: boolean; onRetry: () => void }) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="text-small text-muted">available balance</p>
      {loading ? (
        <Skeleton className="h-10 w-40" />
      ) : balance !== undefined ? (
        <p className="text-display font-semibold tabular-nums">{formatUsd(balance)}</p>
      ) : (
        <p className="flex items-center gap-3 text-body text-muted">
          couldn&apos;t load your balance
          <Button variant="secondary" size="sm" onClick={onRetry}>
            retry
          </Button>
        </p>
      )}
      <Address value={address} chars={6} className="text-small" />
    </Card>
  );
}

function DepositCard({ address }: { address: string }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="flex items-center gap-2 text-body font-semibold">
        <ArrowDownToLine className="size-4" aria-hidden /> add funds
      </p>
      <DepositDetails address={address} />
    </Card>
  );
}

function WithdrawCard({ address, balance, history }: { address: string; balance?: bigint; history: Withdrawal[] }) {
  const { wallet } = useSession();
  const queryClient = useQueryClient();
  const now = useNow(60_000);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<WithdrawErrors>({});
  const [reviewing, setReviewing] = useState(false);
  const [signing, setSigning] = useState(false);
  // What was actually sent, so the receipt survives the form being cleared.
  const [sent, setSent] = useState<{ amount: string; destination: string }>();
  const [setupError, setSetupError] = useState<string>();
  const used = usedInLastDay(history, now);
  const max = withdrawable(balance ?? 0n, used);

  // Fresh two-factor check inside the tx so a retry asks again.
  const send = useCallback(
    // Prepare on the server, sign with the user's own wallet (Privy asks for two-factor), then submit.
    async (to: string, value: string) => {
      const prepared = await api.me.prepareWithdrawal(to, value);
      // Our dialog steps aside so Privy's signing and two-factor popup is visible and clickable.
      setSigning(true);
      let signed: string;
      try {
        signed = await wallet.signTransaction(prepared.transaction);
      } finally {
        setSigning(false);
      }
      return api.me.submitWithdrawal(prepared.withdrawalId, signed);
    },
    [wallet],
  );
  const tx = useTx(send);
  const done = tx.state.phase === "confirmed";

  const review = () => {
    const next = validateWithdrawal({ destination, amount, ownAddress: address, balance: balance ?? 0n, used });
    setErrors(next);
    if (Object.keys(next).length === 0) {
      tx.reset();
      setReviewing(true);
    }
  };
  const confirm = async () => {
    const sending = { amount: toBaseUnits(amount), destination: destination.trim() };
    setSent(sending);
    const result = await tx.execute(sending.destination, toInputValue(sending.amount));
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["withdrawals"] }), queryClient.invalidateQueries({ queryKey: ["balance", address] })]);
    if (result) {
      setAmount("");
      setDestination("");
    }
  };
  const enable = async (action: () => Promise<void> | void) => {
    setSetupError(undefined);
    try {
      await action();
    } catch (error) {
      setSetupError(userErrorMessage(error));
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="flex items-center gap-2 text-body font-semibold">
        <ArrowUpFromLine className="size-4" aria-hidden /> withdraw
      </p>
      {!wallet.delegated ? (
        <SetupStep icon={Zap} title="turn on gasless transactions" description="adspaces pays the network fees for you. you approve this once." action="turn on" onClick={() => void enable(wallet.enableGasless)} />
      ) : !wallet.mfaEnabled ? (
        <SetupStep
          icon={ShieldCheck}
          title="set up two-factor first"
          description="withdrawals always need a second check, so a stolen login can't move your money."
          action="set up two-factor"
          onClick={() => void enable(wallet.setupMfa)}
        />
      ) : (
        <>
          <Input label="to address" placeholder="Solana wallet address" value={destination} onChange={(event) => setDestination(event.target.value)} error={errors.destination} spellCheck={false} autoComplete="off" />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="amount (USDC)" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} error={errors.amount} />
            </div>
            <Button variant="secondary" onClick={() => setAmount(toInputValue(max))} disabled={max === 0n}>
              max
            </Button>
          </div>
          <p className="text-small text-muted">
            {formatUsd(max)} available now · {formatUsd(DAILY_WITHDRAWAL_LIMIT - used > 0n ? DAILY_WITHDRAWAL_LIMIT - used : 0n)} left of your {formatUsd(DAILY_WITHDRAWAL_LIMIT)} 24-hour limit
          </p>
          <Button onClick={review} disabled={balance === undefined}>
            review withdrawal
          </Button>
        </>
      )}
      {setupError && (
        <p role="alert" className="text-small text-danger">
          {setupError}
        </p>
      )}
      <Modal
        open={reviewing}
        suspended={signing}
        onClose={() => !tx.busy && setReviewing(false)}
        title={done ? "withdrawal sent" : "confirm withdrawal"}
        description={done ? undefined : "you'll be asked for your two-factor code. transfers on Solana can't be reversed."}
        footer={
          done ? (
            <Button onClick={() => setReviewing(false)}>done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setReviewing(false)} disabled={tx.busy}>
                cancel
              </Button>
              <Button onClick={() => void confirm()} loading={tx.busy}>
                <ShieldCheck className="size-4" aria-hidden /> verify and send
              </Button>
            </>
          )
        }
      >
        {done && sent ? (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-success-soft">
              <CircleCheck className="size-7 text-success" aria-hidden />
            </span>
            <div>
              <p className="text-display font-semibold tabular-nums">{formatUsd(sent.amount)}</p>
              <p className="text-small text-muted">USDC is on its way. it usually lands within a few seconds.</p>
            </div>
            <dl className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-card bg-canvas p-4 text-left text-small">
              <dt className="text-muted">to</dt>
              <dd className="flex justify-end">
                <Address value={sent.destination} chars={6} />
              </dd>
              {tx.state.signature && (
                <>
                  <dt className="text-muted">transaction</dt>
                  <dd className="flex justify-end">
                    <Address value={tx.state.signature} kind="tx" chars={6} />
                  </dd>
                </>
              )}
              <dt className="text-muted">network fee</dt>
              <dd className="text-right">paid by adspaces</dd>
            </dl>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-body">
              <dt className="text-muted">amount</dt>
              <dd className="font-semibold tabular-nums">{amount ? formatUsd(safeBase(amount)) : "-"}</dd>
              <dt className="text-muted">to</dt>
              <dd className="min-w-0 text-caption">
                <Address value={destination.trim()} full explorer={false} className="max-w-full" />
              </dd>
              <dt className="text-muted">network fee</dt>
              <dd>paid by adspaces</dd>
            </dl>
            <div className="mt-4">
              <TxStatus state={tx.state} action="withdraw" onRetry={tx.retry} />
            </div>
          </>
        )}
      </Modal>
    </Card>
  );
}

function safeBase(amount: string): string {
  try {
    return toBaseUnits(amount);
  } catch {
    return "0";
  }
}

function SetupStep({ icon: Icon, title, description, action, onClick }: { icon: typeof Zap; title: string; description: string; action: string; onClick: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-card bg-canvas p-4">
      <Icon className="size-5 text-accent" aria-hidden />
      <p className="text-body font-semibold">{title}</p>
      <p className="text-small text-muted">{description}</p>
      <Button onClick={onClick} className="self-start">
        {action}
      </Button>
    </div>
  );
}

// Paid spots still in escrow: what the creator will receive once each review window closes.
function PendingCard() {
  const query = useQuery({ queryKey: queryKeys.creatorDashboard, queryFn: () => api.me.creatorDashboard() });
  if (query.isPending || query.isError) return null;
  const items = pendingEarnings(query.data.listings);
  if (items.length === 0) return null;
  const totalNet = items.reduce((sum, item) => sum + (item.net ?? item.gross), 0n);
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-body font-semibold">
          <Hourglass className="size-4" aria-hidden /> pending earnings
        </p>
        <p className="text-right">
          <span className="block text-lead font-semibold tabular-nums">{formatUsd(totalNet)}</span>
          <span className="text-caption text-muted">after fees, held in escrow</span>
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {items.map((item) => (
          <li key={item.spotId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-small">
            <Link href={`/sell/listings/${item.listingId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {item.listingTitle} · spot {item.spotIndex + 1}
            </Link>
            <span className="text-right">
              <span className="block font-semibold tabular-nums">{formatUsd(item.net ?? item.gross)}</span>
              {item.fee !== null && (
                <span className="block text-caption text-muted">
                  {formatUsd(item.gross)} minus {formatUsd(item.fee)} fee
                </span>
              )}
            </span>
            <span className="basis-full text-caption text-muted">
              {item.needsProof ? "submit proof by the delivery deadline · " : "delivered · "}
              payout <Countdown to={item.payoutAt} prefix="in" endedLabel="ready now" urgentWithinMs={0} /> ·{" "}
              {item.payoutAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted">a dispute can change these amounts. payouts land in this wallet.</p>
    </Card>
  );
}

const PAGE = 20;
type HistoryView = "payments" | "withdrawals";

// Payments (claims, bids, payouts, refunds, dispute settlements) and withdrawals, each paged with "load more".
function History() {
  const [view, setView] = useState<HistoryView>("payments");
  return (
    <section aria-labelledby="wallet-history" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="wallet-history" className="text-body font-semibold">
          history
        </h2>
        <div role="group" aria-label="history type" className="inline-flex rounded-control border border-line bg-surface p-0.5">
          {(["payments", "withdrawals"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cx(
                "min-h-11 cursor-pointer rounded-control px-3 text-small font-medium sm:min-h-8",
                view === option ? "bg-ink text-white" : "text-muted hover:text-ink",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {view === "payments" ? <PaymentHistory /> : <WithdrawalHistory />}
    </section>
  );
}

function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <Button variant="secondary" className="self-center" loading={loading} onClick={onClick}>
      load more
    </Button>
  );
}

function PaymentHistory() {
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.activity, "wallet"],
    queryFn: ({ pageParam }) => api.me.activity({ limit: PAGE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ActivityItem[]) => (last.length === PAGE ? last.at(-1)?.createdAt : undefined),
  });
  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  if (query.isError) return <p className="text-small text-danger">{userErrorMessage(query.error)}</p>;
  const items = query.data.pages.flat().filter(isMoneyEvent);
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-small text-muted">{query.hasNextPage ? "no payments in your latest activity." : "no payments yet."}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-small">
              <span className="w-32 shrink-0 font-medium">{activityLabel(item.type)}</span>
              <Link href={`/dashboard/spots/${item.spotId}`} className="min-w-0 flex-1 truncate text-muted hover:text-ink hover:underline">
                {item.listingTitle} · spot {item.spotIndex + 1} · {item.role === "creator" ? "selling" : "sponsoring"}
              </Link>
              <span className="shrink-0 text-muted">{new Date(item.createdAt).toLocaleString()}</span>
              {item.signature && <Address value={item.signature} kind="tx" className="text-muted" />}
            </li>
          ))}
        </ul>
      )}
      <LoadMore hasMore={Boolean(query.hasNextPage)} loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
    </div>
  );
}

function WithdrawalHistory() {
  const query = useInfiniteQuery({
    queryKey: ["withdrawals", "history"],
    queryFn: ({ pageParam }) => api.me.withdrawals({ limit: PAGE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: Withdrawal[]) => (last.length === PAGE ? last.at(-1)?.createdAt : undefined),
  });
  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  if (query.isError) return <p className="text-small text-danger">{userErrorMessage(query.error)}</p>;
  const items = query.data.pages.flat();
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-small text-muted">nothing sent yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-small">
              <span className="w-24 shrink-0 font-semibold tabular-nums">{formatUsd(item.amount)}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1 text-muted">
                to <Address value={item.destination} explorer={false} />
              </span>
              <span className={item.state === "failed" ? "text-danger" : item.state === "confirmed" ? "text-success" : "text-muted"}>{STATE_LABEL[item.state]}</span>
              <span className="shrink-0 text-muted">{new Date(item.createdAt).toLocaleString()}</span>
              {item.signature && <Address value={item.signature} kind="tx" className="text-muted" />}
            </li>
          ))}
        </ul>
      )}
      <LoadMore hasMore={Boolean(query.hasNextPage)} loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
    </div>
  );
}
