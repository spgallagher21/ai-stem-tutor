import { describe, expect, it } from "vitest";
import { validateVisualQuestion, verifyVisualQuestionAgainstAssets } from "./visualQuestions";

describe("visual question schema", () => {
  it("keeps equation-grounded approved questions", () => {
    const result = validateVisualQuestion({ question_id: "q1", type: "select_correct", domain: "math", prompt_text: "Choose", assets: [{ asset_id: "g1", render_source: "equation", render_ref: "x^2" }], correct_answer: "y=x^2", distractors: [], verification_method: "canonicalized_match", moderation_status: "approved" });
    expect(result.assets[0].render_ref).toBe("x^2");
  });

  it("never auto-approves anatomy imagery", () => {
    expect(validateVisualQuestion({ question_id: "q2", type: "identify", domain: "anatomy", prompt_text: "Identify", assets: [{ asset_id: "a", render_source: "fma_id", render_ref: "FMA7163" }], correct_answer: "skin", verification_method: "lookup_table", moderation_status: "approved" })).toBeNull();
  });

  it("binds questions only to the exact render source", () => {
    const question = { type: "multiple_choice", correct_option: "Aspirin", visual_question: { question_id: "q", type: "identify", domain: "chemistry", prompt_text: "Identify", assets: [{ asset_id: "m1", render_source: "smiles", render_ref: "CCO" }], correct_answer: "Aspirin", verification_method: "canonicalized_match", moderation_status: "approved" } };
    expect(verifyVisualQuestionAgainstAssets(question, [{ id: "m1", kind: "molecule_2d", smiles: "CCO" }]).technical_visual_ids).toEqual(["m1"]);
    expect(verifyVisualQuestionAgainstAssets(question, [{ id: "m1", kind: "molecule_2d", smiles: "CCC" }]).visual_question).toBeNull();
  });
});
