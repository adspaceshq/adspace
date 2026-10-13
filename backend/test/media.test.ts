import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Db } from "../src/db/client.js";
import { createTestDb } from "./helpers/db.js";
import { seedUser } from "./helpers/seed.js";

// cloudinary.ts reads its settings at import time, so set them before loading the service.
process.env.CLOUDINARY_CLOUD_NAME = "adspaces-test";
process.env.CLOUDINARY_UPLOAD_FOLDER = "adspaces";
const { parseAssetKind, registerMedia } = await import("../src/services/media.js");

let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

const good = "https://res.cloudinary.com/adspaces-test/image/upload/v1/adspaces/posts/stickers-on-lid.jpg";

test("asset kinds are validated", () => {
  assert.equal(parseAssetKind("post_media"), "post_media");
  assert.throws(() => parseAssetKind("video"), /kind must be/);
});

test("only our own uploads in the right folder are accepted", async () => {
  const { user } = await seedUser(db);
  const asset = await registerMedia(db, user.id, "post_media", { url: good, bytes: 2048, width: 1200, height: 800 });
  assert.equal(asset.kind, "post_media");
  assert.equal(asset.width, 1200);
  await assert.rejects(
    registerMedia(db, user.id, "post_media", { url: "https://res.cloudinary.com/other/image/upload/adspaces/posts/a.jpg", bytes: 1 }),
    /through adspaces/,
  );
  await assert.rejects(registerMedia(db, user.id, "listing_photo", { url: good, bytes: 1 }), /through adspaces/);
  await assert.rejects(registerMedia(db, user.id, "post_media", { url: good.replace("on-lid", "on lid"), bytes: 1 }), /through adspaces/);
  await assert.rejects(registerMedia(db, user.id, "post_media", { url: good, bytes: 20 * 1024 * 1024 }), /15MB/);
});
