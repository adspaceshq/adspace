import type { ListingSeller } from "@/lib/api/types";

export function SellerAvatar({ seller, size = 32 }: { seller: Pick<ListingSeller, "handle" | "displayName" | "avatarUrl">; size?: number }) {
  if (seller.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small remote avatars from X/Google
      <img src={seller.avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {(seller.displayName || seller.handle).replace(/^@/, "").slice(0, 1).toUpperCase()}
    </span>
  );
}
