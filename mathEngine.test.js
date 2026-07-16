import { describe, expect, it } from "vitest";
import { assertQuestionCalculation, calculateExpression, extractLastNumericValue, numericAnswersMatch, verifyCalculationRequests } from "./mathEngine";

describe("deterministic maths pipeline", () => {
  it("calculates arithmetic without model arithmetic", () => expect(calculateExpression({ expression: "12 * 3.5" }).numericValue).toBe(42));
  it("calculates and converts physical units", () => {
    const result = calculateExpression({ expression: "12 kg * 3.5 m/s^2", expected_unit: "N" });
    expect(result.numericValue).toBe(42);
    expect(result.verified).toBe(true);
  });
  it("rejects assignments and unsafe operations", () => expect(() => calculateExpression({ expression: "x = 4" })).toThrow());
  it("normalizes common multiplication symbols", () => expect(calculateExpression({ expression: "6 × 7" }).numericValue).toBe(42));
  it("keeps valid requests when an optional request is malformed", () => expect(verifyCalculationRequests([{ expression: "x = 4" }, { expression: "6 * 7" }])).toHaveLength(1));
  it("requires calculator requests for numerical questions", () => expect(() => verifyCalculationRequests([], { required: true })).toThrow());
  it("checks generated multiple-choice answers against the calculator", () => {
    const calculation = calculateExpression({ expression: "6 * 7" });
    expect(assertQuestionCalculation({ type: "multiple_choice", requires_calculation: true, options: ["40", "41", "42", "43"], correct_option: "42", verified_calculations: [calculation] }).correct_option).toBe("42");
  });
  it("extracts and compares a student's final value", () => {
    const calculation = calculateExpression({ expression: "100 / 4" });
    expect(numericAnswersMatch(extractLastNumericValue("Therefore the answer is 25.0 N"), calculation)).toBe(true);
  });
});
