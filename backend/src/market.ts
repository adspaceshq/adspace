import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { REVIEW_WINDOW_MS, TERMS_VERSION, payoutReleased, platformFeeBps } from "./types.js";
import { resolvePayoutReference } from "./payout.js";
import type { Bid, CreateListingRequest, Listing, ListingSummary, PayoutItem, PurchaseAssets, SellerDashboard, SessionUser, Spot } from "./types.js";

export interface MarketplaceRepository {
  migrate(): Promise<void>;
  summaries(): Promise<ListingSummary[]>;
  get(slug: string): Promise<Listing | undefined>;
  create(body: CreateListingRequest, seller: SessionUser): Promise<Listing>;
  update(slug: string, actorUserId: string, patch: { title?: string; story?: string }): Promise<Listing>;
  claim(spotId: string, buyer: SessionUser, assets?: PurchaseAssets): Promise<Spot>;
  placeBid(spotId: string, bidder: SessionUser, amount: number, assets?: PurchaseAssets): Promise<Spot>;
  close(slug: string, actorUserId: string): Promise<Listing>;
  reopen(slug: string, actorUserId: string): Promise<Listing>;
  remove(slug: string, actorUserId: string): Promise<{ ok: true }>;
  reviewQueue(): Promise<Listing[]>;
  approveReview(slug: string): Promise<Listing>;
  rejectReview(slug: string, reason: string): Promise<Listing>;
  acceptTerms(slug: string, actorUserId: string, version: string): Promise<Listing>;
  submitArtwork(spotId: string, actor: SessionUser, assets?: PurchaseAssets): Promise<Spot>;
  submitProof(spotId: string, actorUserId: string, proof: { photos: unknown; postUrl?: unknown }): Promise<Spot>;
  confirmSpot(spotId: string, actor: SessionUser): Promise<Spot>;
  disputeSpot(spotId: string, actor: SessionUser, reason: string): Promise<Spot>;
  withdrawDispute(spotId: string, actor: SessionUser): Promise<Spot>;
  payableQueue(): Promise<PayoutItem[]>;
  paySpot(spotId: string, reference: string): Promise<Spot>;
  approve(spotId: string, actorUserId: string): Promise<Spot>;
  reject(spotId: string, actorUserId: string): Promise<Spot>;
  fulfill(spotId: string, actorUserId: string): Promise<Spot>;
  dashboard(actorUserId: string): Promise<SellerDashboard>;
}

type ListingRow = {
  id: string; slug: string; title: string; seller_user_id: string; seller_handle: string;
  surface: string; story: string; image_url: string; fabric: string; mode: "fixed" | "auction"; currency: string;
  deadline: Date; artwork_close: string; min_increment: string | null; double_up: boolean; status: "active" | "approved" | "submitted" | "closed";
  review_note: string | null; terms_version: string | null; terms_accepted_at: Date | null;
};
type SpotRow = {
  id: string; listing_id: string; label: string; location: string; size: string; price: string;
  currency: string; view: string | null; website_url: string | null; logo_url: string | null;
  x: string | null; y: string | null; w: string | null;
  status: "open" | "claimed" | "sold"; buyer_handle: string | null; buyer_user_id: string | null;
  current_bid: string | null; claimed_at: Date | null; fulfilled_at: Date | null; artwork_submitted_at: Date | null;
  proof_photos: string[] | null; proof_post: string | null;
  confirmed_at: Date | null; disputed_at: Date | null; dispute_reason: string | null;
  paid_at: Date | null; payout_amount: string | null; payout_fee: string | null;
  payout_reference: string | null; payout_destination: string | null;
};

const n = (value: string | number | null | undefined) => value == null ? undefined : Number(value);
const slugify = (title: string) => title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "listing";
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

const MAX_LOGO_URL_LENGTH = 3_000_000;

/** Tee base color. Strict #rrggbb — anything else falls back to the default white. */
const parseFabric = (value: unknown): string =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : "#f6f6f7";

/** Seller surface photo. Empty stays empty (preset photos); otherwise a data:image URL under ~3 MB. */
function parseListingImage(value: unknown): string {
  const image = typeof value === "string" ? value.trim() : "";
  if (!image) return "";
  if (!image.startsWith("data:image/")) throw httpError("image must be an image upload", 400);
  if (image.length > MAX_LOGO_URL_LENGTH) throw httpError("image is too large", 400);
  return image;
}

/** Artwork due date. Empty stays empty; otherwise a parseable date. */
function parseArtworkClose(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw httpError("artwork close must be a valid date", 400);
  return parsed.toISOString();
}

/** Intake is locked once the artwork-close date passes (empty = no lock). */
function artworkLocked(artworkClose: string): boolean {
  if (!artworkClose) return false;
  const t = new Date(artworkClose).getTime();
  return !Number.isNaN(t) && t <= Date.now();
}

const MAX_PROOF_PHOTOS = 5;

/** Step 9 proof: 1–5 inline photos plus an optional X-post link. */
function parseProof(proof: { photos: unknown; postUrl?: unknown }): { photos: string[]; postUrl?: string } {
  const photos = Array.isArray(proof.photos) ? proof.photos : [];
  if (photos.length < 1 || photos.length > MAX_PROOF_PHOTOS) {
    throw httpError(`proof needs 1 to ${MAX_PROOF_PHOTOS} photos`, 400);
  }
  const clean = photos.map((p) => {
    const url = typeof p === "string" ? p.trim() : "";
    if (!url.startsWith("data:image/")) throw httpError("proof photos must be image uploads", 400);
    if (url.length > MAX_LOGO_URL_LENGTH) throw httpError("proof photo is too large", 400);
    return url;
  });
  const out: { photos: string[]; postUrl?: string } = { photos: clean };
  const postUrl = typeof proof.postUrl === "string" ? proof.postUrl.trim() : "";
  if (postUrl) {
    let host = "";
    try { host = new URL(postUrl).hostname.toLowerCase(); } catch { host = ""; }
    if (!/^https:\/\//i.test(postUrl) || !(host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com"))) {
      throw httpError("proof post must be an X post link", 400);
    }
    out.postUrl = postUrl;
  }
  return out;
}

/** Seller placement in % of the photo. Non-finite values fall back to auto layout. */
const placementNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;

/** Validate buyer brand assets. The logo is required at purchase — every sold spot carries art by construction. */
function parseBrandAssets(assets?: PurchaseAssets, opts: { requireLogo?: boolean } = {}): { website?: string; logoUrl?: string } {
  const out: { website?: string; logoUrl?: string } = {};
  const website = assets?.website?.trim() ?? "";
  if (website) {
    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(website)) throw httpError("website must be an http(s) URL", 400);
    out.website = website;
  }
  const logoUrl = assets?.logoUrl?.trim() ?? "";
  if (!logoUrl && opts.requireLogo) throw httpError("logo is required", 400);
  if (logoUrl) {
    if (!logoUrl.startsWith("data:image/")) throw httpError("logo must be an image upload", 400);
    if (logoUrl.length > MAX_LOGO_URL_LENGTH) throw httpError("logo is too large", 400);
    out.logoUrl = logoUrl;
  }
  return out;
}

export class PostgresMarketplaceRepository implements MarketplaceRepository {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS listings (
        id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, seller_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        seller_handle text NOT NULL, title text NOT NULL, surface text NOT NULL DEFAULT '', story text NOT NULL DEFAULT '',
        image_url text NOT NULL DEFAULT '', mode text NOT NULL CHECK (mode IN ('fixed','auction')),
        currency text NOT NULL DEFAULT 'USD', deadline timestamptz NOT NULL, artwork_close text NOT NULL DEFAULT '',
        min_increment numeric(14,2), double_up boolean NOT NULL DEFAULT false,
        status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('active','approved','submitted','closed')),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS spots (
        id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        label text NOT NULL, location text NOT NULL DEFAULT '', size text NOT NULL DEFAULT '',
        price numeric(14,2) NOT NULL CHECK (price > 0), currency text NOT NULL,
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','sold')),
        buyer_user_id uuid REFERENCES users(id) ON DELETE SET NULL, buyer_handle text,
        current_bid numeric(14,2), claimed_at timestamptz, fulfilled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS bids (
        id uuid PRIMARY KEY, spot_id uuid NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
        bidder_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, bidder_handle text NOT NULL,
        amount numeric(14,2) NOT NULL CHECK (amount > 0), created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS listings_seller_created_idx ON listings(seller_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS spots_listing_status_idx ON spots(listing_id, status);
      CREATE INDEX IF NOT EXISTS spots_buyer_user_id_idx ON spots(buyer_user_id);
      CREATE INDEX IF NOT EXISTS bids_spot_created_idx ON bids(spot_id, created_at);
      CREATE INDEX IF NOT EXISTS bids_bidder_user_id_idx ON bids(bidder_user_id);
      ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
      ALTER TABLE listings ADD CHECK (status IN ('active','approved','submitted','closed'));
      ALTER TABLE listings ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT '';
      ALTER TABLE listings ADD COLUMN IF NOT EXISTS terms_version text NOT NULL DEFAULT '';
      ALTER TABLE listings ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS artwork_submitted_at timestamptz;
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS proof_photos text[] NOT NULL DEFAULT '{}';
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS proof_post text NOT NULL DEFAULT '';
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS dispute_reason text NOT NULL DEFAULT '';
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS paid_at timestamptz;
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS payout_amount numeric(14,2);
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS payout_fee numeric(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS payout_reference text NOT NULL DEFAULT '';
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS payout_destination text NOT NULL DEFAULT '';
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS view text NOT NULL DEFAULT 'lid';
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS website_url text NOT NULL DEFAULT '';
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS logo_url text NOT NULL DEFAULT '';
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS x numeric(6,2);
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS y numeric(6,2);
      ALTER TABLE spots ADD COLUMN IF NOT EXISTS w numeric(6,2);
      ALTER TABLE listings ADD COLUMN IF NOT EXISTS fabric text NOT NULL DEFAULT '#f6f6f7';
      ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
      ALTER TABLE spots ENABLE ROW LEVEL SECURITY;
      ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
          REVOKE ALL ON listings, spots, bids FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
          REVOKE ALL ON listings, spots, bids FROM authenticated;
        END IF;
      END $$;
    `);
  }

  async summaries(): Promise<ListingSummary[]> {
    // Step 5: lazy deadline — ended actives drop out of the marketplace, no scheduler.
    const result = await this.pool.query(`SELECT l.id,l.slug,l.title,l.seller_handle,l.surface,l.image_url,l.mode,l.currency,
      COALESCE(MIN(s.price),0) AS from_price,
      COALESCE(SUM(CASE WHEN s.status <> 'open' THEN COALESCE(s.current_bid,s.price) ELSE 0 END),0) AS raised,
      COUNT(*) FILTER (WHERE s.status='open')::int AS open, COUNT(s.id)::int AS total
      FROM listings l LEFT JOIN spots s ON s.listing_id=l.id WHERE l.status='active' AND l.deadline > now()
      GROUP BY l.id ORDER BY l.created_at DESC`);
    return result.rows.map((r) => ({ id:r.id, slug:r.slug, title:r.title, seller:r.seller_handle, surface:r.surface, image:r.image_url, mode:r.mode, currency:r.currency, fromPrice:Number(r.from_price), raised:Number(r.raised), open:r.open, total:r.total }));
  }

  async get(slug: string): Promise<Listing | undefined> {
    const result = await this.pool.query<ListingRow>("SELECT * FROM listings WHERE slug=$1", [slug]);
    return result.rows[0] ? this.hydrate(result.rows[0]) : undefined;
  }

  async create(body: CreateListingRequest, seller: SessionUser): Promise<Listing> {
    const title = body.title.trim();
    if (!title) throw httpError("title is required", 400);
    const drafts = body.spots ?? [];
    if (drafts.length > 60) throw httpError("at most 60 spots per listing", 400);
    drafts.forEach((spot, i) => { if (!(Number(spot.price) > 0)) throw httpError(`spot ${i + 1}: price must be above zero`, 400); });
    let deadlineIso = new Date(Date.now() + 14 * 86_400_000).toISOString();
    if (body.deadline !== undefined && body.deadline !== "") {
      const parsed = new Date(body.deadline);
      if (Number.isNaN(parsed.getTime())) throw httpError("deadline must be a valid date", 400);
      if (parsed.getTime() <= Date.now()) throw httpError("deadline must be in the future", 400);
      deadlineIso = parsed.toISOString();
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      const slug = `${slugify(title)}-${id.slice(0, 8)}`;
      const mode = body.mode === "auction" ? "auction" : "fixed";
      const minIncrement = mode === "auction" ? Number(body.minIncrement ?? 1) : null;
      if (mode === "auction" && !(minIncrement! > 0)) throw httpError("auction minimum bid increment must be above zero", 400);
      const currency = body.currency?.trim().toUpperCase() || "USD";
      const fabric = parseFabric(body.fabric);
      const image = parseListingImage(body.image);
      const artworkClose = parseArtworkClose(body.artworkClose);
      // Step 2: submissions land as submitted — platform review activates them.
      await client.query(`INSERT INTO listings(id,slug,seller_user_id,seller_handle,title,surface,story,image_url,mode,currency,deadline,artwork_close,fabric,min_increment,double_up,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'submitted')`,
      [id,slug,seller.id,seller.handle,title,body.surface?.trim() ?? "",body.story?.trim() ?? "",image,mode,currency,deadlineIso,artworkClose,fabric,minIncrement,mode === "auction" && body.doubleUp === true]);
      for (let i=0;i<drafts.length;i++) {
        const spot=drafts[i];
        const view = spot.view === "inside" || spot.view === "tee-front" || spot.view === "tee-back" || spot.view === "tee-left" || spot.view === "tee-right" ? spot.view : "lid";
        await client.query(`INSERT INTO spots(id,listing_id,label,location,size,price,currency,view,x,y,w) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [randomUUID(),id,spot.label?.trim() || `Spot ${i+1}`,spot.location?.trim() ?? "",spot.size?.trim() ?? "",Number(spot.price),currency,view,placementNumber(spot.x),placementNumber(spot.y),placementNumber(spot.w)]);
      }
      await client.query("COMMIT");
      return (await this.get(slug))!;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async update(slug: string, actorUserId: string, patch: { title?: string; story?: string }): Promise<Listing> {
    if (patch.title !== undefined && !patch.title.trim()) throw httpError("title is required", 400);
    const result = await this.pool.query(`UPDATE listings SET title=COALESCE($3,title),story=COALESCE($4,story),updated_at=now()
      WHERE slug=$1 AND seller_user_id=$2 RETURNING slug`, [slug,actorUserId,patch.title?.trim() ?? null,patch.story?.trim() ?? null]);
    if (!result.rows[0]) await this.throwListingAccess(slug, actorUserId);
    return (await this.get(slug))!;
  }

  private async setStatus(slug: string, actorUserId: string, status: "active" | "approved" | "submitted" | "closed"): Promise<Listing> {
    const result = await this.pool.query(`UPDATE listings SET status=$3,updated_at=now()
      WHERE slug=$1 AND seller_user_id=$2 RETURNING slug`, [slug,actorUserId,status]);
    if (!result.rows[0]) await this.throwListingAccess(slug, actorUserId);
    return (await this.get(slug))!;
  }

  async close(slug: string, actorUserId: string): Promise<Listing> {
    return this.setStatus(slug, actorUserId, "closed");
  }

  async reopen(slug: string, actorUserId: string): Promise<Listing> {
    // Reopening resubmits for review — it must never self-publish.
    const current = await this.pool.query("SELECT status, seller_user_id FROM listings WHERE slug=$1", [slug]);
    const row = current.rows[0];
    if (!row) throw httpError("listing not found", 404);
    if (row.seller_user_id !== actorUserId) throw httpError("forbidden", 403);
    if (row.status === "submitted") throw httpError("listing is already submitted for review", 409);
    if (row.status === "active") return (await this.get(slug))!;
    await this.pool.query("UPDATE listings SET status='submitted', review_note='', updated_at=now() WHERE slug=$1", [slug]);
    return (await this.get(slug))!;
  }

  async acceptTerms(slug: string, actorUserId: string, version: string): Promise<Listing> {
    if (version !== TERMS_VERSION) throw httpError(`terms version ${version || "(missing)"} is stale — accept ${TERMS_VERSION}`, 400);
    const current = await this.pool.query("SELECT status, seller_user_id, deadline FROM listings WHERE slug=$1", [slug]);
    const row = current.rows[0];
    if (!row) throw httpError("listing not found", 404);
    if (row.seller_user_id !== actorUserId) throw httpError("forbidden", 403);
    if (row.status === "active") return (await this.get(slug))!;
    if (row.status !== "approved") throw httpError("listing is not approved yet", 409);
    if (new Date(row.deadline).getTime() <= Date.now()) throw httpError("deadline has passed — close and relist", 409);
    await this.pool.query(
      "UPDATE listings SET status='active', terms_version=$2, terms_accepted_at=now(), updated_at=now() WHERE slug=$1",
      [slug, TERMS_VERSION],
    );
    return (await this.get(slug))!;
  }

  async reviewQueue(): Promise<Listing[]> {
    const result = await this.pool.query<ListingRow>(
      "SELECT * FROM listings WHERE status='submitted' ORDER BY created_at DESC",
    );
    return Promise.all(result.rows.map((row) => this.hydrate(row)));
  }

  async approveReview(slug: string): Promise<Listing> {
    const result = await this.pool.query(
      `UPDATE listings SET status='approved', review_note='', updated_at=now()
       WHERE slug=$1 AND status='submitted' RETURNING slug`,
      [slug],
    );
    if (!result.rows[0]) await this.throwReviewAccess(slug);
    return (await this.get(slug))!;
  }

  async rejectReview(slug: string, reason: string): Promise<Listing> {
    const note = typeof reason === "string" ? reason.trim() : "";
    if (note.length > 500) throw httpError("reason must be at most 500 characters", 400);
    const result = await this.pool.query(
      `UPDATE listings SET status='closed', review_note=$2, updated_at=now()
       WHERE slug=$1 AND status='submitted' RETURNING slug`,
      [slug, note],
    );
    if (!result.rows[0]) await this.throwReviewAccess(slug);
    return (await this.get(slug))!;
  }

  private async throwReviewAccess(slug: string): Promise<never> {
    const existing = await this.pool.query("SELECT status FROM listings WHERE slug=$1", [slug]);
    throw httpError(
      !existing.rows[0] ? "listing not found" : "listing is not awaiting review",
      !existing.rows[0] ? 404 : 409,
    );
  }

  async remove(slug: string, actorUserId: string): Promise<{ ok: true }> {
    const owned = await this.pool.query("SELECT id, seller_user_id FROM listings WHERE slug=$1", [slug]);
    if (!owned.rows[0]) throw httpError("listing not found", 404);
    if (owned.rows[0].seller_user_id !== actorUserId) throw httpError("forbidden", 403);
    const activity = await this.pool.query(
      `SELECT 1 FROM spots WHERE listing_id=$1 AND (buyer_user_id IS NOT NULL OR current_bid IS NOT NULL) LIMIT 1`,
      [owned.rows[0].id],
    );
    if (activity.rows[0]) throw httpError("cannot delete a listing with buyers or bids — close it instead", 409);
    await this.pool.query("DELETE FROM listings WHERE id=$1", [owned.rows[0].id]);
    return { ok: true };
  }

  async claim(spotId: string, buyer: SessionUser, assets?: PurchaseAssets): Promise<Spot> {
    const brand = parseBrandAssets(assets, { requireLogo: true });
    const result = await this.pool.query(`UPDATE spots s SET status='claimed',buyer_user_id=$2,buyer_handle=$3,claimed_at=now(),updated_at=now(),
      website_url=$4,logo_url=$5
      FROM listings l WHERE s.id=$1 AND l.id=s.listing_id AND l.mode='fixed' AND l.status='active' AND l.deadline > now() AND s.status='open' AND l.seller_user_id<>$2 RETURNING s.id`, [spotId,buyer.id,buyer.handle,brand.website ?? "",brand.logoUrl ?? ""]);
    if (!result.rows[0]) await this.throwPurchaseAccess(spotId);
    return (await this.getSpot(spotId))!;
  }

  /** Failure-path diagnosis so ended listings report themselves instead of a generic 409. */
  private async throwPurchaseAccess(spotId: string): Promise<never> {
    const diag = await this.pool.query(
      `SELECT l.status, l.deadline FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1`,
      [spotId],
    );
    const row = diag.rows[0];
    if (!row) throw httpError("spot not found", 404);
    if (row.status === "active" && new Date(row.deadline).getTime() <= Date.now()) {
      throw httpError("listing has ended", 409);
    }
    throw httpError("spot is unavailable or belongs to you", 409);
  }

  async placeBid(spotId: string, bidder: SessionUser, amount: number, assets?: PurchaseAssets): Promise<Spot> {
    const brand = parseBrandAssets(assets, { requireLogo: true });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<SpotRow & { mode:string; min_increment:string|null; double_up:boolean; seller_user_id:string; deadline:Date }>(`SELECT s.*,l.mode,l.min_increment,l.double_up,l.seller_user_id,l.deadline
        FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1 AND l.status='active' FOR UPDATE OF s`, [spotId]);
      const spot=result.rows[0];
      if (!spot) throw httpError("spot not found",404);
      if (new Date(spot.deadline).getTime() <= Date.now()) throw httpError("listing has ended",409);
      if (spot.mode!=="auction" || spot.status!=="open" || spot.seller_user_id===bidder.id) throw httpError("spot is unavailable or belongs to you",409);
      const current=n(spot.current_bid); const required=current == null ? Number(spot.price) : spot.double_up ? current*2 : current+Number(spot.min_increment ?? 0);
      if (amount<required) throw httpError(`bid must be at least ${required} ${spot.currency}`,409);
      await client.query("INSERT INTO bids(id,spot_id,bidder_user_id,bidder_handle,amount) VALUES($1,$2,$3,$4,$5)",[randomUUID(),spotId,bidder.id,bidder.handle,amount]);
      await client.query("UPDATE spots SET current_bid=$2,buyer_user_id=$3,buyer_handle=$4,claimed_at=now(),updated_at=now(),website_url=$5,logo_url=$6 WHERE id=$1",[spotId,amount,bidder.id,bidder.handle,brand.website ?? "",brand.logoUrl ?? ""]);
      await client.query("COMMIT");
      return (await this.getSpot(spotId))!;
    } catch(error){await client.query("ROLLBACK");throw error;} finally{client.release();}
  }

  async submitArtwork(spotId: string, actor: SessionUser, assets?: PurchaseAssets): Promise<Spot> {
    const brand = parseBrandAssets(assets);
    if (!brand.website && !brand.logoUrl) throw httpError("artwork is required", 400);
    const found = await this.pool.query<SpotRow & { artwork_close: string }>(
      `SELECT s.*, l.artwork_close FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1`,
      [spotId],
    );
    const row = found.rows[0];
    if (!row) throw httpError("spot not found", 404);
    if (row.status !== "sold") throw httpError("artwork intake opens once the spot is sold", 409);
    if (!row.buyer_user_id || row.buyer_user_id !== actor.id) throw httpError("only the buyer can submit artwork", 403);
    if (artworkLocked(row.artwork_close)) throw httpError("artwork window has closed", 409);
    await this.pool.query(
      `UPDATE spots SET website_url=COALESCE(NULLIF($2,''),website_url), logo_url=COALESCE(NULLIF($3,''),logo_url),
        artwork_submitted_at=now(), updated_at=now() WHERE id=$1`,
      [spotId, brand.website ?? "", brand.logoUrl ?? ""],
    );
    return (await this.getSpot(spotId))!;
  }

  async submitProof(spotId: string, actorUserId: string, proof: { photos: unknown; postUrl?: unknown }): Promise<Spot> {
    const parsed = parseProof(proof);
    const owned = await this.pool.query("SELECT seller_user_id, status, fulfilled_at FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1", [spotId]);
    const row = owned.rows[0];
    if (!row) throw httpError("spot not found", 404);
    if (row.seller_user_id !== actorUserId) throw httpError("forbidden", 403);
    if (row.status !== "sold" || !row.fulfilled_at) throw httpError("fulfill the spot before uploading proof", 409);
    await this.pool.query("UPDATE spots SET proof_photos=$2, proof_post=$3, updated_at=now() WHERE id=$1",
      [spotId, parsed.photos, parsed.postUrl ?? ""]);
    return (await this.getSpot(spotId))!;
  }

  /** Buyer receipt: confirm (idempotent), dispute (replaces reason), withdraw. Fulfilled-only, buyer-only. */
  private async buyerSpot(spotId: string, actor: SessionUser) {
    const found = await this.pool.query<SpotRow & { artwork_close: string }>(
      `SELECT s.* FROM spots s WHERE s.id=$1`, [spotId],
    );
    const row = found.rows[0];
    if (!row) throw httpError("spot not found", 404);
    if (row.status !== "sold" || !row.fulfilled_at) throw httpError("spots open for review once delivered", 409);
    const mine = row.buyer_handle === actor.handle || row.buyer_user_id === actor.id;
    if (!row.buyer_handle || !mine) throw httpError("only the buyer can review delivery", 403);
    return row;
  }

  async confirmSpot(spotId: string, actor: SessionUser): Promise<Spot> {
    const row = await this.buyerSpot(spotId, actor);
    if (row.disputed_at) throw httpError("withdraw the dispute first", 409);
    await this.pool.query("UPDATE spots SET confirmed_at=COALESCE(confirmed_at,now()), updated_at=now() WHERE id=$1", [spotId]);
    return (await this.getSpot(spotId))!;
  }

  async disputeSpot(spotId: string, actor: SessionUser, reason: string): Promise<Spot> {
    const row = await this.buyerSpot(spotId, actor);
    if (row.confirmed_at) throw httpError("already confirmed", 409);
    const note = typeof reason === "string" ? reason.trim() : "";
    if (note.length > 500) throw httpError("reason must be at most 500 characters", 400);
    await this.pool.query("UPDATE spots SET disputed_at=COALESCE(disputed_at,now()), dispute_reason=$2, updated_at=now() WHERE id=$1",
      [spotId, note]);
    return (await this.getSpot(spotId))!;
  }

  async withdrawDispute(spotId: string, actor: SessionUser): Promise<Spot> {
    await this.buyerSpot(spotId, actor);
    await this.pool.query("UPDATE spots SET disputed_at=NULL, dispute_reason='', updated_at=now() WHERE id=$1", [spotId]);
    return (await this.getSpot(spotId))!;
  }

  async payableQueue(): Promise<PayoutItem[]> {
    const result = await this.pool.query(
      `SELECT s.id spot_id, l.id listing_id, l.slug listing_slug, l.title listing_title, s.label spot_label,
        l.seller_handle seller, s.buyer_handle buyer, COALESCE(s.current_bid, s.price) amount, s.currency,
        s.confirmed_at, s.fulfilled_at
       FROM spots s JOIN listings l ON l.id=s.listing_id
       WHERE s.status='sold' AND s.fulfilled_at IS NOT NULL AND s.paid_at IS NULL AND s.disputed_at IS NULL
         AND (s.confirmed_at IS NOT NULL OR s.fulfilled_at <= now() - ($1 || ' milliseconds')::interval)
       ORDER BY s.fulfilled_at`,
      [String(REVIEW_WINDOW_MS)],
    );
    return result.rows.map((r) => {
      const base = r.confirmed_at ? new Date(r.confirmed_at).getTime() : new Date(r.fulfilled_at).getTime() + REVIEW_WINDOW_MS;
      return {
        spotId: r.spot_id, listingId: r.listing_id, listingSlug: r.listing_slug, listingTitle: r.listing_title,
        spotLabel: r.spot_label, seller: r.seller_handle, buyer: r.buyer_handle,
        amount: Number(r.amount), currency: r.currency, releasedAt: new Date(base).toISOString(),
      };
    });
  }

  async paySpot(spotId: string, reference: string): Promise<Spot> {
    if (typeof reference === "string" && reference.trim().length > 200) {
      throw httpError("reference must be at most 200 characters", 400);
    }
    const found = await this.pool.query<SpotRow & { seller_payout_wallet: string | null }>(
      `SELECT s.*, u.payout_wallet AS seller_payout_wallet FROM spots s
       JOIN listings l ON l.id=s.listing_id LEFT JOIN users u ON u.id=l.seller_user_id WHERE s.id=$1`,
      [spotId],
    );
    const row = found.rows[0];
    if (!row) throw httpError("spot not found", 404);
    if (row.status !== "sold" || !row.fulfilled_at) throw httpError("only delivered spots can be paid", 409);
    if (row.paid_at) return (await this.getSpot(spotId))!;
    if (!payoutReleased({
      fulfilledAt: row.fulfilled_at?.toISOString(), confirmedAt: row.confirmed_at?.toISOString(),
      disputedAt: row.disputed_at?.toISOString(),
    })) throw httpError("spot is not released for payout", 409);
    if (!row.seller_payout_wallet) throw httpError("seller payout wallet is not set", 409);
    const amount = Number(row.current_bid ?? row.price);
    const fee = Math.round(amount * (platformFeeBps() / 10_000) * 100) / 100;
    // Manual USDC: the reference is the Solana transfer signature; verified
    // on-chain when it looks like one and an RPC is configured (required
    // when PAYOUT_REQUIRE_ONCHAIN=1).
    const note = await resolvePayoutReference({
      reference,
      destination: row.seller_payout_wallet,
      expectedNet: Math.round((amount - fee) * 100) / 100,
    });
    await this.pool.query(
      `UPDATE spots SET paid_at=now(), payout_amount=$2, payout_fee=$3, payout_reference=$4, payout_destination=$5, updated_at=now() WHERE id=$1`,
      [spotId, amount, fee, note, row.seller_payout_wallet],
    );
    return (await this.getSpot(spotId))!;
  }

  async approve(spotId:string, actorUserId:string):Promise<Spot>{
    const result=await this.pool.query(`UPDATE spots s SET status='sold',updated_at=now() FROM listings l
      WHERE s.id=$1 AND l.id=s.listing_id AND l.seller_user_id=$2 AND s.buyer_user_id IS NOT NULL AND s.status IN('open','claimed') RETURNING s.id`,[spotId,actorUserId]);
    if(!result.rows[0])await this.throwSpotAccess(spotId,actorUserId);
    return(await this.getSpot(spotId))!;
  }
  async reject(spotId:string, actorUserId:string):Promise<Spot>{
    const client=await this.pool.connect();
    try{await client.query("BEGIN");const result=await client.query(`UPDATE spots s SET status='open',buyer_user_id=NULL,buyer_handle=NULL,current_bid=NULL,claimed_at=NULL,updated_at=now()
      FROM listings l WHERE s.id=$1 AND l.id=s.listing_id AND l.seller_user_id=$2 AND s.buyer_user_id IS NOT NULL AND s.status IN('open','claimed') RETURNING s.id`,[spotId,actorUserId]);
      if(!result.rows[0]){const access=await client.query("SELECT l.seller_user_id FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1",[spotId]);throw httpError(!access.rows[0]?"spot not found":access.rows[0].seller_user_id!==actorUserId?"forbidden":"spot is not in the required state",!access.rows[0]?404:access.rows[0].seller_user_id!==actorUserId?403:409);}await client.query("DELETE FROM bids WHERE spot_id=$1",[spotId]);await client.query("COMMIT");return(await this.getSpot(spotId))!;
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  async fulfill(spotId:string, actorUserId:string):Promise<Spot>{
    const result=await this.pool.query(`UPDATE spots s SET fulfilled_at=now(),updated_at=now() FROM listings l
      WHERE s.id=$1 AND l.id=s.listing_id AND l.seller_user_id=$2 AND s.status='sold' RETURNING s.id`,[spotId,actorUserId]);
    if(!result.rows[0]) await this.throwSpotAccess(spotId,actorUserId);
    return (await this.getSpot(spotId))!;
  }

  async dashboard(actorUserId:string):Promise<SellerDashboard>{
    const listings=await this.pool.query(`SELECT l.id,l.slug,l.title,l.image_url,l.status,l.review_note,l.deadline,l.mode,l.currency,
      COUNT(s.id)::int total,COUNT(*) FILTER(WHERE s.status='open' AND s.buyer_user_id IS NULL)::int open,COUNT(*) FILTER(WHERE s.status='sold')::int sold,
      COUNT(*) FILTER(WHERE s.paid_at IS NOT NULL)::int paid,
      COALESCE(SUM(CASE WHEN s.status='sold' THEN COALESCE(s.current_bid,s.price) ELSE 0 END),0) revenue,
      COALESCE(SUM(CASE WHEN s.paid_at IS NOT NULL THEN COALESCE(s.payout_amount,0) - COALESCE(s.payout_fee,0) ELSE 0 END),0) paid_out
      FROM listings l LEFT JOIN spots s ON s.listing_id=l.id WHERE l.seller_user_id=$1 GROUP BY l.id ORDER BY l.created_at DESC`,[actorUserId]);
    const attention=await this.pool.query(`SELECT s.id spot_id,l.id listing_id,l.slug listing_slug,l.title listing_title,s.label spot_label,
      s.buyer_handle buyer,COALESCE(s.current_bid,s.price) amount,s.currency,s.claimed_at submitted_at,
      CASE WHEN s.disputed_at IS NOT NULL THEN 'disputed' WHEN s.status='claimed' THEN 'pending' WHEN s.fulfilled_at IS NOT NULL THEN 'delivered' ELSE 'approved' END status,
      (s.artwork_submitted_at IS NOT NULL) AS artwork_received, s.dispute_reason
      FROM spots s JOIN listings l ON l.id=s.listing_id WHERE l.seller_user_id=$1 AND s.buyer_user_id IS NOT NULL
      AND ((s.status IN('open','claimed') AND s.claimed_at IS NOT NULL)
        OR (s.status='sold' AND (s.fulfilled_at IS NULL OR CARDINALITY(s.proof_photos) = 0))
        OR (s.disputed_at IS NOT NULL)) ORDER BY s.claimed_at DESC`,[actorUserId]);
    const rows=listings.rows.map(r=>({id:r.id,slug:r.slug,title:r.title,image:r.image_url,status:r.status,deadline:new Date(r.deadline).toISOString(),reviewNote:r.review_note || undefined,mode:r.mode,currency:r.currency,sold:r.sold,open:r.open,total:r.total,paid:r.paid,revenue:Number(r.revenue)}));
    const pending=attention.rows.filter(r=>r.status==="pending").length;
    const live = (r: { status: string; deadline: string }) => r.status === "active" && new Date(r.deadline).getTime() > Date.now();
    return {summary:{activeListings:rows.filter(live).length,openSpots:rows.reduce((a,r)=>a+r.open,0),pendingApproval:pending,revenue:rows.reduce((a,r)=>a+r.revenue,0),paidOut:listings.rows.reduce((a,r)=>a+Number(r.paid_out),0),currency:rows[0]?.currency ?? "USD"},listings:rows,attention:attention.rows.map(r=>({spotId:r.spot_id,listingId:r.listing_id,listingSlug:r.listing_slug,listingTitle:r.listing_title,spotLabel:r.spot_label,buyer:r.buyer,amount:Number(r.amount),currency:r.currency,submittedAt:new Date(r.submitted_at).toISOString(),status:r.status,artworkReceived:Boolean(r.artwork_received),disputeReason:r.dispute_reason || undefined}))};
  }

  private async hydrate(row:ListingRow):Promise<Listing>{
    const spotsResult=await this.pool.query<SpotRow>("SELECT * FROM spots WHERE listing_id=$1 ORDER BY created_at,id",[row.id]);
    const ids=spotsResult.rows.map(s=>s.id); const bids=new Map<string,Bid[]>();
    if(ids.length){const br=await this.pool.query("SELECT spot_id,bidder_handle,amount,created_at FROM bids WHERE spot_id=ANY($1) ORDER BY created_at",[ids]);for(const b of br.rows)bids.set(b.spot_id,[...(bids.get(b.spot_id)??[]),{bidder:b.bidder_handle,amount:Number(b.amount),at:new Date(b.created_at).toISOString()}]);}
    return {id:row.id,slug:row.slug,title:row.title,seller:row.seller_handle,sellerHandle:row.seller_handle,sellerUserId:row.seller_user_id,surface:row.surface,story:row.story,image:row.image_url,fabric:row.fabric ?? "#f6f6f7",mode:row.mode,currency:row.currency,deadline:new Date(row.deadline).toISOString(),artworkClose:row.artwork_close,minIncrement:n(row.min_increment),doubleUp:row.double_up,status:row.status,reviewNote:row.review_note || undefined,termsVersion:row.terms_version || undefined,termsAcceptedAt:row.terms_accepted_at?.toISOString(),spots:spotsResult.rows.map(s=>this.mapSpot(s,bids.get(s.id)??[]))};
  }
  private mapSpot(s:SpotRow,bids:Bid[]=[]):Spot{return{id:s.id,listingId:s.listing_id,label:s.label,location:s.location,size:s.size,price:Number(s.price),currency:s.currency,view:s.view ?? "lid",x:n(s.x),y:n(s.y),w:n(s.w),website:s.website_url || undefined,logoUrl:s.logo_url || undefined,status:s.status,currentBid:n(s.current_bid),buyer:s.buyer_handle??undefined,bids,fulfilledAt:s.fulfilled_at?.toISOString(),artworkSubmittedAt:s.artwork_submitted_at?.toISOString(),proofPhotos:(s.proof_photos?.length ? [...s.proof_photos] : undefined),proofPost:s.proof_post || undefined,confirmedAt:s.confirmed_at?.toISOString(),disputedAt:s.disputed_at?.toISOString(),disputeReason:s.dispute_reason || undefined,paidAt:s.paid_at?.toISOString(),payoutAmount:n(s.payout_amount),payoutFee:n(s.payout_fee) ?? 0,payoutReference:s.payout_reference || undefined,payoutDestination:s.payout_destination || undefined};}
  private async getSpot(id:string):Promise<Spot|undefined>{const r=await this.pool.query<SpotRow>("SELECT * FROM spots WHERE id=$1",[id]);if(!r.rows[0])return undefined;const b=await this.pool.query("SELECT bidder_handle,amount,created_at FROM bids WHERE spot_id=$1 ORDER BY created_at",[id]);return this.mapSpot(r.rows[0],b.rows.map(x=>({bidder:x.bidder_handle,amount:Number(x.amount),at:new Date(x.created_at).toISOString()})));}
  private async ownerTransition(id:string,userId:string,from:string,to:string):Promise<Spot>{const r=await this.pool.query(`UPDATE spots s SET status=$4,updated_at=now() FROM listings l WHERE s.id=$1 AND l.id=s.listing_id AND l.seller_user_id=$2 AND s.status=$3 RETURNING s.id`,[id,userId,from,to]);if(!r.rows[0])await this.throwSpotAccess(id,userId);return(await this.getSpot(id))!;}
  private async throwListingAccess(slug:string,userId:string):Promise<never>{const r=await this.pool.query("SELECT seller_user_id FROM listings WHERE slug=$1",[slug]);throw httpError(!r.rows[0]?"listing not found":r.rows[0].seller_user_id!==userId?"forbidden":"listing cannot be updated",!r.rows[0]?404:r.rows[0].seller_user_id!==userId?403:409);}
  private async throwSpotAccess(id:string,userId:string):Promise<never>{const r=await this.pool.query("SELECT l.seller_user_id FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1",[id]);throw httpError(!r.rows[0]?"spot not found":r.rows[0].seller_user_id!==userId?"forbidden":"spot is not in the required state",!r.rows[0]?404:r.rows[0].seller_user_id!==userId?403:409);}
}
