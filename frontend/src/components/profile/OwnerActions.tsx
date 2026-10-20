"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/lib/session";
import { buttonClasses } from "@/components/ui/Button";

// The page is server-rendered for everyone; only the owner sees the edit link.
export function OwnerActions({ profileId }: { profileId: string }) {
  const { session } = useSession();
  if (session?.id !== profileId) return null;
  return (
    <Link href="/settings#profile" className={buttonClasses("secondary", "sm")}>
      <Pencil className="size-3.5" aria-hidden /> edit profile
    </Link>
  );
}
