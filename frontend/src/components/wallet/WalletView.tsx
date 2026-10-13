"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Check, CircleCheck, Copy, ShieldCheck, Wallet, Zap } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "@/lib/api/v2";
import type { Withdrawal } from "@/lib/api/types";
import { ADSPACES_CLUSTER } from "@/lib/chain-config";
import { formatUsd, toBaseUnits, toInputValue } from "@/lib/money";
import { useSession } from "@/lib/session";
import { useUsdcBalance } from "@/lib/use-balance";
import { useNow } from "@/lib/use-now";
import { useTx } from "@/lib/use-tx";
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
          <DepositCard address={address} />
        </div>
        <WithdrawCard address={address} balance={balance.data ? BigInt(balance.data) : undefined} history={history.data ?? []} />
      </div>
      <History items={history.data} loading={history.isPending} />
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant="secondary" size="sm" onClick={() => void copy()} aria-label={label}>
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "copied" : "copy"}
    </Button>
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
      <p className="text-small text-muted">send USDC on Solana to this address. other tokens or networks will be lost.</p>
      {ADSPACES_CLUSTER !== "mainnet-beta" && (
        <p className="text-small text-muted">
          <span className="font-medium text-ink">{ADSPACES_CLUSTER} only.</span> don&apos;t send real (mainnet) USDC to this address.
        </p>
      )}
      <div className="flex items-center gap-2 rounded-control bg-canvas p-3">
        <code className="min-w-0 flex-1 break-all font-mono text-caption tracking-tight sm:text-small">{address}</code>
        <CopyButton value={address} label="copy deposit address" />
      </div>
      {ADSPACES_CLUSTER !== "mainnet-beta" && (
        <p className="text-small text-muted">
          testing on {ADSPACES_CLUSTER}? get test USDC from the{" "}
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Circle faucet
          </a>
          .
        </p>
      )}
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
      setSetupError((error as Error).message);
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

function History({ items, loading }: { items?: Withdrawal[]; loading: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-body font-semibold">withdrawals</h2>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : !items?.length ? (
        <p className="text-small text-muted">nothing sent yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3 text-small">
              <span className="w-24 shrink-0 font-semibold tabular-nums">{formatUsd(item.amount)}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1 text-muted">
                to <Address value={item.destination} explorer={false} />
              </span>
              <span className={item.state === "failed" ? "text-danger" : item.state === "confirmed" ? "text-success" : "text-muted"}>{STATE_LABEL[item.state]}</span>
              <span className="hidden shrink-0 text-subtle sm:inline">{new Date(item.createdAt).toLocaleString()}</span>
              {item.signature && <Address value={item.signature} kind="tx" className="hidden text-subtle md:inline-flex" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
