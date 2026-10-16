import { useId } from "react";
import { ExternalLink } from "lucide-react";
import type { SpotDetail } from "@/lib/api/types";
import imageLoader from "@/lib/image-loader";
import { safeHref } from "@/lib/safe-href";

type Dispute = NonNullable<SpotDetail["dispute"]>;

// The sponsor's side (reason and evidence images) next to the creator's proof, so a decision can be
// made from one screen. Stacks on small screens.
export function DisputeEvidence({ dispute, proofPosts, headingLevel = "h2" }: { dispute: Dispute; proofPosts: SpotDetail["proofPosts"]; headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  const id = useId();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section aria-labelledby={`${id}-sponsor`} className="flex min-w-0 flex-col gap-2">
        <Heading id={`${id}-sponsor`} className="text-body font-semibold">
          sponsor&apos;s dispute
        </Heading>
        <blockquote className="whitespace-pre-line rounded-control bg-canvas px-3 py-2 text-body">&ldquo;{dispute.reason}&rdquo;</blockquote>
        {dispute.evidence.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2" aria-label="evidence images">
            {dispute.evidence.map((item, index) => (
              <li key={item.id}>
                <a
                  href={safeHref(item.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-control border border-line hover:border-line-strong"
                  aria-label={`open evidence image ${index + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- small evidence thumbnail from Cloudinary */}
                  <img src={imageLoader({ src: item.url, width: 240 })} alt={`evidence ${index + 1}`} className="aspect-square w-full object-cover" loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted">no images attached.</p>
        )}
      </section>
      <section aria-labelledby={`${id}-proof`} className="flex min-w-0 flex-col gap-2">
        <Heading id={`${id}-proof`} className="text-body font-semibold">
          creator&apos;s proof
        </Heading>
        {proofPosts.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {proofPosts.map((post) => (
              <li key={post.id} className="rounded-control border border-line bg-surface px-3 py-2">
                {post.body && <p className="whitespace-pre-line text-body">{post.body}</p>}
                {post.url && (
                  <a href={safeHref(post.url)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-small font-medium text-accent hover:underline">
                    open post <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
                <p className="mt-1 text-caption text-muted">{new Date(post.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-control bg-canvas px-3 py-2 text-small text-muted">no proof submitted.</p>
        )}
      </section>
    </div>
  );
}
