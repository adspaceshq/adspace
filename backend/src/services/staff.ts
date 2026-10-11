import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import { staff, users } from "../db/schema.js";

export type StaffRole = "reviewer" | "admin";

class StaffError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// Team roles only work for accounts with a verified email AND a linked X account; if either is lost
// later, the role stops working immediately without anyone removing it.
const verifiedForStaff = and(isNotNull(users.xUserId), isNotNull(users.email), isNotNull(users.emailVerifiedAt));

export async function staffRoleOf(db: Db, userId: string): Promise<StaffRole | null> {
  const [row] = await db
    .select({ role: staff.role })
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId))
    .where(and(eq(staff.userId, userId), verifiedForStaff));
  return row?.role ?? null;
}

// Owner admins come from PLATFORM_ADMINS (user ids or Privy DIDs). They are always admin, can't be
// removed in the app, and are listed first so it's clear who they are.
const isOwner = (user: { id: string; privyDid: string }, owners: readonly string[]) =>
  owners.some((entry) => entry.trim() && (entry.trim() === user.id || entry.trim() === user.privyDid));

export async function listStaff(db: Db, owners: readonly string[] = []) {
  const granter = alias(users, "granter");
  const entries = owners.map((entry) => entry.trim()).filter(Boolean);
  const ids = entries.filter((entry) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry));
  const dids = entries.filter((entry) => entry.startsWith("did:privy:"));
  const matchers = [...(ids.length ? [inArray(users.id, ids)] : []), ...(dids.length ? [inArray(users.privyDid, dids)] : [])];
  const ownerRows = matchers.length
    ? await db
        .select({ userId: users.id, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl })
        .from(users)
        .where(or(...matchers))
    : [];
  const members = await db
    .select({ userId: staff.userId, role: staff.role, grantedAt: staff.grantedAt, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl, grantedByHandle: granter.handle })
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId))
    .leftJoin(granter, eq(granter.id, staff.grantedBy))
    .orderBy(desc(staff.grantedAt));
  const ownerSet = new Set(ownerRows.map((row) => row.userId));
  return [
    ...ownerRows.map((row) => ({ ...row, role: "owner" as const, grantedAt: null, grantedByHandle: null })),
    ...members.filter((member) => !ownerSet.has(member.userId)),
  ];
}

// The handle is only a lookup convenience; the grant is stored against the user id.
export async function grantStaffRole(db: Db, actorId: string, handle: unknown, role: unknown, owners: readonly string[] = []) {
  if (role !== "reviewer" && role !== "admin") throw new StaffError("role must be reviewer or admin");
  const clean = String(handle ?? "").trim().replace(/^@+/, "").toLowerCase();
  if (!clean) throw new StaffError("enter a handle");
  const [user] = await db
    .select({ id: users.id, privyDid: users.privyDid, xUserId: users.xUserId, email: users.email, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(sql`lower(${users.handle}) = ${clean}`);
  if (!user) throw new StaffError(`no adspaces account with the handle @${clean}; they need to sign up first`, 404);
  if (isOwner(user, owners)) throw new StaffError(`@${clean} is already an owner admin`);
  if (!user.xUserId) throw new StaffError(`@${clean} needs to sign in with X before they can join the team`);
  if (!user.email || !user.emailVerifiedAt) throw new StaffError(`@${clean} needs to verify their email before they can join the team`);
  // One role per person: someone already on the team must be removed before a different role is given.
  const [existing] = await db.select({ role: staff.role }).from(staff).where(eq(staff.userId, user.id));
  if (existing) throw new StaffError(`@${clean} is already ${existing.role === "admin" ? "an admin" : "a reviewer"}. remove them first to change their role`, 409);
  await db.insert(staff).values({ userId: user.id, role, grantedBy: actorId });
  return listStaff(db, owners);
}

// Members can't remove themselves (to avoid locking the team out), except owners, who keep admin anyway.
export async function revokeStaffRole(db: Db, actorId: string, userId: string, owners: readonly string[] = []) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new StaffError("member not found", 404);
  const [actor] = await db.select({ id: users.id, privyDid: users.privyDid }).from(users).where(eq(users.id, actorId));
  if (userId === actorId && !(actor && isOwner(actor, owners))) throw new StaffError("you can't remove your own access");
  await db.delete(staff).where(eq(staff.userId, userId));
  return listStaff(db, owners);
}
