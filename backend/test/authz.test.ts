import assert from "node:assert/strict";
import test from "node:test";
import { cookieOptions } from "../src/auth.js";

// The v2 session cookie uses these options; HTTP-level authz is covered in v2-router.test.ts.
test("production session cookies are hardened", () => {
  const previous = process.env.NODE_ENV;
  const previousSameSite = process.env.SESSION_COOKIE_SAMESITE;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_COOKIE_SAMESITE;
    // Cross-site default: SameSite=None + Secure so the cookie is sent on fetch.
    assert.deepEqual(cookieOptions(), { httpOnly: true, sameSite: "none", secure: true, path: "/", maxAge: 604_800_000 });
    process.env.SESSION_COOKIE_SAMESITE = "lax";
    assert.deepEqual(cookieOptions(), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 604_800_000 });
  } finally {
    if (previousSameSite === undefined) delete process.env.SESSION_COOKIE_SAMESITE;
    else process.env.SESSION_COOKIE_SAMESITE = previousSameSite;
    process.env.NODE_ENV = previous;
  }
});
