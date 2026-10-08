import { relations } from "drizzle-orm/relations";
import { users, walletWithdrawals, sessions, listings, spots, bids } from "./schema";

export const walletWithdrawalsRelations = relations(walletWithdrawals, ({one}) => ({
	user: one(users, {
		fields: [walletWithdrawals.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	walletWithdrawals: many(walletWithdrawals),
	sessions: many(sessions),
	listings: many(listings),
	spots: many(spots),
	bids: many(bids),
}));

export const sessionsRelations = relations(sessions, ({one}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
}));

export const listingsRelations = relations(listings, ({one, many}) => ({
	user: one(users, {
		fields: [listings.sellerUserId],
		references: [users.id]
	}),
	spots: many(spots),
}));

export const spotsRelations = relations(spots, ({one, many}) => ({
	user: one(users, {
		fields: [spots.buyerUserId],
		references: [users.id]
	}),
	listing: one(listings, {
		fields: [spots.listingId],
		references: [listings.id]
	}),
	bids: many(bids),
}));

export const bidsRelations = relations(bids, ({one}) => ({
	user: one(users, {
		fields: [bids.bidderUserId],
		references: [users.id]
	}),
	spot: one(spots, {
		fields: [bids.spotId],
		references: [spots.id]
	}),
}));