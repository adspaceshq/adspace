"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, ExternalLink, ShieldCheck, Wallet, Zap } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "@/lib/api/v2";
import type { Withdrawal } from "@/lib/api/types";
import { ADSPACES_CLUSTER, explorerAddressUrl, explorerTxUrl } from "@/lib/chain-config";
import { formatUsd, toBaseUnits, toInputValue } from "@/lib/money";
import { useSession } from "@/lib/session";
import { useUsdcBalance } from "@/lib/use-balance";
import { useNow } from "@/lib/use-now";
import { useTx } from "@/lib/use-tx";
import { DAILY_WITHDRAWAL_LIMIT, usedInLastDay, validateWithdrawal, withdrawable, type WithdrawErrors } from "@/lib/withdraw";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { TxStatus } from "@/components/ui/TxStatus";

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
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
          <BalanceCard address={address} balance={balance.data} loading={balance.isPending} />
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

function BalanceCard({ address, balance, loading }: { address: string; balance?: string; loading: boolean }) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="text-small text-muted">available balance</p>
      {loading ? <Skeleton className="h-10 w-40" /> : <p className="text-display font-semibold tabular-nums">{formatUsd(balance ?? "0")}</p>}
      <div className="flex flex-wrap items-center gap-2 text-small">
        <span className="font-mono">{short(address)}</span>
        <CopyButton value={address} label="copy wallet address" />
        <a href={explorerAddressUrl(address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
          explorer <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>
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
      <div className="flex items-center gap-2 rounded-control bg-canvas p-3">
        <code className="min-w-0 flex-1 break-all text-small">{address}</code>
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
  const [setupError, setSetupError] = useState<string>();
  const used = usedInLastDay(history, now);
  const max = withdrawable(balance ?? 0n, used);

  // Fresh two-factor check inside the tx so a retry asks again.
  const send = useCallback(
    async (to: string, value: string) => {
      await wallet.verifyMfa();
      return api.me.withdraw(to, value);
    },
    [wallet],
  );
  const tx = useTx(send);

  const review = () => {
    const next = validateWithdrawal({ destination, amount, ownAddress: address, balance: balance ?? 0n, used });
    setErrors(next);
    if (Object.keys(next).length === 0) {
      tx.reset();
      setReviewing(true);
    }
  };
  const confirm = async () => {
    const result = await tx.execute(destination.trim(), toInputValue(toBaseUnits(amount)));
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
        onClose={() => !tx.busy && setReviewing(false)}
        title={tx.state.phase === "confirmed" ? "sent" : "confirm withdrawal"}
        description={tx.state.phase === "confirmed" ? undefined : "you'll be asked for your two-factor code. transfers on Solana can't be reversed."}
        footer={
          tx.state.phase === "confirmed" ? (
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
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
          <dt className="text-muted">amount</dt>
          <dd className="font-semibold tabular-nums">{amount ? formatUsd(safeBase(amount)) : "-"}</dd>
          <dt className="text-muted">to</dt>
          <dd className="break-all font-mono text-small">{destination.trim()}</dd>
          <dt className="text-muted">network fee</dt>
          <dd>paid by adspaces</dd>
        </dl>
        <div className="mt-4">
          <TxStatus state={tx.state} action="withdraw" onRetry={tx.retry} />
        </div>
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
              <span className="min-w-0 flex-1 truncate font-mono text-muted">to {short(item.destination)}</span>
              <span className={item.state === "failed" ? "text-danger" : item.state === "confirmed" ? "text-success" : "text-muted"}>{STATE_LABEL[item.state]}</span>
              <span className="hidden shrink-0 text-subtle sm:inline">{new Date(item.createdAt).toLocaleString()}</span>
              {item.chainTxId && (
                <a href={explorerTxUrl(item.chainTxId)} target="_blank" rel="noreferrer" aria-label="view on explorer" className="text-accent">
                  <ExternalLink className="size-4" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
