"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { useCallback, useState } from "react";
import { PauseCircle, Wallet } from "lucide-react";
import { api } from "@/lib/api/v2";
import { ADSPACES_CLUSTER } from "@/lib/chain-config";
import { PRIVY_APP_ID } from "@/lib/privy";
import { useTx } from "@/lib/use-tx";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TxStatus } from "@/components/ui/TxStatus";

// Fallback for when no guardian wallet is at hand: signs guardian_pause from the adspaces-program repo.
const GUARDIAN_PAUSE_COMMAND = "ADSPACES_GUARDIAN_WALLET=/path/to/guardian-keypair.json node scripts/pause-guardian-devnet.js pause --confirm";

const SOLANA_CHAIN = `solana:${ADSPACES_CLUSTER === "mainnet-beta" ? "mainnet" : ADSPACES_CLUSTER}` as const;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

// With the multisig as config authority, the pause guardian pauses with its own wallet. That wallet is
// connected here and nowhere else, and only ever signs guardian_pause: the server builds the transaction,
// the wallet signs it (sign only, no send), and the server checks and submits it.
export function GuardianPause({ guardian, onPaused }: { guardian: string | null; onPaused: (signature: string) => void }) {
  return (
    <div className="flex flex-col gap-3 text-small">
      {!guardian ? (
        <p className="text-warning">no active guardian is set on-chain; the multisig must set one first.</p>
      ) : PRIVY_APP_ID ? (
        <GuardianWallet guardian={guardian} onPaused={onPaused} />
      ) : null}
      <CommandFallback />
    </div>
  );
}

function GuardianWallet({ guardian, onPaused }: { guardian: string; onPaused: (signature: string) => void }) {
  const [address, setAddress] = useState<string>();
  const [connectError, setConnectError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [signing, setSigning] = useState(false);
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      if (wallet.type !== "solana") return;
      setConnectError(undefined);
      setAddress(wallet.address);
    },
    onError: (error) => {
      // Closing the modal isn't an error worth showing.
      if (!String(error).includes("exited")) setConnectError("couldn't connect that wallet. try again.");
    },
  });
  // Only the wallet connected from this panel; the embedded wallet is never picked here.
  const wallet = address ? wallets.find((item) => item.address === address) : undefined;
  const isGuardian = wallet?.address === guardian;

  const pause = useCallback(async () => {
    if (!wallet) throw new Error("connect the guardian wallet first");
    const prepared = await api.admin.prepareGuardianPause(wallet.address);
    // Our dialog steps aside so the wallet's own approval window is visible and clickable.
    setSigning(true);
    let signed: Uint8Array;
    try {
      ({ signedTransaction: signed } = await signTransaction({ transaction: fromBase64(prepared.transaction), wallet, chain: SOLANA_CHAIN }));
    } finally {
      setSigning(false);
    }
    const result = await api.admin.submitGuardianPause(prepared.chainTxId, toBase64(signed));
    onPaused(result.signature);
    return result;
  }, [wallet, signTransaction, onPaused]);
  const tx = useTx(pause);
  const done = tx.state.phase === "confirmed";

  const disconnect = async () => {
    await wallet?.disconnect().catch(() => undefined);
    setAddress(undefined);
    tx.reset();
  };

  return (
    <>
      {!wallet ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted">
            the config authority is the multisig, so the server can&apos;t pause. the pause guardian <Address value={guardian} chars={4} /> can: connect its wallet to sign the pause.
          </p>
          <Button
            variant="secondary"
            className="self-start"
            onClick={() =>
              connectWallet({
                walletChainType: "solana-only",
                walletList: ["phantom", "detected_solana_wallets", "solflare", "backpack"],
                description: "connect the pause guardian's wallet. it only signs the emergency pause.",
              })
            }
          >
            <Wallet className="size-4" aria-hidden /> connect guardian wallet
          </Button>
          {connectError && <p className="text-danger">{connectError}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-muted">connected</span>
            <Address value={wallet.address} chars={6} />
            <button type="button" className="text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => void disconnect()}>
              disconnect
            </button>
          </p>
          {isGuardian ? (
            <Button
              variant="danger"
              onClick={() => {
                tx.reset();
                setConfirming(true);
              }}
            >
              <PauseCircle className="size-4" aria-hidden /> emergency pause
            </Button>
          ) : (
            <>
              <p className="text-danger">
                this wallet isn&apos;t the pause guardian. connect <Address value={guardian} chars={4} explorer={false} /> instead.
              </p>
              <Button variant="danger" disabled>
                <PauseCircle className="size-4" aria-hidden /> emergency pause
              </Button>
            </>
          )}
        </div>
      )}

      <Modal
        open={confirming}
        suspended={signing}
        onClose={() => !tx.busy && setConfirming(false)}
        title={done ? "protocol paused" : "emergency pause?"}
        description={done ? undefined : "your wallet will ask you to sign. resuming needs the multisig."}
        footer={
          done ? (
            <Button onClick={() => setConfirming(false)}>done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={tx.busy}>
                cancel
              </Button>
              <Button variant="danger" loading={tx.busy} onClick={() => void tx.execute()}>
                pause now
              </Button>
            </>
          )
        }
      >
        {!done && (
          <ul className="mb-4 flex flex-col gap-1 rounded-card bg-canvas p-3 text-small text-muted">
            <li>stops: new listings, spots, claims and bids</li>
            <li>keeps working: payouts, refunds and disputes</li>
          </ul>
        )}
        <TxStatus state={tx.state} action="pause" onRetry={tx.retry} />
      </Modal>
    </>
  );
}

function CommandFallback() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(GUARDIAN_PAUSE_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <details className="group">
      <summary className="cursor-pointer text-muted hover:text-ink">no wallet? use the command</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-muted">run this in the adspaces-program repo with the guardian&apos;s keypair:</p>
        <pre className="no-scrollbar overflow-x-auto rounded-control bg-canvas px-3 py-2 font-mono text-caption">{GUARDIAN_PAUSE_COMMAND}</pre>
        <Button variant="secondary" size="sm" className="self-start" onClick={() => void copy()}>
          {copied ? "copied" : "copy command"}
        </Button>
      </div>
    </details>
  );
}
