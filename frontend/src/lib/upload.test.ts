import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, validateImageFile } from "./upload";

describe("validateImageFile", () => {
  it("accepts common image types within the size limit", () => {
    expect(validateImageFile({ type: "image/jpeg", size: 2_000_000 })).toBeNull();
    expect(validateImageFile({ type: "image/heic", size: MAX_UPLOAD_BYTES })).toBeNull();
  });

  it("rejects other types, oversized and empty files", () => {
    expect(validateImageFile({ type: "image/gif", size: 10 })).toMatch(/JPG/);
    expect(validateImageFile({ type: "application/pdf", size: 10 })).toMatch(/JPG/);
    expect(validateImageFile({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 })).toMatch(/15MB/);
    expect(validateImageFile({ type: "image/png", size: 0 })).toMatch(/empty/);
  });
});
