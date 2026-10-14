import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { createListingInstructions, deriveListingAddresses, slugHash } from "../src/adspaces-program.js";
import type { Listing } from "../src/types.js";

const programId = new PublicKey("8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5");
const seller = new PublicKey("414exgwxaeBSjajy42RKbmRqKn6o8YesDkGFwnxZNgvn");

test("derives stable protocol addresses", () => {
  const first = deriveListingAddresses(programId, seller, "event-shirt", 2);
  const second = deriveListingAddresses(programId, seller, "event-shirt", 2);
  assert.equal(slugHash("event-shirt").length, 16);
  assert.equal(first.listing.toBase58(), second.listing.toBase58());
  assert.equal(first.spots.length, 2);
  assert.notEqual(first.spots[0].spot.toBase58(), first.spots[1].spot.toBase58());
});

test("builds one listing instruction followed by each spot", () => {
  const listing = {
    id: "listing-id",
    slug: "event-shirt",
    title: "Event shirt",
    seller: "seller",
    sellerHandle: "seller",
    surface: "shirt",
    story: "",
    image: "",
    fabric: "#ffffff",
    mode: "fixed",
    currency: "USDC",
    deadline: "2030-01-01T00:00:00.000Z",
    artworkClose: "2030-01-02T00:00:00.000Z",
    status: "submitted",
    spots: [
      { id: "one", listingId: "listing-id", label: "Front", location: "", size: "", price: 10, currency: "USDC", view: "tee-front", status: "open" },
      { id: "two", listingId: "listing-id", label: "Back", location: "", size: "", price: 20, currency: "USDC", view: "tee-back", status: "open" },
    ],
  } satisfies Listing;
  const result = createListingInstructions({
    programId,
    usdcMint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
    seller,
    reviewer: seller,
    listing,
    metadataUri: "https://adspaces.fun/seller/event-shirt",
    policy: {
      feeBps: 250,
      upliftFeeBps: 0,
      maxFeeBps: 250,
      reviewWindowSeconds: 172800,
      deliveryDeadline: "2030-01-09T00:00:00.000Z",
    },
  });
  assert.equal(result.instructions.length, 3);
  assert.equal(result.addresses.spots.length, 2);
  assert.deepEqual([...result.instructions[0].data.subarray(0, 8)], [18, 168, 45, 24, 191, 31, 117, 54]);
});
