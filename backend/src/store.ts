import type { Bid, CreateListingRequest, Listing, ListingSummary, SellerDashboard, SessionUser, Spot } from "./types.js";

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

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

function seedMacbook(): Listing {
  const id = "vincent-macbook";
  return {
    id, slug: id,
    title: "Your brand, on my Mac",
    seller: "Vincent", sellerHandle: "@VynseDev",
    surface: "gear",
    story: "The auction buys the MacBook itself. Top bid at close wins the sticker spot — seen online and IRL.",
    image: "/mac/macbook-open.png", mode: "auction", currency: "EUR",
    deadline: daysFromNow(7), artworkClose: "At close", minIncrement: 10,
    spots: [
      auctionSpot(id, "mac-01", "Top left banner", "Lid", "9.5 × 5.5", 400, "EUR"),
      auctionSpot(id, "mac-02", "Marquee, above logo", "Lid", "9.5 × 5.5", 400, "EUR"),
      auctionSpot(id, "mac-03", "Top right banner", "Lid", "9.5 × 5.5", 400, "EUR"),
      auctionSpot(id, "mac-04", "Middle left", "Lid", "4.5 × 4.5", 150, "EUR"),
      auctionSpot(id, "mac-05", "Inner left", "Lid", "4.5 × 4.5", 150, "EUR"),
      auctionSpot(id, "mac-06", "Inner right", "Lid", "4.5 × 4.5", 150, "EUR"),
      auctionSpot(id, "mac-07", "Middle right", "Lid", "4.5 × 4.5", 150, "EUR"),
      auctionSpot(id, "mac-08", "Bottom left strip", "Lid", "9.5 × 4", 700, "EUR"),
      auctionSpot(id, "mac-09", "Bottom center", "Lid", "9.5 × 4", 800, "EUR"),
      auctionSpot(id, "mac-10", "Bottom right strip", "Lid", "9.5 × 4", 550, "EUR"),
      auctionSpot(id, "mac-11", "Left palm rest", "Inside", "4 × 4", 59, "EUR"),
      auctionSpot(id, "mac-12", "Right palm rest", "Inside", "4 × 4", 59, "EUR"),
    ],
  };
}

export class Store {
  private order: string[] = [];
  private listings = new Map<string, Listing>();
  private seq = 0;

  constructor() {
    for (const l of [seedMacbook()]) {
      this.listings.set(l.slug, l);
      this.order.push(l.slug);
    }
  }

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

  private findSpot(spotId: string): { listing: Listing; spot: Spot } | undefined {
    for (const slug of this.order) {
      const listing = this.listings.get(slug)!;
      const spot = listing.spots.find((s) => s.id === spotId);
      if (spot) return { listing, spot };
    }
    return undefined;
  }

  claim(spotId: string, buyer: string): Spot {
    const found = this.findSpot(spotId);
    if (!found) throw Object.assign(new Error("spot not found"), { status: 404 });
    const { listing, spot } = found;
    if (listing.mode === "auction") throw Object.assign(new Error("auction spot: place a bid instead"), { status: 409 });
    if (spot.status !== "open") throw Object.assign(new Error("spot already taken"), { status: 409 });
    spot.status = "claimed";
    spot.buyer = buyer;
    return spot;
  }

  placeBid(spotId: string, bidder: string, amount: number): Spot {
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
    spot.bids!.push({ bidder, amount, at: new Date().toISOString() });
    spot.currentBid = amount;
    spot.buyer = bidder;
    return spot;
  }
}
