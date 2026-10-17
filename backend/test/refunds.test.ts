import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { Connection, Keypair } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner, type TxSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { spots } from "../src/db/schema.js";
import { closeListing, closeSpot, refundSpot, rentReport, type RefundDeps } from "../src/services/refunds.js";
import { createTestDb } from "./helpers/db.js";
import { fakeRunTx, seedListing, seedUser, USDC } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;

let db: Db;
let close: () => Promise<void>;
let sent: ChainTxRequest[];

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());
beforeEach(() => {
  sent = [];
});

// The platform key pays fees and rent unless a test swaps in a separate rent payer.
const deps = (platform: TxSigner = keypairSigner(Keypair.generate()), rentPayer: TxSigner = platform): RefundDeps => ({
  db,
  program: createProgram(new Connection("http://127.0.0.1:8899")),
  mint: Keypair.generate().publicKey,
  feePayer: platform,
  rentPayer,
  runTx: fakeRunTx(db, sent),
  readVaultBalance: async () => 100n * USDC,
  accountExists: async () => true,
});

test("the creator can refund a funded spot before delivery", async () => {
  const { seller, spot } = await seedListing(db, {
    deadline: new Date(Date.now() + HOUR),
    deliveryDueAt: new Date(Date.now() + 48 * HOUR),
    funded: true,
  });
  const result = await refundSpot(deps(), spot.id, { id: seller.user.id, sellerSigner: seller.signer });
  assert.equal(result.spot.state, "refunded");
  assert.equal(result.settlement.buyerRefund, 100n * USDC);
  assert.equal(sent[0].signers?.length, 1);
});

test("the creator must refund with the listing wallet", async () => {
  const { seller, spot } = await seedListing(db, {
    deadline: new Date(Date.now() + HOUR),
    deliveryDueAt: new Date(Date.now() + 48 * HOUR),
    funded: true,
  });
  await assert.rejects(
    refundSpot(deps(), spot.id, { id: seller.user.id, sellerSigner: keypairSigner(Keypair.generate()) }),
    /listing wallet/,
  );
});

test("sponsors get a refund only after a missed delivery deadline without proof", async () => {
  const pending = await seedListing(db, {
    deadline: new Date(Date.now() - HOUR),
    deliveryDueAt: new Date(Date.now() + HOUR),
    funded: true,
  });
  await assert.rejects(refundSpot(deps(), pending.spot.id, { id: pending.buyer!.user.id }), /misses the delivery deadline/);

  const missed = await seedListing(db, {
    deadline: new Date(Date.now() - 48 * HOUR),
    deliveryDueAt: new Date(Date.now() - HOUR),
    funded: true,
  });
  const result = await refundSpot(deps(), missed.spot.id, { id: missed.buyer!.user.id });
  assert.equal(result.spot.state, "refunded");
  assert.deepEqual(sent.at(-1)?.signers, []);

  const delivered = await seedListing(db, {
    deadline: new Date(Date.now() - 48 * HOUR),
    deliveryDueAt: new Date(Date.now() - HOUR),
    funded: true,
  });
  await db.update(spots).set({ state: "delivered", proofSubmittedAt: new Date() }).where(eq(spots.id, delivered.spot.id));
  await assert.rejects(refundSpot(deps(), delivered.spot.id, { id: delivered.buyer!.user.id }), /can't be refunded/);
});


test("refunds return the rent to the platform rent payer, not the creator", async () => {
  const { seller, spot } = await seedListing(db, {
    deadline: new Date(Date.now() - 48 * HOUR),
    deliveryDueAt: new Date(Date.now() - HOUR),
    funded: true,
  });
  const platform = keypairSigner(Keypair.generate());
  await refundSpot(deps(platform), spot.id, { id: spot.buyerId! });
  const keys = sent[0].instructions.at(-1)!.keys;
  assert.ok(keys[2].pubkey.equals(platform.publicKey));
  assert.ok(keys[2].isWritable);
  assert.ok(!keys.some((key) => key.pubkey.toBase58() === seller.user.walletAddress));
});

test("admins close unsold spots after the deadline, signed by the platform rent payer", async () => {
  const { seller, listing, spot } = await seedListing(db, {
    deadline: new Date(Date.now() - HOUR),
    deliveryDueAt: new Date(Date.now() + 48 * HOUR),
  });
  const admin = await seedUser(db, "admin");
  const platform = keypairSigner(Keypair.generate());
  await assert.rejects(closeListing(deps(platform), admin.user.id, listing.id), /remaining spot/);
  const closedSpot = await closeSpot(deps(platform), admin.user.id, spot.id);
  assert.equal(closedSpot.spot.state, "cancelled");
  const closeIx = sent[0].instructions[1];
  assert.ok(closeIx.keys[0].pubkey.equals(platform.publicKey));
  assert.ok(closeIx.keys[0].isSigner);
  assert.equal(sent[0].actorId, admin.user.id);
  // Fee payer and rent payer are the same key, so no extra signer (and never the creator's wallet).
  assert.deepEqual(sent[0].signers, []);
  assert.ok(!closeIx.keys.some((key) => key.pubkey.toBase58() === seller.user.walletAddress));

  const closedListing = await closeListing(deps(platform), admin.user.id, listing.id);
  assert.equal(closedListing.listing.state, "closed");
  const listingIx = sent[1].instructions[0];
  assert.equal(listingIx.keys.length, 2);
  assert.ok(listingIx.keys[0].pubkey.equals(platform.publicKey));
  await assert.rejects(closeListing(deps(platform), admin.user.id, listing.id), /only live listings/);
});

test("a separate rent payer key co-signs closes", async () => {
  const { listing, spot } = await seedListing(db, {
    deadline: new Date(Date.now() - HOUR),
    deliveryDueAt: new Date(Date.now() + 48 * HOUR),
  });
  const admin = await seedUser(db, "admin");
  const rentPayer = keypairSigner(Keypair.generate());
  await closeSpot(deps(keypairSigner(Keypair.generate()), rentPayer), admin.user.id, spot.id);
  await closeListing(deps(keypairSigner(Keypair.generate()), rentPayer), admin.user.id, listing.id);
  assert.deepEqual(sent.map((request) => request.signers?.map((signer) => signer.publicKey.toBase58())), [
    [rentPayer.publicKey.toBase58()],
    [rentPayer.publicKey.toBase58()],
  ]);
});

test("spots still on sale close only when forced", async () => {
  const { spot } = await seedListing(db, {
    deadline: new Date(Date.now() + HOUR),
    deliveryDueAt: new Date(Date.now() + 48 * HOUR),
  });
  const admin = await seedUser(db, "admin");
  await assert.rejects(closeSpot(deps(), admin.user.id, spot.id), /still selling/);
  const forced = await closeSpot(deps(), admin.user.id, spot.id, { force: true });
  assert.equal(forced.spot.state, "cancelled");
});

test("funded spots cannot be closed", async () => {
  const { spot } = await seedListing(db, {
    deadline: new Date(Date.now() - HOUR),
    deliveryDueAt: new Date(Date.now() + 48 * HOUR),
    funded: true,
  });
  const admin = await seedUser(db, "admin");
  await assert.rejects(closeSpot(deps(), admin.user.id, spot.id, { force: true }), /unsold/);
});

test("the rent report lists closable spots and listings with on-chain lamports", async () => {
  const expired = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const selling = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const finished = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  await db.update(spots).set({ state: "cancelled" }).where(eq(spots.id, finished.spot.id));
  const funded = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR), funded: true });

  const lamports: Record<string, number> = {
    [expired.spot.chainAddress!]: 1_500_000,
    [expired.spot.vaultAddress!]: 2_000_000,
    [finished.listing.chainAddress!]: 3_000_000,
  };
  let reads = 0;
  const report = await rentReport({
    db,
    readLamports: async (addresses) => {
      reads += 1;
      return addresses.map((address) => lamports[address.toBase58()] ?? null);
    },
  });
  assert.equal(reads, 1);
  const spotIds = report.spots.map((item) => item.id);
  assert.ok(spotIds.includes(expired.spot.id));
  assert.ok(!spotIds.includes(selling.spot.id));
  assert.ok(!spotIds.includes(funded.spot.id));
  assert.equal(report.spots.find((item) => item.id === expired.spot.id)?.lamports, 3_500_000);
  const listingIds = report.listings.map((item) => item.id);
  assert.ok(listingIds.includes(finished.listing.id));
  assert.ok(!listingIds.includes(expired.listing.id));
  assert.ok(!listingIds.includes(funded.listing.id));
  assert.equal(report.listings.find((item) => item.id === finished.listing.id)?.lamports, 3_000_000);
  assert.ok(report.reclaimableLamports >= 6_500_000);
});

// ---------- second CertiK scan: optional seller account, rent payer read from chain ----------

// close_spot accounts: rent_payer, listing, spot, vault, seller_ata (optional), usdc_mint, token_program.
const SELLER_ATA = 4;

test("an empty spot closes without the creator's token account", async () => {
  const { seller, spot } = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const admin = await seedUser(db, "admin");
  const platform = keypairSigner(Keypair.generate());
  const base = deps(platform);
  let created = 0;
  const result = await closeSpot({ ...base, readVaultBalance: async () => 0n, accountExists: async () => (created++, false) }, admin.user.id, spot.id);
  assert.equal(result.spot.state, "cancelled");
  // Only close_spot: no token account is created for the creator.
  assert.equal(sent[0].instructions.length, 1);
  const closeIx = sent[0].instructions[0];
  // An omitted optional account is passed as the program ID.
  assert.ok(closeIx.keys[SELLER_ATA].pubkey.equals(base.program.programId));
  assert.ok(!closeIx.keys.some((key) => key.pubkey.toBase58() === seller.user.walletAddress));
  assert.equal(created, 0);
});

test("a spot holding a donation sweeps it to the creator's token account, created idempotently", async () => {
  const { spot } = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const admin = await seedUser(db, "admin");
  const base = deps();
  await closeSpot({ ...base, readVaultBalance: async () => 1n }, admin.user.id, spot.id);
  assert.equal(sent[0].instructions.length, 2);
  const [createAta, closeIx] = sent[0].instructions;
  assert.equal(createAta.data[0], 1);
  assert.ok(closeIx.keys[SELLER_ATA].pubkey.equals(createAta.keys[1].pubkey));
  assert.ok(closeIx.keys[SELLER_ATA].isWritable);
});

test("closes are refused while a listing still names a former reviewer key; refunds pay it back", async () => {
  const { listing, spot } = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const admin = await seedUser(db, "admin");
  const platform = keypairSigner(Keypair.generate());
  const former = Keypair.generate().publicKey;
  let payer = former;
  const chainDeps = (): RefundDeps => ({ ...deps(platform), readListingRentPayers: async (keys) => keys.map(() => payer) });
  await assert.rejects(closeSpot(chainDeps(), admin.user.id, spot.id), new RegExp(`rent payer is ${former.toBase58()}.*adopt listings`));
  assert.equal(sent.length, 0);
  // Gone from chain: left to reconciliation.
  await assert.rejects(closeSpot({ ...deps(platform), readListingRentPayers: async (keys) => keys.map(() => null) }, admin.user.id, spot.id), /no longer on-chain/);
  // Adopted: the server's key signs.
  payer = platform.publicKey;
  const closed = await closeSpot(chainDeps(), admin.user.id, spot.id);
  assert.equal(closed.spot.state, "cancelled");
  // The listing itself, once its spots are done, likewise.
  payer = former;
  await assert.rejects(closeListing(chainDeps(), admin.user.id, listing.id), /adopt listings/);
  payer = platform.publicKey;
  assert.equal((await closeListing(chainDeps(), admin.user.id, listing.id)).listing.state, "closed");

  // A refund needs no signature from the rent payer; it names the listing's current one.
  const funded = await seedListing(db, { deadline: new Date(Date.now() - 48 * HOUR), deliveryDueAt: new Date(Date.now() - HOUR), funded: true });
  payer = former;
  await refundSpot(chainDeps(), funded.spot.id, { id: funded.buyer!.user.id });
  const keys = sent.at(-1)!.instructions.at(-1)!.keys;
  assert.ok(keys[2].pubkey.equals(former) && keys[2].isWritable);
});

test("the rent report flags rent recorded to a former reviewer key", async () => {
  const ours = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const theirs = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const server = Keypair.generate().publicKey;
  const former = Keypair.generate().publicKey;
  const report = await rentReport({
    db,
    readLamports: async (addresses) => addresses.map(() => 1_000),
    serverRentPayer: server,
    readListingRentPayers: async (keys) => keys.map((key) => (key.toBase58() === theirs.listing.chainAddress ? former : server)),
  });
  const ourSpot = report.spots.find((item) => item.id === ours.spot.id)!;
  const theirSpot = report.spots.find((item) => item.id === theirs.spot.id)!;
  assert.deepEqual([ourSpot.rentPayer, ourSpot.needsAdoption], [server.toBase58(), false]);
  assert.deepEqual([theirSpot.rentPayer, theirSpot.needsAdoption], [former.toBase58(), true]);
  assert.equal(report.serverRentPayer, server.toBase58());
  assert.equal(report.needsAdoptionLamports, theirSpot.lamports);
  // Without the readers nothing is flagged.
  const plain = await rentReport({ db, readLamports: async (addresses) => addresses.map(() => 1_000) });
  assert.ok(plain.spots.every((item) => !item.needsAdoption));
  assert.equal(plain.needsAdoptionLamports, 0);
});
