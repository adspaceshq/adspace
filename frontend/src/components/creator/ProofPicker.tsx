"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api/v2";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useTx } from "@/lib/use-tx";
import { cx } from "@/lib/cx";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TxStatus } from "@/components/ui/TxStatus";
import { GaslessPrompt } from "@/components/app/GaslessPrompt";
import { useToast } from "@/components/ToastProvider";
import { PostComposer } from "./PostComposer";

// Creator tags posts as delivery proof for one spot; their hash goes on-chain.
export function ProofPicker({
  listingId,
  spotId,
  spotIndex,
  open,
  onClose,
}: {
  listingId: string;
  spotId: string;
  spotIndex: number;
  open: boolean;
  onClose: () => void;
}) {
  const { wallet } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  // True while Privy's gasless approval popup is open; the dialog steps aside so it can be clicked.
  const [approving, setApproving] = useState(false);
  const posts = useQuery({ queryKey: queryKeys.posts(listingId), queryFn: () => api.listings.posts(listingId), enabled: open });
  const [picked, setPicked] = useState<string[]>([]);
  const tx = useTx((ids: string[]) => api.spots.submitProof(spotId, ids));

  const submit = async () => {
    if (await tx.execute(picked)) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me", "listing", listingId] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.posts(listingId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.creatorDashboard }),
      ]);
      onClose();
      toast.success(`proof submitted for spot ${spotIndex + 1}`, "the sponsor's review window has started.");
    }
  };

  return (
    <Modal
      open={open}
      suspended={approving}
      onClose={() => !approving && onClose()}
      title={`proof for spot ${spotIndex + 1}`}
      description="pick the posts that show this sponsor's brand in place. they can't be deleted afterwards."
      footer={
        wallet.delegated ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={tx.busy}>
              cancel
            </Button>
            <Button onClick={() => void submit()} loading={tx.busy} disabled={picked.length === 0}>
              submit proof
            </Button>
          </>
        ) : undefined
      }
    >
      {!wallet.delegated ? (
        <GaslessPrompt action="submit proof" onBusyChange={setApproving} />
      ) : posts.isPending ? (
        <p className="text-small text-muted">loading posts…</p>
      ) : (posts.data ?? []).length === 0 ? (
        // No posts yet: write one here instead of leaving for the updates tab; it is ticked once posted.
        <div className="flex flex-col gap-2">
          <p className="text-small text-muted">you haven&apos;t posted yet. add a photo or link that shows the brand in place.</p>
          <PostComposer listingId={listingId} title="post your proof" onPosted={(id) => setPicked([id])} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(posts.data ?? []).map((post) => {
            const checked = picked.includes(post.id);
            return (
              <label
                key={post.id}
                className={cx(
                  "flex cursor-pointer gap-3 rounded-card border p-3 transition-colors",
                  checked ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => setPicked((current) => (checked ? current.filter((id) => id !== post.id) : [...current, post.id].slice(0, 10)))}
                  className="mt-1 size-4 accent-ink"
                />
                {post.media[0] && (
                  // eslint-disable-next-line @next/next/no-img-element -- post thumbnail
                  <img src={post.media[0].url} alt="" className="size-14 shrink-0 rounded-control object-cover" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-body">{post.body || post.url || "photo"}</span>
                  <span className="text-small text-muted">{new Date(post.createdAt).toLocaleString()}</span>
                </span>
              </label>
            );
          })}
          <TxStatus state={tx.state} action="proof" onRetry={tx.retry} />
        </div>
      )}
    </Modal>
  );
}
