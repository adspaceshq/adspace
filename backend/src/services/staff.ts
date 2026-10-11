import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
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

export async function listStaff(db: Db) {
  const granter = alias(users, "granter");
  return db
    .select({ userId: staff.userId, role: staff.role, grantedAt: staff.grantedAt, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl, grantedByHandle: granter.handle })
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId))
    .leftJoin(granter, eq(granter.id, staff.grantedBy))
    .orderBy(desc(staff.grantedAt));
}

// The handle is only a lookup convenience; the grant is stored against the user id.
export async function grantStaffRole(db: Db, actorId: string, handle: unknown, role: unknown) {
  if (role !== "reviewer" && role !== "admin") throw new StaffError("role must be reviewer or admin");
  const clean = String(handle ?? "").trim().replace(/^@+/, "").toLowerCase();
  if (!clean) throw new StaffError("enter a handle");
  const [user] = await db
    .select({ id: users.id, xUserId: users.xUserId, email: users.email, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(sql`lower(${users.handle}) = ${clean}`);
  if (!user) throw new StaffError(`no adspaces account with the handle @${clean}; they need to sign up first`, 404);
  if (!user.xUserId) throw new StaffError(`@${clean} needs to sign in with X before they can join the team`);
  if (!user.email || !user.emailVerifiedAt) throw new StaffError(`@${clean} needs to verify their email before they can join the team`);
  await db
    .insert(staff)
    .values({ userId: user.id, role, grantedBy: actorId })
    .onConflictDoUpdate({ target: staff.userId, set: { role, grantedBy: actorId, grantedAt: new Date() } });
  return listStaff(db);
}

export async function revokeStaffRole(db: Db, actorId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new StaffError("member not found", 404);
  if (userId === actorId) throw new StaffError("you can't remove your own access");
  await db.delete(staff).where(eq(staff.userId, userId));
  return listStaff(db);
}
