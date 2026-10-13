import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Db } from "../src/db/client.js";
import { bids } from "../src/db/schema.js";
import { spotBidHistory } from "../src/services/bid-history.js";
import { createTestDb } from "./helpers/db.js";
import { seedListing, seedUser, USDC } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

test("bid history is newest first, numbers bidders, marks the viewer and the leader, shows public profiles, and hides ids and wallets", async () => {
  const { spot, buyer } = await seedListing(db, { mode: "auction", deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR), funded: true });
  const rival = await seedUser(db, "rival");
  const base = Date.now() - 3 * HOUR;
  await db.insert(bids).values([
    { spotId: spot.id, bidderId: rival.user.id, bidderWallet: rival.user.walletAddress!, amount: 10n * USDC, createdAt: new Date(base) },
    { spotId: spot.id, bidderId: buyer!.user.id, bidderWallet: buyer!.user.walletAddress!, amount: 20n * USDC, createdAt: new Date(base + HOUR) },
    { spotId: spot.id, bidderId: rival.user.id, bidderWallet: rival.user.walletAddress!, amount: 30n * USDC, createdAt: new Date(base + 2 * HOUR) },
  ]);

  const history = await spotBidHistory(db, spot.id, buyer!.user.id);
  assert.equal(history?.bidders, 2);
  assert.deepEqual(
    history?.items.map((item) => [item.amount, item.bidder, item.isYou, item.isTop]),
    [
      [30n * USDC, "bidder 1", false, true],
      [20n * USDC, "bidder 2", true, false],
      [10n * USDC, "bidder 1", false, false],
    ],
  );
  const body = JSON.stringify(history, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  assert.equal(body.includes(rival.user.id) || body.includes(rival.user.walletAddress!), false);
  // Each bid links to the bidder's public adspaces profile, and nothing more.
  assert.equal(history?.items[0].profile?.handle, rival.user.handle);
  assert.deepEqual(Object.keys(history?.items[0].profile ?? {}).sort(), ["avatarUrl", "displayName", "handle"]);
  assert.equal(await spotBidHistory(db, "not-a-uuid"), undefined);
});
