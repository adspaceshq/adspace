import assert from "node:assert/strict";
import test from "node:test";
import { accountDetails } from "../src/auth.js";

test("an email confirmed by code counts as verified", () => {
  assert.equal(accountDetails([{ type: "email", address: "a@example.com" }]).email, "a@example.com");
});

test("a Google login's email counts as verified, so Google users are not asked to verify again", () => {
  assert.equal(accountDetails([{ type: "google_oauth", email: "g@gmail.com", subject: "1" }]).email, "g@gmail.com");
});

test("the code-confirmed email wins over the Google one", () => {
  const accounts = [
    { type: "google_oauth", email: "g@gmail.com" },
    { type: "email", address: "a@example.com" },
  ];
  assert.equal(accountDetails(accounts).email, "a@example.com");
});

test("an X login alone has no verified email", () => {
  assert.equal(accountDetails([{ type: "twitter_oauth", username: "someone" }]).email, undefined);
});
