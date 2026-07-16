import { describe, expect, it } from "vitest";
import { confidenceFlag, confidenceInsight, normalizeConfidence } from "./confidence";

describe("confidence learning signals", () => {
  it("normalises invalid confidence safely", () => expect(normalizeConfidence("unknown")).toBe(3));
  it("detects confident misconceptions", () => expect(confidenceFlag({ partial_credit_percent: 30, confidence: 5 })).toBe("confident_misconception"));
  it("detects correct answers that still feel uncertain", () => expect(confidenceFlag({ correct: true, confidence: 1 })).toBe("uncertain_correct"));
  it("explains why a confident error is prioritised", () => expect(confidenceInsight({ correct: false, confidence: 4 })).toContain("prioritised"));
});
