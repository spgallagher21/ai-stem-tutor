import { describe, expect, it } from "vitest";
import { fitQuestionsForCloud, jsonBytes } from "./cloudPersistence";

describe("cloud document size protection", () => {
  it("keeps recent questions within the configured byte budget", () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      question: "x".repeat(500),
      attempts: [{ feedback: "y".repeat(500) }, { feedback: "z".repeat(500) }],
    }));
    const fitted = fitQuestionsForCloud(questions, 3_000);
    expect(jsonBytes({ questions: fitted })).toBeLessThanOrEqual(3_000);
    expect(fitted.at(-1).id).toBe("9");
  });

  it("does not mutate the local question history", () => {
    const questions = [{ id: "q", attempts: [{ id: 1 }, { id: 2 }] }];
    fitQuestionsForCloud(questions, 45);
    expect(questions[0].attempts).toHaveLength(2);
  });
});
