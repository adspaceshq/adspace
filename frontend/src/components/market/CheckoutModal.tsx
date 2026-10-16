"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { PublicListing, PublicSpot, SponsorBrand } from "@/lib/api/types";
import { minimumNextBid } from "@/lib/bids";
import { formatUsd, toBaseUnits, toInputValue } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useUsdcBalance } from "@/lib/use-balance";
import { useTx } from "@/lib/use-tx";
import { Button } from "@/components/ui/Button";
import { Checkbox, NewTabLink } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Money } from "@/components/ui/Money";
import { TxStatus } from "@/components/ui/TxStatus";
import { DevnetBanner } from "@/components/app/DevnetBanner";
import { GaslessPrompt } from "@/components/app/GaslessPrompt";
import { LogoUpload } from "./LogoUpload";
import { UserLink } from "@/components/ui/UserLink";

export function CheckoutModal({
  listing,
  spot,
  open,
  onClose,
}: {
  listing: PublicListing;
  spot: PublicSpot;
  open: boolean;
  onClose: () => void;
}) {
  const { session, wallet } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const balance = useUsdcBalance(session?.walletAddress);
  const auction = listing.mode === "auction";
  const minimum = auction ? minimumNextBid(listing, spot) : BigInt(spot.price);

  const sponsor = session?.onboarding?.sponsor;
  const [brand, setBrand] = useState<SponsorBrand>({ name: sponsor?.brandName ?? "", link: sponsor?.website ?? "", handle: "" });
  const [amountText, setAmountText] = useState(toInputValue(minimum));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // True while Privy's gasless approval popup is open; our dialog steps aside so it can be used.
  const [approving, setApproving] = useState(false);
  // Sponsors agree to the terms and content policy before each claim or bid (frontend-only for now).
  const [agreed, setAgreed] = useState(false);

  const tx = useTx(async (payload: { brand: SponsorBrand; amount: string }) =>
    auction ? api.spots.bid(spot.id, payload.amount, payload.brand) : api.spots.claim(spot.id, payload.brand),
  );

  let amount: bigint | null = null;
  try {
    amount = auction ? BigInt(toBaseUnits(amountText)) : BigInt(spot.price);
  } catch {
    amount = null;
  }
  const insufficient = balance.data !== undefined && amount !== null && BigInt(balance.data) < amount;
  const done = tx.state.phase === "confirmed";
  const needsGasless = !wallet.delegated && !done;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!brand.name.trim()) next.name = "add your brand name";
    if (!brand.logoUrl) next.logo = "upload the logo the creator should put on the spot";
    if (brand.link && !/^https:\/\/\S+\.\S+$/.test(brand.link.trim())) next.link = "use a full https:// link";
    if (amount === null) next.amount = "enter an amount like 12.50";
    else if (amount < minimum) next.amount = `minimum is ${formatUsd(minimum)}`;
    // Mirrors the backend guard: anything this far above the minimum is almost certainly a typo.
    else if (amount > minimum * 100n) next.amount = `that's over 100x the minimum of ${formatUsd(minimum)}; check the amount`;
    setErrors(next);
    if (Object.keys(next).length > 0 || amount === null) return;
    const result = await tx.execute({
      brand: {
        name: brand.name.trim(),
        logoUrl: brand.logoUrl,
        ...(brand.link?.trim() ? { link: brand.link.trim() } : {}),
        ...(brand.handle?.trim() ? { handle: brand.handle.trim() } : {}),
      },
      // The API takes USDC as a decimal string ("1.5"), not base units.
      amount: toInputValue(amount),
    });
    if (result) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.listings() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sponsorDashboard }),
        queryClient.invalidateQueries({ queryKey: ["balance"] }),
        queryClient.invalidateQueries({ queryKey: ["bids", spot.id] }),
      ]);
      router.refresh();
    }
  };

  // A bid leads until bidding closes; only a claim makes the spot yours outright.
  const title = done
    ? auction
      ? "you're the top bidder"
      : `spot ${spot.index + 1} is yours`
    : auction
      ? `bid on spot ${spot.index + 1}`
      : `claim spot ${spot.index + 1}`;

  return (
    <Modal
      open={open}
      suspended={approving}
      onClose={() => !approving && onClose()}
      title={title}
      description={done ? undefined : `${listing.title} · @${listing.seller.handle}`}
      footer={
        needsGasless ? undefined : done ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              close
            </Button>
            <Button onClick={() => router.push(`/dashboard/spots/${spot.id}`)}>view your spot</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={tx.busy}>
              cancel
            </Button>
            <Button onClick={() => void submit()} loading={tx.busy} disabled={insufficient || !agreed}>
              {auction ? `bid ${amount !== null ? formatUsd(amount) : ""}` : `claim for ${formatUsd(spot.price)}`}
            </Button>
          </>
        )
      }
    >
      {needsGasless ? (
        <GaslessPrompt action={auction ? "bid" : "claim spots"} onBusyChange={setApproving} />
      ) : done ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden />
          <p className="text-body text-muted">
            {auction
              ? "you're the top bidder. if someone outbids you, your USDC comes straight back."
              : `@${listing.seller.handle} will put your brand on spot ${spot.index + 1} and post proof here.`}
          </p>
          <TxStatus state={tx.state} action={auction ? "bid" : "claim"} className="w-full text-left" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-3" disabled={tx.busy}>
            <legend className="mb-1 text-small font-medium text-muted">your brand</legend>
            <Input
              label="brand name"
              value={brand.name}
              onChange={(event) => setBrand({ ...brand, name: event.target.value })}
              error={errors.name}
              maxLength={80}
              autoFocus
            />
            <LogoUpload
              value={brand.logoUrl}
              onChange={(logoUrl) => setBrand((current) => ({ ...current, logoUrl }))}
              creatorHandle={listing.seller.handle}
              error={errors.logo}
              disabled={tx.busy}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="link (optional)"
                placeholder="https://"
                value={brand.link}
                onChange={(event) => setBrand({ ...brand, link: event.target.value })}
                error={errors.link}
              />
              <Input
                label="x handle (optional)"
                placeholder="@brand"
                value={brand.handle}
                onChange={(event) => setBrand({ ...brand, handle: event.target.value })}
                maxLength={40}
              />
            </div>
          </fieldset>

          {auction && (
            <Input
              label="your bid (USDC)"
              inputMode="decimal"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              hint={`minimum ${formatUsd(minimum)}${spot.amount ? ` · current ${formatUsd(spot.amount)}` : ""}`}
              error={errors.amount}
              disabled={tx.busy}
            />
          )}

          <dl className="flex flex-col gap-2 rounded-card bg-canvas p-4 text-body">
            <div className="flex justify-between">
              <dt className="text-muted">you pay</dt>
              <dd className="font-semibold">{amount !== null ? <Money value={amount} /> : "—"} USDC</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">your balance</dt>
              <dd className={insufficient ? "font-medium text-danger" : undefined}>
                {balance.data === undefined ? "…" : <Money value={balance.data} />}
              </dd>
            </div>
            <div className="mt-1 flex gap-2 border-t border-line pt-3 text-small text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <p>
                held in escrow until <UserLink handle={listing.seller.handle} /> posts proof. if it isn&apos;t delivered by{" "}
                {new Date(listing.deliveryDueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}, you can get a full refund.
                {auction && " if you're outbid, it comes straight back."}
              </p>
            </div>
          </dl>

          <DevnetBanner variant="inline" />

          <Checkbox checked={agreed} onChange={setAgreed} disabled={tx.busy}>
            i agree to the <NewTabLink href="/terms">terms</NewTabLink> and{" "}
            <NewTabLink href="/content-policy">content policy</NewTabLink>
          </Checkbox>

          {insufficient && (
            <p role="alert" className="text-small text-danger">
              add at least {formatUsd(amount! - BigInt(balance.data!))} USDC to your wallet to continue.
            </p>
          )}
          <TxStatus state={tx.state} action={auction ? "bid" : "claim"} onRetry={tx.retry} />
        </div>
      )}
    </Modal>
  );
}
