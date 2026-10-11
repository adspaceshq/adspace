import { asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import type { Connection } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { bids, chainTxs, disputes, listings, settlements, spotEvents, spots, users } from "../db/schema.js";

// Reviewer tool: every transaction for one listing, the USDC each one moved, and whether every
// escrow balances. Built from our records; `verifyLedger` re-checks it against Solana.

type Party = "sponsor" | "creator" | "treasury" | "escrow";
export interface LedgerMove {
  party: Party;
  wallet: string | null;
  handle: string | null;
  // Signed base units: negative = paid out of this party, positive = received.
  amount: bigint;
}
export interface LedgerEntry {
  id: string;
  createdAt: Date;
  op: string;
  status: string;
  signature: string | null;
  error: string | null;
  spotIndex: number | null;
  actor: { handle: string; wallet: string | null } | null;
  moves: LedgerMove[];
}

const HELD_STATES = new Set(["funded", "delivered", "disputed"]);

export async function listingLedger(db: Db, listingId: string, treasury: string | null) {
  const [listing] = await db
    .select({ listing: listings, sellerHandle: users.handle, sellerWallet: users.walletAddress })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(listings.id, listingId));
  if (!listing) return undefined;
  const spotRows = await db.select().from(spots).where(eq(spots.listingId, listingId)).orderBy(asc(spots.index));
  const spotIds = spotRows.map((spot) => spot.id);
  const spotById = new Map(spotRows.map((spot) => [spot.id, spot]));

  const txs = await db
    .select({ tx: chainTxs, actorHandle: users.handle, actorWallet: users.walletAddress })
    .from(chainTxs)
    .leftJoin(users, eq(users.id, chainTxs.actorId))
    .where(spotIds.length ? or(eq(chainTxs.listingId, listingId), inArray(chainTxs.spotId, spotIds)) : eq(chainTxs.listingId, listingId))
    .orderBy(asc(chainTxs.createdAt));
  const txIds = txs.map((row) => row.tx.id);

  const [bidRows, settlementRows, claimRows, disputeRows] = await Promise.all(
    spotIds.length
      ? [
          db.select().from(bids).where(inArray(bids.spotId, spotIds)).orderBy(asc(bids.createdAt), asc(bids.id)),
          txIds.length ? db.select().from(settlements).where(inArray(settlements.chainTxId, txIds)) : Promise.resolve([]),
          txIds.length ? db.select().from(spotEvents).where(inArray(spotEvents.chainTxId, txIds)) : Promise.resolve([]),
          db.select({ spotId: disputes.spotId, buyerId: disputes.buyerId }).from(disputes).where(inArray(disputes.spotId, spotIds)),
        ]
      : [Promise.resolve([]), Promise.resolve([]), Promise.resolve([]), Promise.resolve([])],
  );

  const userIds = new Set<string>();
  for (const bid of bidRows) userIds.add(bid.bidderId);
  for (const spot of spotRows) if (spot.buyerId) userIds.add(spot.buyerId);
  for (const dispute of disputeRows) userIds.add(dispute.buyerId);
  const people = userIds.size
    ? await db.select({ id: users.id, handle: users.handle, wallet: users.walletAddress }).from(users).where(inArray(users.id, [...userIds]))
    : [];
  const person = new Map(people.map((row) => [row.id, row]));
  const sponsor = (userId: string | null | undefined, amount: bigint): LedgerMove => {
    const who = userId ? person.get(userId) : undefined;
    return { party: "sponsor", wallet: who?.wallet ?? null, handle: who?.handle ?? null, amount };
  };
  const creator = (amount: bigint): LedgerMove => ({ party: "creator", wallet: listing.sellerWallet, handle: listing.sellerHandle, amount });
  const escrow = (spotId: string, amount: bigint): LedgerMove => ({ party: "escrow", wallet: spotById.get(spotId)?.chainAddress ?? null, handle: null, amount });
  const platform = (amount: bigint): LedgerMove => ({ party: "treasury", wallet: treasury, handle: null, amount });

  // Outbid refunds: each bid returns the previous top bid on the same spot.
  const previousBid = new Map<string, (typeof bidRows)[number]>();
  const lastBidBySpot = new Map<string, (typeof bidRows)[number]>();
  for (const bid of bidRows) {
    const prior = lastBidBySpot.get(bid.spotId);
    if (prior) previousBid.set(bid.id.toString(), prior);
    lastBidBySpot.set(bid.spotId, bid);
  }
  const bidByTx = new Map(bidRows.filter((bid) => bid.chainTxId).map((bid) => [bid.chainTxId!, bid]));
  const settlementByTx = new Map(settlementRows.map((row) => [row.chainTxId!, row]));
  const claimByTx = new Map(claimRows.filter((row) => row.type === "claimed").map((row) => [row.chainTxId!, row]));
  const disputeBuyer = new Map(disputeRows.map((row) => [row.spotId, row.buyerId]));

  const entries: LedgerEntry[] = txs.map(({ tx, actorHandle, actorWallet }) => {
    const moves: LedgerMove[] = [];
    if (tx.status === "confirmed" && tx.spotId) {
      const spotId = tx.spotId;
      const bid = bidByTx.get(tx.id);
      const claim = claimByTx.get(tx.id);
      const settlement = settlementByTx.get(tx.id);
      if (bid) {
        moves.push(sponsor(bid.bidderId, -bid.amount), escrow(spotId, bid.amount));
        const prior = previousBid.get(bid.id.toString());
        if (prior) moves.push(sponsor(prior.bidderId, prior.amount), escrow(spotId, -prior.amount));
      } else if (claim) {
        const amount = BigInt(String((claim.data as { amount?: string }).amount ?? spotById.get(spotId)?.price ?? 0));
        moves.push(sponsor(claim.actorId, -amount), escrow(spotId, amount));
      } else if (settlement) {
        const buyerId = disputeBuyer.get(spotId) ?? spotById.get(spotId)?.buyerId;
        moves.push(escrow(spotId, -settlement.gross));
        if (settlement.buyerRefund > 0n) moves.push(sponsor(buyerId, settlement.buyerRefund));
        if (settlement.sellerNet > 0n) moves.push(creator(settlement.sellerNet));
        if (settlement.fee > 0n) moves.push(platform(settlement.fee));
      }
    }
    return {
      id: tx.id,
      createdAt: tx.createdAt,
      op: tx.op,
      status: tx.status,
      signature: tx.signature,
      error: tx.error ? tx.error.split("\n---\n")[0] : null,
      spotIndex: tx.spotId ? (spotById.get(tx.spotId)?.index ?? null) : null,
      actor: actorHandle ? { handle: actorHandle, wallet: actorWallet } : null,
      moves,
    };
  });

  const spotSummaries = spotRows.map((spot) => {
    let escrowIn = 0n;
    let escrowOut = 0n;
    for (const entry of entries) {
      for (const move of entry.moves) {
        if (move.party !== "escrow" || move.wallet !== spot.chainAddress) continue;
        if (move.amount > 0n) escrowIn += move.amount;
        else escrowOut -= move.amount;
      }
    }
    const held = escrowIn - escrowOut;
    const expectedHeld = HELD_STATES.has(spot.state) ? (spot.amount ?? 0n) : 0n;
    return { index: spot.index, state: spot.state, price: spot.price, amount: spot.amount, escrowIn, escrowOut, held, expectedHeld, balanced: held === expectedHeld };
  });

  const sum = (party: Party, sign: 1 | -1) =>
    entries.flatMap((entry) => entry.moves).filter((move) => move.party === party && (sign > 0 ? move.amount > 0n : move.amount < 0n)).reduce((total, move) => total + move.amount * BigInt(sign), 0n);
  return {
    listing: { id: listing.listing.id, title: listing.listing.title, slug: listing.listing.slug, mode: listing.listing.mode, state: listing.listing.state, seller: { handle: listing.sellerHandle, wallet: listing.sellerWallet } },
    totals: {
      sponsorsPaid: sum("sponsor", -1),
      refundedToSponsors: sum("sponsor", 1),
      creatorEarned: sum("creator", 1),
      platformFees: sum("treasury", 1),
      heldInEscrow: spotSummaries.reduce((total, spot) => total + spot.held, 0n),
    },
    spots: spotSummaries,
    entries,
    flags: [
      ...entries.filter((entry) => entry.status === "failed").map((entry) => ({ type: "failed_tx" as const, entryId: entry.id, message: `${entry.op} failed: ${entry.error ?? "unknown"}` })),
      ...entries.filter((entry) => entry.status === "pending" || entry.status === "submitted").map((entry) => ({ type: "unsettled_tx" as const, entryId: entry.id, message: `${entry.op} is still ${entry.status}` })),
      ...spotSummaries.filter((spot) => !spot.balanced).map((spot) => ({ type: "escrow_mismatch" as const, entryId: null, message: `spot ${spot.index + 1}: escrow holds ${spot.held} but should hold ${spot.expectedHeld}` })),
    ],
  };
}

// Re-reads each confirmed transaction from Solana and compares the real USDC moves (by token-account
// owner) with the ledger's expected moves.
export async function verifyLedger(connection: Connection, entries: LedgerEntry[]) {
  const results: Array<{ entryId: string; chain: "ok" | "failed" | "missing"; matches: boolean; actual: Record<string, string> }> = [];
  for (const entry of entries) {
    if (!entry.signature || entry.status !== "confirmed") continue;
    const tx = await connection.getParsedTransaction(entry.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (!tx?.meta) {
      results.push({ entryId: entry.id, chain: "missing", matches: false, actual: {} });
      continue;
    }
    const before = new Map(tx.meta.preTokenBalances?.map((row) => [row.accountIndex, BigInt(row.uiTokenAmount.amount)]) ?? []);
    const actual = new Map<string, bigint>();
    for (const row of tx.meta.postTokenBalances ?? []) {
      const delta = BigInt(row.uiTokenAmount.amount) - (before.get(row.accountIndex) ?? 0n);
      if (delta !== 0n && row.owner) actual.set(row.owner, (actual.get(row.owner) ?? 0n) + delta);
    }
    // Token accounts that were closed in the tx (e.g. emptied vaults) only appear in pre balances.
    for (const row of tx.meta.preTokenBalances ?? []) {
      if (!(tx.meta.postTokenBalances ?? []).some((post) => post.accountIndex === row.accountIndex) && row.owner) {
        actual.set(row.owner, (actual.get(row.owner) ?? 0n) - BigInt(row.uiTokenAmount.amount));
      }
    }
    const expected = new Map<string, bigint>();
    for (const move of entry.moves) if (move.wallet) expected.set(move.wallet, (expected.get(move.wallet) ?? 0n) + move.amount);
    const keys = new Set([...actual.keys(), ...expected.keys()]);
    const matches = [...keys].every((key) => (actual.get(key) ?? 0n) === (expected.get(key) ?? 0n));
    results.push({ entryId: entry.id, chain: tx.meta.err ? "failed" : "ok", matches: matches && !tx.meta.err, actual: Object.fromEntries([...actual].map(([key, value]) => [key, value.toString()])) });
  }
  return results;
}

// Any listing, by title, slug, seller handle or id; newest first. Reviewer-only.
export async function searchListings(db: Db, query: string, limit = 20) {
  const text = query.trim().slice(0, 80);
  const pattern = `%${text.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
  return db
    .select({ id: listings.id, title: listings.title, slug: listings.slug, state: listings.state, mode: listings.mode, createdAt: listings.createdAt, sellerHandle: users.handle })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(text ? (isId ? eq(listings.id, text) : or(ilike(listings.title, pattern), ilike(listings.slug, pattern), ilike(users.handle, pattern))) : undefined)
    .orderBy(desc(listings.createdAt))
    .limit(limit);
}
