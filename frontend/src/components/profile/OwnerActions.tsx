"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/lib/session";

// The page is server-rendered for everyone; only the owner sees the edit link.
export function OwnerActions({ profileId }: { profileId: string }) {
  const { session } = useSession();
  if (session?.id !== profileId) return null;
  return (
    <Link href="/settings#profile" className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-small font-medium hover:border-line-strong">
      <Pencil className="size-3.5" aria-hidden /> edit profile
    </Link>
  );
}
