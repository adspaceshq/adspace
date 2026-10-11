// User-supplied links are checked by the API, but render only https so a bad value can never become
// a javascript: or data: link.
export function safeHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}
