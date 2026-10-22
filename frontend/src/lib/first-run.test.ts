import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPendingCheckout, markSignInStarted, PENDING_CHECKOUT, takeFreshSignIn } from "./first-run";

// Tests run in node: give them a tiny sessionStorage.
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("first run after sign-in", () => {
  beforeEach(() => vi.stubGlobal("sessionStorage", memoryStorage()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reports a fresh sign-in once", () => {
    markSignInStarted();
    expect(takeFreshSignIn()).toBe(true);
    expect(takeFreshSignIn()).toBe(false);
  });

  it("ignores a page load without a sign-in", () => {
    expect(takeFreshSignIn()).toBe(false);
  });

  it("ignores a sign-in started long ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
    markSignInStarted();
    vi.setSystemTime(new Date("2026-10-22T10:20:00Z"));
    expect(takeFreshSignIn()).toBe(false);
  });

  it("sees a checkout waiting for the sign-in", () => {
    expect(hasPendingCheckout()).toBe(false);
    sessionStorage.setItem(PENDING_CHECKOUT, "{}");
    expect(hasPendingCheckout()).toBe(true);
  });

  it("never throws when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => markSignInStarted()).not.toThrow();
    expect(takeFreshSignIn()).toBe(false);
    expect(hasPendingCheckout()).toBe(false);
  });
});
