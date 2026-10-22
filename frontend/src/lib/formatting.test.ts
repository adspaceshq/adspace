import { describe, expect, it } from "vitest";
import { applyFormat, parseBlocks, parseInline, safeUrl } from "./formatting";

describe("parseInline", () => {
  it("reads bold, italic, code and links", () => {
    expect(parseInline("a **b** *c* `d`")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "italic", children: [{ kind: "text", text: "c" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "d" },
    ]);
    expect(parseInline("see [docs](https://adspaces.fun/help)")[1]).toEqual({ kind: "link", href: "https://adspaces.fun/help", children: [{ kind: "text", text: "docs" }] });
  });

  it("links bare addresses without trailing punctuation", () => {
    expect(parseInline("go to https://adspaces.fun.")).toEqual([
      { kind: "text", text: "go to " },
      { kind: "link", href: "https://adspaces.fun", children: [{ kind: "text", text: "https://adspaces.fun" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("never links unsafe addresses", () => {
    const parsed = parseInline("[x](javascript:alert(1)) [y](data:text/html,hi)");
    expect(parsed.some((node) => node.kind === "link")).toBe(false);
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://ok.example/path")).toBe("https://ok.example/path");
  });

  it("leaves plain text, unclosed markers and snake_case alone", () => {
    expect(parseInline("plain text")).toEqual([{ kind: "text", text: "plain text" }]);
    expect(parseInline("2 * 3 = 6 and **open")).toEqual([{ kind: "text", text: "2 * 3 = 6 and **open" }]);
    expect(parseInline("my_wallet_name")).toEqual([{ kind: "text", text: "my_wallet_name" }]);
  });
});

describe("parseBlocks", () => {
  it("splits paragraphs and lists", () => {
    const blocks = parseBlocks("intro line\nsecond line\n\n- one\n- two\n\n1. first\n2. second");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "bullets", "numbers"]);
    expect(blocks[0].kind === "paragraph" && blocks[0].lines.length).toBe(2);
    expect(blocks[1].kind === "bullets" && blocks[1].items.length).toBe(2);
  });

  it("keeps old plain descriptions as they were", () => {
    expect(parseBlocks("Laptop lid at Token2049.\nSeen by thousands.")).toEqual([
      { kind: "paragraph", lines: [[{ kind: "text", text: "Laptop lid at Token2049." }], [{ kind: "text", text: "Seen by thousands." }]] },
    ]);
  });
});

describe("applyFormat", () => {
  it("wraps the selection in bold and keeps it selected", () => {
    const edit = applyFormat("make this bold", 5, 9, "bold");
    expect(edit.value).toBe("make **this** bold");
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe("this");
  });

  it("inserts a placeholder when nothing is selected", () => {
    expect(applyFormat("", 0, 0, "italic").value).toBe("*italic text*");
  });

  it("makes a link and selects its address", () => {
    const edit = applyFormat("our site", 4, 8, "link");
    expect(edit.value).toBe("our [site](https://)");
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe("https://");
  });

  it("turns selected lines into a list, and switches list types", () => {
    expect(applyFormat("one\ntwo", 0, 7, "bullets").value).toBe("- one\n- two");
    expect(applyFormat("- one\n- two", 0, 11, "numbers").value).toBe("1. one\n2. two");
  });
});
