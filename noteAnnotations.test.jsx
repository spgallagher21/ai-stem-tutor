import { describe, expect, it } from "vitest";
import { locateQuote } from "./NoteAnnotations";
describe("saved highlight anchoring", () => {
  it("keeps repeated passages attached to their selected occurrence", () => {
    expect(locateQuote("force force", { quote: "force", start: 6 })).toBe(6);
  });
  it("relocates a unique quote after an additive enhancement", () => {
    expect(locateQuote("new text original passage", { quote: "original passage", start: 0 })).toBe(9);
  });
  it("does not attach changed notes to an ambiguous or missing quote", () => {
    expect(locateQuote("force force", { quote: "force", start: 3 })).toBe(-1);
    expect(locateQuote("changed", { quote: "original", start: 0 })).toBe(-1);
  });
});
