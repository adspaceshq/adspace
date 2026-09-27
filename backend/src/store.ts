import { TERMS_VERSION, payoutReleased, platformFeeBps } from "./types.js";
import { resolvePayoutReference } from "./payout.js";
import type { Bid, CreateListingRequest, Listing, ListingSummary, PayoutItem, PurchaseAssets, SellerDashboard, SessionUser, Spot } from "./types.js";

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/** Step 5: lazy deadline — a listing is over once its deadline passes, whatever its status says. */
const hasEnded = (deadline: string) => new Date(deadline).getTime() <= Date.now();

/** Step 7: artwork due date. Empty stays empty; otherwise a parseable date. */
function parseArtworkClose(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  if (Number.isNaN(new Date(raw).getTime())) {
    throw Object.assign(new Error("artwork close must be a valid date"), { status: 400 });
  }
  return new Date(raw).toISOString();
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
    throw Object.assign(new Error(`proof needs 1 to ${MAX_PROOF_PHOTOS} photos`), { status: 400 });
  }
  const clean = photos.map((p) => {
    const url = typeof p === "string" ? p.trim() : "";
    if (!url.startsWith("data:image/")) throw Object.assign(new Error("proof photos must be image uploads"), { status: 400 });
    if (url.length > MAX_LOGO_URL_LENGTH) throw Object.assign(new Error("proof photo is too large"), { status: 400 });
    return url;
  });
  const out: { photos: string[]; postUrl?: string } = { photos: clean };
  const postUrl = typeof proof.postUrl === "string" ? proof.postUrl.trim() : "";
  if (postUrl) {
    let host = "";
    try { host = new URL(postUrl).hostname.toLowerCase(); } catch { host = ""; }
    if (!/^https:\/\//i.test(postUrl) || !(host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com"))) {
      throw Object.assign(new Error("proof post must be an X post link"), { status: 400 });
    }
    out.postUrl = postUrl;
  }
  return out;
}

const MAX_LOGO_URL_LENGTH = 3_000_000;

/** Validate buyer brand assets. The logo is required at purchase — every sold spot carries art by construction. */
function parseBrandAssets(assets?: PurchaseAssets, opts: { requireLogo?: boolean } = {}): { website?: string; logoUrl?: string } {
  const out: { website?: string; logoUrl?: string } = {};
  const website = assets?.website?.trim() ?? "";
  if (website) {
    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(website)) {
      throw Object.assign(new Error("website must be an http(s) URL"), { status: 400 });
    }
    out.website = website;
  }
  const logoUrl = assets?.logoUrl?.trim() ?? "";
  if (!logoUrl && opts.requireLogo) {
    throw Object.assign(new Error("logo is required"), { status: 400 });
  }
  if (logoUrl) {
    if (!logoUrl.startsWith("data:image/")) {
      throw Object.assign(new Error("logo must be an image upload"), { status: 400 });
    }
    if (logoUrl.length > MAX_LOGO_URL_LENGTH) {
      throw Object.assign(new Error("logo is too large"), { status: 400 });
    }
    out.logoUrl = logoUrl;
  }
  return out;
}

function fixedSpot(
  listingId: string,
  id: string,
  label: string,
  location: string,
  size: string,
  price: number,
  currency: string,
  status: Spot["status"] = "open",
  buyer = "",
): Spot {
  return { id, listingId, label, location, size, price, currency, view: "lid", status, buyer: buyer || undefined };
}

function auctionSpot(
  listingId: string,
  id: string,
  label: string,
  location: string,
  size: string,
  start: number,
  currency: string,
  bids: Bid[] = [],
): Spot {
  const spot: Spot = { id, listingId, label, location, size, price: start, currency, view: "lid", status: "open", bids: [] };
  for (const b of bids) {
    spot.bids!.push(b);
    spot.currentBid = b.amount;
    spot.buyer = b.bidder;
  }
  return spot;
}

export class Store {
  private order: string[] = [];
  private listings = new Map<string, Listing>();
  private seq = 0;

  async migrate(): Promise<void> {}

  summaries(): ListingSummary[] {
    return this.order.flatMap((slug) => {
      const l = this.listings.get(slug)!;
      if (l.status !== "active" || hasEnded(l.deadline)) return [];
      const sum: ListingSummary = {
        id: l.id, slug: l.slug, title: l.title, seller: l.seller,
        surface: l.surface, image: l.image, mode: l.mode, currency: l.currency,
        fromPrice: 0, raised: 0, open: 0, total: l.spots.length,
      };
      for (const sp of l.spots) {
        if (!sum.fromPrice || sp.price < sum.fromPrice) sum.fromPrice = sp.price;
        if (sp.status !== "open") sum.raised += sp.currentBid || sp.price;
        else if (sp.currentBid) sum.raised += sp.currentBid;
        else sum.open++;
      }
      return [sum];
    });
  }

  get(slug: string): Listing | undefined {
    return this.listings.get(slug);
  }

  create(req: {
    title: string;
    seller: string;
    sellerHandle?: string;
    sellerUserId?: string;
    surface?: string;
    story?: string;
    image?: string;
    fabric?: string;
    mode?: string;
    currency?: string;
    deadline?: string;
    artworkClose?: string;
    spots?: Array<{ label?: string; location?: string; size?: string; price?: number; view?: string; x?: number; y?: number; w?: number }>;
  }): Listing {
    const title = req.title.trim();
    const seller = req.seller.trim();
    if (!title || !seller) {
      throw Object.assign(new Error("title and seller are required"), { status: 400 });
    }
    const mode: Listing["mode"] = req.mode === "auction" ? "auction" : "fixed";
    const currency = req.currency?.trim() || "USD";
    let deadline = daysFromNow(14);
    if (req.deadline !== undefined && req.deadline !== "") {
      const parsed = new Date(req.deadline);
      if (Number.isNaN(parsed.getTime())) {
        throw Object.assign(new Error("deadline must be a valid date"), { status: 400 });
      }
      if (parsed.getTime() <= Date.now()) {
        throw Object.assign(new Error("deadline must be in the future"), { status: 400 });
      }
      deadline = parsed.toISOString();
    }
    const drafts = req.spots ?? [];
    if (drafts.length > 60) {
      throw Object.assign(new Error("at most 60 spots per listing"), { status: 400 });
    }
    drafts.forEach((s, i) => {
      if (!(Number(s.price) > 0)) {
        throw Object.assign(new Error(`spot ${i + 1}: price must be above zero`), { status: 400 });
      }
    });
    this.seq++;
    const id = `user-${this.seq}`;
    const spotView = (s: { view?: string }) =>
      s.view === "inside" || s.view === "tee-front" || s.view === "tee-back" || s.view === "tee-left" || s.view === "tee-right" ? s.view : "lid";
    const fabric = typeof req.fabric === "string" && /^#[0-9a-fA-F]{6}$/.test(req.fabric.trim()) ? req.fabric.trim() : "#f6f6f7";
    const spotPlacement = (s: { x?: number; y?: number; w?: number }) => ({
      x: typeof s.x === "number" && Number.isFinite(s.x) ? Math.min(100, Math.max(0, s.x)) : undefined,
      y: typeof s.y === "number" && Number.isFinite(s.y) ? Math.min(100, Math.max(0, s.y)) : undefined,
      w: typeof s.w === "number" && Number.isFinite(s.w) ? Math.min(100, Math.max(0, s.w)) : undefined,
    });
    const spots: Spot[] = drafts.map((s, i) => {
      const label = s.label?.trim() || `Spot ${i + 1}`;
      const price = Number(s.price);
      const spotId = `${id}-s${i + 1}`;
      const spot = mode === "auction"
        ? auctionSpot(id, spotId, label, s.location ?? "", s.size ?? "", price, currency)
        : fixedSpot(id, spotId, label, s.location ?? "", s.size ?? "", price, currency);
      spot.view = spotView(s);
      Object.assign(spot, spotPlacement(s));
      return spot;
    });
    const image = typeof req.image === "string" ? req.image.trim() : "";
    if (image) {
      if (!image.startsWith("data:image/")) throw Object.assign(new Error("image must be an image upload"), { status: 400 });
      if (image.length > MAX_LOGO_URL_LENGTH) throw Object.assign(new Error("image is too large"), { status: 400 });
    }
    const listing: Listing = {
      id, slug: id, title, seller,
      sellerHandle: req.sellerHandle ?? seller,
      sellerUserId: req.sellerUserId,
      surface: req.surface ?? "", story: req.story ?? "",
      image, mode, fabric,
      // Step 2: submissions land as submitted — platform review activates them.
      currency, deadline, artworkClose: parseArtworkClose(req.artworkClose), status: "submitted", spots,
    };
    this.listings.set(id, listing);
    this.order.unshift(id);
    return listing;
  }

  createForUser(req: CreateListingRequest, seller: SessionUser): Listing {
    return this.create({ ...req, seller: seller.handle, sellerHandle: seller.handle, sellerUserId: seller.id });
  }

  update(slug: string, actorUserId: string, patch: { title?: string; story?: string }): Listing {
    const listing = this.ownedListing(slug, actorUserId);
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw Object.assign(new Error("title is required"), { status: 400 });
      listing.title = title;
    }
    if (patch.story !== undefined) listing.story = patch.story.trim();
    return listing;
  }

  approve(spotId: string, actorUserId: string): Spot {
    const { listing, spot } = this.ownedSpot(spotId, actorUserId);
    if (!spot.buyer) throw Object.assign(new Error("spot has no buyer to approve"), { status: 409 });
    spot.status = "sold";
    return spot;
  }

  payableQueue(): PayoutItem[] {
    const items: PayoutItem[] = [];
    for (const slug of this.order) {
      const l = this.listings.get(slug)!;
      for (const s of l.spots) {
        if (s.status !== "sold" || !s.fulfilledAt || s.paidAt || !payoutReleased(s)) continue;
        const base = s.confirmedAt ? new Date(s.confirmedAt).getTime() : new Date(s.fulfilledAt).getTime() + 3 * 86_400_000;
        items.push({
          spotId: s.id, listingId: l.id, listingSlug: l.slug, listingTitle: l.title, spotLabel: s.label,
          seller: l.seller, buyer: s.buyer!, amount: s.currentBid ?? s.price, currency: s.currency,
          releasedAt: new Date(base).toISOString(),
        });
      }
    }
    return items.sort((a, b) => a.releasedAt.localeCompare(b.releasedAt));
  }

  /** Demo seam: the memory adapter has no users table, so tests register seller wallets here. */
  private sellerWallets = new Map<string, string>();
  registerSellerWallet(userId: string, wallet: string): void {
    if (wallet) this.sellerWallets.set(userId, wallet);
    else this.sellerWallets.delete(userId);
  }

  async paySpot(spotId: string, reference: string): Promise<Spot> {
    if (typeof reference === "string" && reference.trim().length > 200) {
      throw Object.assign(new Error("reference must be at most 200 characters"), { status: 400 });
    }
    const found = this.findSpot(spotId);
    if (!found) throw Object.assign(new Error("spot not found"), { status: 404 });
    const { listing, spot } = found;
    if (spot.status !== "sold" || !spot.fulfilledAt) throw Object.assign(new Error("only delivered spots can be paid"), { status: 409 });
    if (spot.paidAt) return spot;
    if (!payoutReleased(spot)) throw Object.assign(new Error("spot is not released for payout"), { status: 409 });
    const sellerWallet = listing.sellerUserId ? this.sellerWallets.get(listing.sellerUserId) : undefined;
    if (!sellerWallet) throw Object.assign(new Error("seller payout wallet is not set"), { status: 409 });
    const amount = spot.currentBid ?? spot.price;
    const fee = Math.round(amount * (platformFeeBps() / 10_000) * 100) / 100;
    const note = await resolvePayoutReference({
      reference,
      destination: sellerWallet,
      expectedNet: Math.round((amount - fee) * 100) / 100,
    });
    spot.paidAt = new Date().toISOString();
    spot.payoutAmount = amount;
    spot.payoutFee = fee;
    spot.payoutReference = note || undefined;
    spot.payoutDestination = sellerWallet;
    return spot;
  }

  /** Buyer receipt: confirm (idempotent), dispute (replaces reason), withdraw. Fulfilled-only, buyer-only. */
  private buyerSpot(spotId: string, actor: SessionUser | string): Spot {
    const found = this.findSpot(spotId);
    if (!found) throw Object.assign(new Error("spot not found"), { status: 404 });
    const { spot } = found;
    if (spot.status !== "sold" || !spot.fulfilledAt) {
      throw Object.assign(new Error("spots open for review once delivered"), { status: 409 });
    }
    const actorHandle = typeof actor === "string" ? actor : actor.handle;
    if (!spot.buyer || spot.buyer !== actorHandle) throw Object.assign(new Error("only the buyer can review delivery"), { status: 403 });
    return spot;
  }

  confirmSpot(spotId: string, actor: SessionUser | string): Spot {
    const spot = this.buyerSpot(spotId, actor);
    if (spot.disputedAt) throw Object.assign(new Error("withdraw the dispute first"), { status: 409 });
    spot.confirmedAt = spot.confirmedAt ?? new Date().toISOString();
    return spot;
  }

  disputeSpot(spotId: string, actor: SessionUser | string, reason: string): Spot {
    const spot = this.buyerSpot(spotId, actor);
    if (spot.confirmedAt) throw Object.assign(new Error("already confirmed"), { status: 409 });
    const note = typeof reason === "string" ? reason.trim() : "";
    if (note.length > 500) throw Object.assign(new Error("reason must be at most 500 characters"), { status: 400 });
    spot.disputedAt = spot.disputedAt ?? new Date().toISOString();
    spot.disputeReason = note || undefined;
    return spot;
  }

  withdrawDispute(spotId: string, actor: SessionUser | string): Spot {
    const spot = this.buyerSpot(spotId, actor);
    spot.disputedAt = undefined;
    spot.disputeReason = undefined;
    return spot;
  }

  submitProof(spotId: string, actorUserId: string, proof: { photos: unknown; postUrl?: unknown }): Spot {
    const parsed = parseProof(proof);
    const found = this.findSpot(spotId);
    if (!found) throw Object.assign(new Error("spot not found"), { status: 404 });
    const { listing, spot } = found;
    if (!listing.sellerUserId || listing.sellerUserId !== actorUserId) throw Object.assign(new Error("forbidden"), { status: 403 });
    if (spot.status !== "sold" || !spot.fulfilledAt) {
      throw Object.assign(new Error("fulfill the spot before uploading proof"), { status: 409 });
    }
    spot.proofPhotos = parsed.photos;
    spot.proofPost = parsed.postUrl;
    return spot;
  }

  submitArtwork(spotId: string, actor: SessionUser | string, assets?: PurchaseAssets): Spot {
    const brand = parseBrandAssets(assets);
    if (!brand.website && !brand.logoUrl) throw Object.assign(new Error("artwork is required"), { status: 400 });
    const found = this.findSpot(spotId);
    if (!found) throw Object.assign(new Error("spot not found"), { status: 404 });
    const { listing, spot } = found;
    if (spot.status !== "sold") throw Object.assign(new Error("artwork intake opens once the spot is sold"), { status: 409 });
    // The demo store tracks buyers by handle (Postgres compares stable IDs).
    const actorHandle = typeof actor === "string" ? actor : actor.handle;
    if (!spot.buyer || spot.buyer !== actorHandle) throw Object.assign(new Error("only the buyer can submit artwork"), { status: 403 });
    if (artworkLocked(listing.artworkClose)) throw Object.assign(new Error("artwork window has closed"), { status: 409 });
    if (brand.website) spot.website = brand.website;
    if (brand.logoUrl) spot.logoUrl = brand.logoUrl;
    spot.artworkSubmittedAt = new Date().toISOString();
    return spot;
  }

  fulfill(spotId: string, actorUserId: string): Spot {
    const { spot } = this.ownedSpot(spotId, actorUserId);
    if (spot.status !== "sold") throw Object.assign(new Error("spot must be approved before fulfillment"), { status: 409 });
    spot.fulfilledAt = new Date().toISOString();
    return spot;
  }

  private ownedListing(slug: string, actorUserId: string): Listing {
    const listing = this.listings.get(slug);
    if (!listing) throw Object.assign(new Error("listing not found"), { status: 404 });
    if (!listing.sellerUserId || listing.sellerUserId !== actorUserId) throw Object.assign(new Error("forbidden"), { status: 403 });
    return listing;
  }

  close(slug: string, actorUserId: string): Listing {
    const listing = this.ownedListing(slug, actorUserId);
    listing.status = "closed";
    return listing;
  }

  reopen(slug: string, actorUserId: string): Listing {
    const listing = this.ownedListing(slug, actorUserId);
    // Reopening resubmits for review — it must never self-publish.
    if (listing.status === "submitted") throw Object.assign(new Error("listing is already submitted for review"), { status: 409 });
    if (listing.status === "active") return listing;
    listing.status = "submitted";
    listing.reviewNote = undefined;
    return listing;
  }

  reviewQueue(): Listing[] {
    return this.order.map((slug) => this.listings.get(slug)!).filter((l) => l.status === "submitted");
  }

  approveReview(slug: string): Listing {
    const listing = this.listings.get(slug);
    if (!listing) throw Object.assign(new Error("listing not found"), { status: 404 });
    if (listing.status !== "submitted") throw Object.assign(new Error("listing is not awaiting review"), { status: 409 });
    listing.status = "approved";
    listing.reviewNote = undefined;
    return listing;
  }

  acceptTerms(slug: string, actorUserId: string, version: string): Listing {
    if (version !== TERMS_VERSION) {
      throw Object.assign(new Error(`terms version ${version || "(missing)"} is stale — accept ${TERMS_VERSION}`), { status: 400 });
    }
    const listing = this.ownedListing(slug, actorUserId);
    if (listing.status === "active") return listing;
    if (listing.status !== "approved") throw Object.assign(new Error("listing is not approved yet"), { status: 409 });
    if (hasEnded(listing.deadline)) throw Object.assign(new Error("deadline has passed — close and relist"), { status: 409 });
    listing.status = "active";
    listing.termsVersion = TERMS_VERSION;
    listing.termsAcceptedAt = new Date().toISOString();
    return listing;
  }

  rejectReview(slug: string, reason: string): Listing {
    const listing = this.listings.get(slug);
    if (!listing) throw Object.assign(new Error("listing not found"), { status: 404 });
    if (listing.status !== "submitted") throw Object.assign(new Error("listing is not awaiting review"), { status: 409 });
    const note = typeof reason === "string" ? reason.trim() : "";
    if (note.length > 500) throw Object.assign(new Error("reason must be at most 500 characters"), { status: 400 });
    listing.status = "closed";
    listing.reviewNote = note || undefined;
    return listing;
  }

  remove(slug: string, actorUserId: string): { ok: true } {
    const listing = this.ownedListing(slug, actorUserId);
    if (listing.spots.some((s) => s.buyer || s.currentBid != null || (s.bids?.length ?? 0) > 0)) {
      throw Object.assign(new Error("cannot delete a listing with buyers or bids — close it instead"), { status: 409 });
    }
    this.listings.delete(slug);
    this.order = this.order.filter((s) => s !== slug);
    return { ok: true };
  }

  private ownedSpot(spotId: string, actorUserId: string): { listing: Listing; spot: Spot } {
    const found = this.findSpot(spotId);
    if (!found) throw Object.assign(new Error("spot not found"), { status: 404 });
    if (!found.listing.sellerUserId || found.listing.sellerUserId !== actorUserId) throw Object.assign(new Error("forbidden"), { status: 403 });
    return found;
  }

  private findSpot(spotId: string): { listing: Listing; spot: Spot } | undefined {
    for (const slug of this.order) {
      const listing = this.listings.get(slug)!;
      const spot = listing.spots.find((s) => s.id === spotId);
      if (spot) return { listing, spot };
    }
    return undefined;
  }

  claim(spotId: string, buyer: SessionUser | string, assets?: PurchaseAssets): Spot {
    const brand = parseBrandAssets(assets, { requireLogo: true });
    const found = this.findSpot(spotId);
    if (!found) throw Object.assign(new Error("spot not found"), { status: 404 });
    const { listing, spot } = found;
    if (listing.status !== "active") throw Object.assign(new Error("listing is closed"), { status: 409 });
    if (hasEnded(listing.deadline)) throw Object.assign(new Error("listing has ended"), { status: 409 });
    if (listing.mode === "auction") throw Object.assign(new Error("auction spot: place a bid instead"), { status: 409 });
    if (spot.status !== "open") throw Object.assign(new Error("spot already taken"), { status: 409 });
    spot.status = "claimed";
    spot.buyer = typeof buyer === "string" ? buyer : buyer.handle;
    spot.website = brand.website;
    spot.logoUrl = brand.logoUrl;
    return spot;
  }

  placeBid(spotId: string, bidder: SessionUser | string, amount: number, assets?: PurchaseAssets): Spot {
    const brand = parseBrandAssets(assets, { requireLogo: true });
    const found = this.findSpot(spotId);
    if (!found) throw Object.assign(new Error("spot not found"), { status: 404 });
    const { listing, spot } = found;
    if (listing.status !== "active") throw Object.assign(new Error("listing is closed"), { status: 409 });
    if (hasEnded(listing.deadline)) throw Object.assign(new Error("listing has ended"), { status: 409 });
    if (listing.mode !== "auction") throw Object.assign(new Error("fixed-price spot: claim it instead"), { status: 409 });
    if (spot.status !== "open") throw Object.assign(new Error("spot closed"), { status: 409 });
    const hasBids = (spot.bids?.length ?? 0) > 0;
    const required = !hasBids
      ? spot.price
      : listing.doubleUp
        ? (spot.currentBid ?? 0) * 2
        : (spot.currentBid ?? 0) + (listing.minIncrement ?? 0);
    if (amount < required) {
      throw Object.assign(new Error(`bid must be at least ${required} ${listing.currency}`), { status: 409 });
    }
    const handle = typeof bidder === "string" ? bidder : bidder.handle;
    spot.bids!.push({ bidder: handle, amount, at: new Date().toISOString() });
    spot.currentBid = amount;
    spot.buyer = handle;
    spot.website = brand.website;
    spot.logoUrl = brand.logoUrl;
    return spot;
  }

  reject(spotId: string, actorUserId: string): Spot {
    const { spot } = this.ownedSpot(spotId, actorUserId);
    if (spot.status !== "claimed") throw Object.assign(new Error("spot is not pending"), { status: 409 });
    spot.status = "open"; spot.buyer = undefined; spot.currentBid = undefined;
    return spot;
  }

  dashboard(actorUserId: string): SellerDashboard {
    const mine = this.order.map(slug => this.listings.get(slug)!).filter(l => l.sellerUserId === actorUserId);
    const listings = mine.map(l => ({
      id:l.id,slug:l.slug,title:l.title,image:l.image,status:l.status,deadline:l.deadline,reviewNote:l.reviewNote,mode:l.mode,currency:l.currency,
      sold:l.spots.filter(s=>s.status!=="open").length,open:l.spots.filter(s=>s.status==="open").length,total:l.spots.length,
      paid:l.spots.filter(s=>!!s.paidAt).length,
      revenue:l.spots.filter(s=>s.status==="sold").reduce((sum,s)=>sum+(s.currentBid??s.price),0),
    }));
    const attention = this.order.flatMap(slug => { const l=this.listings.get(slug)!; if(l.sellerUserId!==actorUserId)return []; return l.spots.filter(s=>s.buyer&&(s.status==="claimed"||(s.status==="sold"&&(!s.fulfilledAt||!(s.proofPhotos?.length)))||!!s.disputedAt)).map(s=>({spotId:s.id,listingId:l.id,listingSlug:l.slug,listingTitle:l.title,spotLabel:s.label,buyer:s.buyer!,amount:s.currentBid??s.price,currency:s.currency,submittedAt:new Date().toISOString(),status:(s.disputedAt?"disputed":s.status==="claimed"?"pending":s.fulfilledAt?"delivered":"approved") as "pending" | "approved" | "delivered" | "disputed",artworkReceived:!!s.artworkSubmittedAt,disputeReason:s.disputeReason})); });
    const paidOut = mine.flatMap(l => l.spots).filter(s=>s.paidAt).reduce((a,s)=>a+((s.payoutAmount ?? 0) - (s.payoutFee ?? 0)),0);
    return {summary:{activeListings:listings.filter(l=>l.status==="active" && !hasEnded(l.deadline)).length,openSpots:listings.reduce((a,l)=>a+l.open,0),pendingApproval:attention.filter(a=>a.status==="pending").length,revenue:listings.reduce((a,l)=>a+l.revenue,0),paidOut,currency:listings[0]?.currency??"USD"},listings,attention};
  }
}
