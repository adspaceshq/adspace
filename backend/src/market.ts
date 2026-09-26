import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Bid, CreateListingRequest, Listing, ListingSummary, PurchaseAssets, SellerDashboard, SessionUser, Spot } from "./types.js";

export interface MarketplaceRepository {
  migrate(): Promise<void>;
  summaries(): Promise<ListingSummary[]>;
  get(slug: string): Promise<Listing | undefined>;
  create(body: CreateListingRequest, seller: SessionUser): Promise<Listing>;
  update(slug: string, actorUserId: string, patch: { title?: string; story?: string }): Promise<Listing>;
  claim(spotId: string, buyer: SessionUser): Promise<Spot>;
  placeBid(spotId: string, bidder: SessionUser, amount: number): Promise<Spot>;
  approve(spotId: string, actorUserId: string): Promise<Spot>;
  reject(spotId: string, actorUserId: string): Promise<Spot>;
  fulfill(spotId: string, actorUserId: string): Promise<Spot>;
  dashboard(actorUserId: string): Promise<SellerDashboard>;
}

type ListingRow = {
  id: string; slug: string; title: string; seller_user_id: string; seller_handle: string;
  surface: string; story: string; image_url: string; mode: "fixed" | "auction"; currency: string;
  deadline: Date; artwork_close: string; min_increment: string | null; double_up: boolean; status: "active" | "closed";
};
type SpotRow = {
  id: string; listing_id: string; label: string; location: string; size: string; price: string;
  currency: string; view: string | null; website_url: string | null; logo_url: string | null;
  x: string | null; y: string | null; w: string | null;
  status: "open" | "claimed" | "sold"; buyer_handle: string | null;
  current_bid: string | null; claimed_at: Date | null; fulfilled_at: Date | null;
};

const n = (value: string | number | null | undefined) => value == null ? undefined : Number(value);
const slugify = (title: string) => title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "listing";
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

const MAX_LOGO_URL_LENGTH = 3_000_000;

/** Seller placement in % of the photo. Non-finite values fall back to auto layout. */
const placementNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;

/** Validate buyer brand assets. Empty/absent stays absent; anything malformed is a 400. */
function parseBrandAssets(assets?: PurchaseAssets): { website?: string; logoUrl?: string } {
  const out: { website?: string; logoUrl?: string } = {};
  const website = assets?.website?.trim() ?? "";
  if (website) {
    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(website)) throw httpError("website must be an http(s) URL", 400);
    out.website = website;
  }
  const logoUrl = assets?.logoUrl?.trim() ?? "";
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
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
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
    const result = await this.pool.query(`SELECT l.id,l.slug,l.title,l.seller_handle,l.surface,l.image_url,l.mode,l.currency,
      COALESCE(MIN(s.price),0) AS from_price,
      COALESCE(SUM(CASE WHEN s.status <> 'open' THEN COALESCE(s.current_bid,s.price) ELSE 0 END),0) AS raised,
      COUNT(*) FILTER (WHERE s.status='open')::int AS open, COUNT(s.id)::int AS total
      FROM listings l LEFT JOIN spots s ON s.listing_id=l.id WHERE l.status='active'
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
      const currency = body.currency?.trim().toUpperCase() || "USD";
      await client.query(`INSERT INTO listings(id,slug,seller_user_id,seller_handle,title,surface,story,mode,currency,deadline,artwork_close)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id,slug,seller.id,seller.handle,title,body.surface?.trim() ?? "",body.story?.trim() ?? "",mode,currency,deadlineIso,body.artworkClose?.trim() ?? ""]);
      for (let i=0;i<drafts.length;i++) {
        const spot=drafts[i];
        const view = spot.view === "inside" || spot.view === "tee-front" || spot.view === "tee-back" ? spot.view : "lid";
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

  async claim(spotId: string, buyer: SessionUser): Promise<Spot> {
    const result = await this.pool.query(`UPDATE spots s SET status='claimed',buyer_user_id=$2,buyer_handle=$3,claimed_at=now(),updated_at=now()
      FROM listings l WHERE s.id=$1 AND l.id=s.listing_id AND l.mode='fixed' AND l.status='active' AND s.status='open' AND l.seller_user_id<>$2 RETURNING s.id`, [spotId,buyer.id,buyer.handle]);
    if (!result.rows[0]) throw httpError("spot is unavailable or belongs to you", 409);
    return (await this.getSpot(spotId))!;
  }

  async placeBid(spotId: string, bidder: SessionUser, amount: number): Promise<Spot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<SpotRow & { mode:string; min_increment:string|null; double_up:boolean; seller_user_id:string }>(`SELECT s.*,l.mode,l.min_increment,l.double_up,l.seller_user_id
        FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1 AND l.status='active' FOR UPDATE OF s`, [spotId]);
      const spot=result.rows[0];
      if (!spot) throw httpError("spot not found",404);
      if (spot.mode!=="auction" || spot.status!=="open" || spot.seller_user_id===bidder.id) throw httpError("spot is unavailable or belongs to you",409);
      const current=n(spot.current_bid); const required=current == null ? Number(spot.price) : spot.double_up ? current*2 : current+Number(spot.min_increment ?? 0);
      if (amount<required) throw httpError(`bid must be at least ${required} ${spot.currency}`,409);
      await client.query("INSERT INTO bids(id,spot_id,bidder_user_id,bidder_handle,amount) VALUES($1,$2,$3,$4,$5)",[randomUUID(),spotId,bidder.id,bidder.handle,amount]);
      await client.query("UPDATE spots SET current_bid=$2,buyer_user_id=$3,buyer_handle=$4,claimed_at=now(),updated_at=now(),website_url=$5,logo_url=$6 WHERE id=$1",[spotId,amount,bidder.id,bidder.handle,brand.website ?? "",brand.logoUrl ?? ""]);
      await client.query("COMMIT");
      return (await this.getSpot(spotId))!;
    } catch(error){await client.query("ROLLBACK");throw error;} finally{client.release();}
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
    const listings=await this.pool.query(`SELECT l.id,l.slug,l.title,l.image_url,l.status,l.mode,l.currency,
      COUNT(s.id)::int total,COUNT(*) FILTER(WHERE s.status='open' AND s.buyer_user_id IS NULL)::int open,COUNT(*) FILTER(WHERE s.status='sold')::int sold,
      COALESCE(SUM(CASE WHEN s.status='sold' THEN COALESCE(s.current_bid,s.price) ELSE 0 END),0) revenue
      FROM listings l LEFT JOIN spots s ON s.listing_id=l.id WHERE l.seller_user_id=$1 GROUP BY l.id ORDER BY l.created_at DESC`,[actorUserId]);
    const attention=await this.pool.query(`SELECT s.id spot_id,l.id listing_id,l.slug listing_slug,l.title listing_title,s.label spot_label,
      s.buyer_handle buyer,COALESCE(s.current_bid,s.price) amount,s.currency,s.claimed_at submitted_at,
      CASE WHEN s.status='claimed' THEN 'pending' ELSE 'approved' END status
      FROM spots s JOIN listings l ON l.id=s.listing_id WHERE l.seller_user_id=$1 AND s.buyer_user_id IS NOT NULL
      AND ((s.status IN('open','claimed') AND s.claimed_at IS NOT NULL) OR (s.status='sold' AND s.fulfilled_at IS NULL)) ORDER BY s.claimed_at DESC`,[actorUserId]);
    const rows=listings.rows.map(r=>({id:r.id,slug:r.slug,title:r.title,image:r.image_url,status:r.status,mode:r.mode,currency:r.currency,sold:r.sold,open:r.open,total:r.total,revenue:Number(r.revenue)}));
    const pending=attention.rows.filter(r=>r.status==="pending").length;
    return {summary:{activeListings:rows.filter(r=>r.status==="active").length,openSpots:rows.reduce((a,r)=>a+r.open,0),pendingApproval:pending,revenue:rows.reduce((a,r)=>a+r.revenue,0),currency:rows[0]?.currency ?? "USD"},listings:rows,attention:attention.rows.map(r=>({spotId:r.spot_id,listingId:r.listing_id,listingSlug:r.listing_slug,listingTitle:r.listing_title,spotLabel:r.spot_label,buyer:r.buyer,amount:Number(r.amount),currency:r.currency,submittedAt:new Date(r.submitted_at).toISOString(),status:r.status}))};
  }

  private async hydrate(row:ListingRow):Promise<Listing>{
    const spotsResult=await this.pool.query<SpotRow>("SELECT * FROM spots WHERE listing_id=$1 ORDER BY created_at,id",[row.id]);
    const ids=spotsResult.rows.map(s=>s.id); const bids=new Map<string,Bid[]>();
    if(ids.length){const br=await this.pool.query("SELECT spot_id,bidder_handle,amount,created_at FROM bids WHERE spot_id=ANY($1) ORDER BY created_at",[ids]);for(const b of br.rows)bids.set(b.spot_id,[...(bids.get(b.spot_id)??[]),{bidder:b.bidder_handle,amount:Number(b.amount),at:new Date(b.created_at).toISOString()}]);}
    return {id:row.id,slug:row.slug,title:row.title,seller:row.seller_handle,sellerHandle:row.seller_handle,sellerUserId:row.seller_user_id,surface:row.surface,story:row.story,image:row.image_url,mode:row.mode,currency:row.currency,deadline:new Date(row.deadline).toISOString(),artworkClose:row.artwork_close,minIncrement:n(row.min_increment),doubleUp:row.double_up,spots:spotsResult.rows.map(s=>this.mapSpot(s,bids.get(s.id)??[]))};
  }
  private mapSpot(s:SpotRow,bids:Bid[]=[]):Spot{return{id:s.id,listingId:s.listing_id,label:s.label,location:s.location,size:s.size,price:Number(s.price),currency:s.currency,status:s.status,currentBid:n(s.current_bid),buyer:s.buyer_handle??undefined,bids,fulfilledAt:s.fulfilled_at?.toISOString()};}
  private async getSpot(id:string):Promise<Spot|undefined>{const r=await this.pool.query<SpotRow>("SELECT * FROM spots WHERE id=$1",[id]);if(!r.rows[0])return undefined;const b=await this.pool.query("SELECT bidder_handle,amount,created_at FROM bids WHERE spot_id=$1 ORDER BY created_at",[id]);return this.mapSpot(r.rows[0],b.rows.map(x=>({bidder:x.bidder_handle,amount:Number(x.amount),at:new Date(x.created_at).toISOString()})));}
  private async ownerTransition(id:string,userId:string,from:string,to:string):Promise<Spot>{const r=await this.pool.query(`UPDATE spots s SET status=$4,updated_at=now() FROM listings l WHERE s.id=$1 AND l.id=s.listing_id AND l.seller_user_id=$2 AND s.status=$3 RETURNING s.id`,[id,userId,from,to]);if(!r.rows[0])await this.throwSpotAccess(id,userId);return(await this.getSpot(id))!;}
  private async throwListingAccess(slug:string,userId:string):Promise<never>{const r=await this.pool.query("SELECT seller_user_id FROM listings WHERE slug=$1",[slug]);throw httpError(!r.rows[0]?"listing not found":r.rows[0].seller_user_id!==userId?"forbidden":"listing cannot be updated",!r.rows[0]?404:r.rows[0].seller_user_id!==userId?403:409);}
  private async throwSpotAccess(id:string,userId:string):Promise<never>{const r=await this.pool.query("SELECT l.seller_user_id FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1",[id]);throw httpError(!r.rows[0]?"spot not found":r.rows[0].seller_user_id!==userId?"forbidden":"spot is not in the required state",!r.rows[0]?404:r.rows[0].seller_user_id!==userId?403:409);}
}
