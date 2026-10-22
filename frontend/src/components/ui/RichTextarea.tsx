"use client";

import { useId, useRef, useState } from "react";
import { Bold, Eye, Italic, Link2, List, ListOrdered, PenLine } from "lucide-react";
import { applyFormat, type FormatAction } from "@/lib/formatting";
import { cx } from "@/lib/cx";
import { FormattedText } from "./FormattedText";

const ACTIONS: Array<{ action: FormatAction; label: string; shortcut?: string; icon: typeof Bold }> = [
  { action: "bold", label: "bold", shortcut: "Ctrl+B", icon: Bold },
  { action: "italic", label: "italic", shortcut: "Ctrl+I", icon: Italic },
  { action: "bullets", label: "bulleted list", icon: List },
  { action: "numbers", label: "numbered list", icon: ListOrdered },
  { action: "link", label: "link", shortcut: "Ctrl+K", icon: Link2 },
];
const SHORTCUTS: Record<string, FormatAction> = { b: "bold", i: "italic", k: "link" };

// A text field with a formatting toolbar (bold, italic, lists, links) and a preview. It writes the
// small Markdown subset FormattedText renders, so the stored value stays plain, readable text.
// Grows with its text up to a cap, then scrolls inside; never resized by hand.
export function RichTextarea({
  label,
  hint,
  error,
  value,
  onChange,
  rows = 5,
  maxLength,
  placeholder,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  const format = (action: FormatAction) => {
    const element = area.current;
    if (!element) return;
    const edit = applyFormat(value, element.selectionStart, element.selectionEnd, action);
    if (maxLength && edit.value.length > maxLength) return;
    onChange(edit.value);
    // Restore focus and the new selection once React has applied the value.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-medium">
        {label}
      </label>
      <div className={cx("overflow-hidden rounded-control border bg-surface focus-within:ring-2 focus-within:ring-accent-ring", error ? "border-danger" : "border-line focus-within:border-accent")}>
        <div role="toolbar" aria-label="formatting" className="flex items-center gap-0.5 border-b border-line px-1.5 py-1">
          {ACTIONS.map(({ action, label: name, shortcut, icon: Icon }) => (
            <button
              key={action}
              type="button"
              disabled={preview}
              onClick={() => format(action)}
              title={shortcut ? `${name} (${shortcut})` : name}
              aria-label={name}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-ink/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:size-10"
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreview((current) => !current)}
            aria-pressed={preview}
            className="ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-small font-medium text-muted hover:bg-ink/5 hover:text-ink pointer-coarse:h-10"
          >
            {preview ? <PenLine className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            {preview ? "write" : "preview"}
          </button>
        </div>
        {preview ? (
          <div className="max-h-80 min-h-24 overflow-y-auto px-3 py-2 text-body thin-scrollbar">
            {value.trim() ? <FormattedText text={value} /> : <p className="text-muted">nothing to preview yet.</p>}
          </div>
        ) : (
          <textarea
            ref={area}
            id={id}
            value={value}
            rows={rows}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              const action = (event.ctrlKey || event.metaKey) && SHORTCUTS[event.key.toLowerCase()];
              if (action) {
                event.preventDefault();
                format(action);
              }
            }}
            className="block max-h-80 min-h-24 w-full resize-none overflow-y-auto bg-transparent px-3 py-2 text-body placeholder:text-muted focus:outline-none thin-scrollbar field-sizing-content"
          />
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-small text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-small text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
