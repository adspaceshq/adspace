import type { Bid, CreateListingRequest, Listing, ListingSummary, SellerDashboard, SessionUser, Spot } from "./types.js";

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

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
  return { id, listingId, label, location, size, price, currency, status, buyer: buyer || undefined };
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
  const spot: Spot = { id, listingId, label, location, size, price: start, currency, status: "open", bids: [] };
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
    return this.order.map((slug) => {
      const l = this.listings.get(slug)!;
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
      return sum;
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
    mode?: string;
    currency?: string;
    artworkClose?: string;
    spots?: Array<{ label?: string; location?: string; size?: string; price?: number }>;
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
    const spots: Spot[] = drafts.map((s, i) => {
      const label = s.label?.trim() || `Spot ${i + 1}`;
      const price = Number(s.price);
      const spotId = `${id}-s${i + 1}`;
      return mode === "auction"
        ? auctionSpot(id, spotId, label, s.location ?? "", s.size ?? "", price, currency)
        : fixedSpot(id, spotId, label, s.location ?? "", s.size ?? "", price, currency);
    });
    const listing: Listing = {
      id, slug: id, title, seller,
      sellerHandle: req.sellerHandle ?? seller,
      sellerUserId: req.sellerUserId,
      surface: req.surface ?? "", story: req.story ?? "",
      image: "", mode,
      currency, deadline: daysFromNow(14), artworkClose: req.artworkClose ?? "", spots,
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

  claim(spotId: string, buyer: SessionUser | string): Spot {
    const found = this.findSpot(spotId);
    if (!found) throw Object.assign(new Error("spot not found"), { status: 404 });
    const { listing, spot } = found;
    if (listing.mode === "auction") throw Object.assign(new Error("auction spot: place a bid instead"), { status: 409 });
    if (spot.status !== "open") throw Object.assign(new Error("spot already taken"), { status: 409 });
    spot.status = "claimed";
    spot.buyer = typeof buyer === "string" ? buyer : buyer.handle;
    return spot;
  }

  placeBid(spotId: string, bidder: SessionUser | string, amount: number): Spot {
    const found = this.findSpot(spotId);
    if (!found) throw Object.assign(new Error("spot not found"), { status: 404 });
    const { listing, spot } = found;
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
    return spot;
  }

  reject(spotId: string, actorUserId: string): Spot {
    const { spot } = this.ownedSpot(spotId, actorUserId);
    if (spot.status !== "claimed") throw Object.assign(new Error("spot is not pending"), { status: 409 });
    spot.status = "open"; spot.buyer = undefined; spot.currentBid = undefined;
    return spot;
  }

  dashboard(actorUserId: string): SellerDashboard {
    const listings = this.order.map(slug => this.listings.get(slug)!).filter(l => l.sellerUserId === actorUserId).map(l => ({
      id:l.id,slug:l.slug,title:l.title,image:l.image,status:"active" as const,mode:l.mode,currency:l.currency,
      sold:l.spots.filter(s=>s.status!=="open").length,open:l.spots.filter(s=>s.status==="open").length,total:l.spots.length,
      revenue:l.spots.filter(s=>s.status==="sold").reduce((sum,s)=>sum+(s.currentBid??s.price),0),
    }));
    const attention = this.order.flatMap(slug => { const l=this.listings.get(slug)!; if(l.sellerUserId!==actorUserId)return []; return l.spots.filter(s=>s.buyer&&(s.status==="claimed"||(s.status==="sold"&&!s.fulfilledAt))).map(s=>({spotId:s.id,listingId:l.id,listingSlug:l.slug,listingTitle:l.title,spotLabel:s.label,buyer:s.buyer!,amount:s.currentBid??s.price,currency:s.currency,submittedAt:new Date().toISOString(),status:s.status==="claimed"?"pending" as const:"approved" as const})); });
    return {summary:{activeListings:listings.length,openSpots:listings.reduce((a,l)=>a+l.open,0),pendingApproval:attention.filter(a=>a.status==="pending").length,revenue:listings.reduce((a,l)=>a+l.revenue,0),currency:listings[0]?.currency??"USD"},listings,attention};
  }
}
    deadline?: string;
