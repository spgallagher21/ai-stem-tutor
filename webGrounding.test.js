import { describe, expect, it } from "vitest";
import { extractWebSources, notesChatScopeKey } from "./webGrounding";

describe("web grounding", () => {
  it("extracts unique web sources from Gemini grounding metadata", () => {
    const metadata = { groundingChunks: [
      { web: { title: "University source", uri: "https://example.edu/topic" } },
      { web: { title: "Duplicate", uri: "https://example.edu/topic" } },
      { web: { title: "Reference", uri: "https://example.org/reference" } },
      {},
    ] };
    expect(extractWebSources(metadata)).toEqual([
      { title: "University source", url: "https://example.edu/topic" },
      { title: "Reference", url: "https://example.org/reference" },
    ]);
  });

  it("keeps lesson conversations separate from module conversations", () => {
    expect(notesChatScopeKey("module-1", "lesson-2")).toBe("module-1_lesson-2");
    expect(notesChatScopeKey("module-1")).toBe("module-1");
  });
});
