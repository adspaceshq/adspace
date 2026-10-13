import { describe, expect, it } from "vitest";
import { formatUsd, percentOf, toBaseUnits, toInputValue } from "./money";

describe("money", () => {
  it("parses user input into base units", () => {
    expect(toBaseUnits("25")).toBe("25000000");
    expect(toBaseUnits("$1,234.5")).toBe("1234500000");
    expect(toBaseUnits("0.000001")).toBe("1");
    expect(toBaseUnits("7.")).toBe("7000000");
    expect(() => toBaseUnits("1.0000001")).toThrow();
    expect(() => toBaseUnits("-5")).toThrow();
    expect(() => toBaseUnits("abc")).toThrow();
  });

  it("formats base units as dollars without float errors", () => {
    expect(formatUsd("95000000")).toBe("$95.00");
    expect(formatUsd("1234567890")).toBe("$1,234.56789");
    expect(formatUsd("100")).toBe("$0.0001");
    expect(formatUsd(0n)).toBe("$0.00");
    expect(formatUsd("18446744073709551615")).toBe("$18,446,744,073,709.551615");
    expect(formatUsd("1500000000", { compact: true })).toBe("$1.5k");
  });

  it("round-trips input values", () => {
    expect(toInputValue("25500000")).toBe("25.5");
    expect(toInputValue(toBaseUnits("49.99"))).toBe("49.99");
  });

  it("applies basis points with floor division like the program", () => {
    expect(percentOf("100000000", 500)).toBe(5000000n);
    expect(percentOf("19", 500)).toBe(0n);
  });
});
