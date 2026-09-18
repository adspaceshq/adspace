export type Mode = "fixed" | "auction";
export type SpotStatus = "open" | "claimed" | "sold";

export interface Bid {
  bidder: string;
  amount: number;
  at: string;
}

export interface Spot {
  id: string;
  listingId: string;
  label: string;
  location: string;
  size: string;
  price: number;
  currency: string;
  status: SpotStatus;
  currentBid?: number;
  buyer?: string;
  bids?: Bid[];
  fulfilledAt?: string;
}

export interface Listing {
  id: string;
  slug: string;
  title: string;
  seller: string;
  sellerHandle: string;
  sellerUserId?: string;
  surface: string;
  story: string;
  image: string;
  mode: Mode;
  currency: string;
  deadline: string;
  artworkClose: string;
  minIncrement?: number;
  doubleUp?: boolean;
  spots: Spot[];
}

export interface ListingSummary {
  id: string;
  slug: string;
  title: string;
  seller: string;
  surface: string;
  image: string;
  mode: Mode;
  currency: string;
  fromPrice: number;
  raised: number;
  open: number;
  total: number;
}

export interface CreateListingRequest {
  title: string;
  surface?: string;
  story?: string;
  mode?: string;
  currency?: string;
  artworkClose?: string;
  spots?: CreateSpotRequest[];
}

export interface CreateSpotRequest {
  label?: string;
  location?: string;
  size?: string;
  price?: number;
}

export interface SessionUser {
  id: string;
  did: string;
  handle: string;
  name?: string;
  avatar?: string;
}

export interface AuthenticatedIdentity extends Omit<SessionUser, "id"> { xUserId: string }
export interface SessionResponse extends SessionUser { csrfToken: string; expiresAt: string }

export interface SellerDashboardListing {
  id: string;
  slug: string;
  title: string;
  image: string;
  status: "active" | "closed";
  mode: Mode;
  currency: string;
  sold: number;
  open: number;
  total: number;
  revenue: number;
}

export interface SellerAttentionItem {
  spotId: string;
  listingId: string;
  listingSlug: string;
  listingTitle: string;
  spotLabel: string;
  buyer: string;
  amount: number;
  currency: string;
  submittedAt: string;
  status: "pending" | "approved";
}

export interface SellerDashboard {
  summary: { activeListings: number; openSpots: number; pendingApproval: number; revenue: number; currency: string };
  listings: SellerDashboardListing[];
  attention: SellerAttentionItem[];
}
