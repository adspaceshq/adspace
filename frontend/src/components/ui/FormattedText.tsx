import { Fragment } from "react";
import { parseBlocks, type Inline } from "@/lib/formatting";
import { cx } from "@/lib/cx";

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.kind === "text") return <Fragment key={index}>{node.text}</Fragment>;
        if (node.kind === "bold") return <strong key={index} className="font-semibold text-ink"><InlineNodes nodes={node.children} /></strong>;
        if (node.kind === "italic") return <em key={index}><InlineNodes nodes={node.children} /></em>;
        if (node.kind === "code") return <code key={index} className="rounded bg-ink/5 px-1 font-mono text-[0.9em]">{node.text}</code>;
        return (
          // User links: open in a new tab and pass no referrer or ranking credit.
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="font-medium text-accent underline-offset-2 hover:underline">
            <InlineNodes nodes={node.children} />
          </a>
        );
      })}
    </>
  );
}

// Renders user text written with the formatting toolbar (or plain text, which reads as typed).
export function FormattedText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={cx("flex flex-col gap-3 break-words", className)}>
      {blocks.map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                <InlineNodes nodes={line} />
              </Fragment>
            ))}
          </p>
        ) : block.kind === "bullets" ? (
          <ul key={index} className="list-disc space-y-1 pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <InlineNodes nodes={item} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={index} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <InlineNodes nodes={item} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}
