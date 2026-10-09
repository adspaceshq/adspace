// USDC has 6 decimals. The API sends amounts as base-unit strings; never use floats for money.
const DECIMALS = 6n;
const UNIT = 10n ** DECIMALS;

export function toBaseUnits(input: string): string {
  const text = input.trim().replace(/[$,\s]/g, "");
  const match = /^(\d{1,12})(?:\.(\d{0,6}))?$/.exec(text);
  if (!match) throw new Error("enter an amount like 25 or 25.50 (max 6 decimals)");
  return (BigInt(match[1]) * UNIT + BigInt((match[2] ?? "").padEnd(6, "0") || "0")).toString();
}

function split(baseUnits: string | bigint) {
  const value = typeof baseUnits === "bigint" ? baseUnits : BigInt(baseUnits);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return { negative, whole: absolute / UNIT, fraction: absolute % UNIT };
}

// "$1,234.50"; shows extra decimals only when the amount has them (e.g. "$0.000125").
export function formatUsd(baseUnits: string | bigint, options: { compact?: boolean } = {}): string {
  const { negative, whole, fraction } = split(baseUnits);
  const sign = negative ? "-" : "";
  if (options.compact && whole >= 1000n) {
    const thousands = Number(whole) / 1000;
    return `${sign}$${thousands >= 1000 ? `${(thousands / 1000).toFixed(1)}m` : `${thousands.toFixed(1)}k`}`;
  }
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractionText = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  const cents = fractionText.length <= 2 ? fractionText.padEnd(2, "0") : fractionText;
  return `${sign}$${grouped}.${cents}`;
}

// Plain number string for inputs: "25.5".
export function toInputValue(baseUnits: string | bigint): string {
  const { negative, whole, fraction } = split(baseUnits);
  const fractionText = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fractionText ? `.${fractionText}` : ""}`;
}

export function percentOf(baseUnits: string | bigint, bps: number): bigint {
  const value = typeof baseUnits === "bigint" ? baseUnits : BigInt(baseUnits);
  return (value * BigInt(bps)) / 10_000n;
}
