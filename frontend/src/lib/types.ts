// Mirror of backend/src/types.ts — keep in sync with CONTRACT.md.

export type ApiMode = "fixed" | "auction";
export type ApiSpotStatus = "open" | "claimed" | "sold";

export interface ApiBid {
  bidder: string;
  amount: number;
  at: string;
}

export interface ApiSpot {
  id: string;
  listingId: string;
  label: string;
  location: string;
  size: string;
  price: number;
  currency: string;
  status: ApiSpotStatus;
  currentBid?: number;
  buyer?: string;
  bids?: ApiBid[];
}

export interface ApiListing {
  id: string;
  slug: string;
  title: string;
  seller: string;
  sellerHandle: string;
  surface: string;
  story: string;
  image: string;
  mode: ApiMode;
  currency: string;
  deadline: string;
  artworkClose: string;
  minIncrement?: number;
  doubleUp?: boolean;
  spots: ApiSpot[];
}

export interface ApiListingSummary {
  id: string;
  slug: string;
  title: string;
  seller: string;
  surface: string;
  image: string;
  mode: ApiMode;
  currency: string;
  fromPrice: number;
  raised: number;
  open: number;
  total: number;
}

export interface ApiCreateListingRequest {
  title: string;
  surface?: string;
  story?: string;
  mode?: string;
  currency?: string;
  artworkClose?: string;
  spots?: ApiCreateSpotRequest[];
}

export interface ApiCreateSpotRequest {
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
