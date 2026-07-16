import { describe, expect, it } from "vitest";
import { isReliableMathTranscription } from "./api/describe-image";

const transcript = { transcription_markdown: "$x^2 = 4$", confidence: 0.96, image_quality: "good", ambiguities: [] };
const verification = { approved: true, confidence: 0.95, discrepancies: [] };

describe("handwritten maths reliability gate", () => {
  it("accepts only independently approved high-confidence transcription", () => expect(isReliableMathTranscription(transcript, verification)).toBe(true));
  it("rejects ambiguous symbols", () => expect(isReliableMathTranscription({ ...transcript, ambiguities: [{ location: "line 1" }] }, verification)).toBe(false));
  it("rejects verifier discrepancies", () => expect(isReliableMathTranscription(transcript, { ...verification, discrepancies: [{ location: "line 1" }] })).toBe(false));
  it("rejects low quality and low confidence", () => expect(isReliableMathTranscription({ ...transcript, image_quality: "poor", confidence: 0.4 }, verification)).toBe(false));
});
