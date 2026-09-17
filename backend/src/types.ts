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
}

export interface Listing {
  id: string;
  slug: string;
  title: string;
  seller: string;
  sellerHandle: string;
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
  did: string;
  handle: string;
  name?: string;
  avatar?: string;
}
