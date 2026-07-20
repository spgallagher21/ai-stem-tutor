import { describe, expect, it } from "vitest";
import { buildGraphQuestion, normalizeGraphDefinition, sampleGraph } from "./graphing";

describe("deterministic graphing", () => {
  it("normalizes and samples a safe equation", () => {
    const graph = normalizeGraphDefinition({ equation: "y = x^2 - 1", domain_min: -2, domain_max: 2 });
    expect(graph.equation).toBe("x^2 - 1");
    expect(sampleGraph(graph, 4)[2]).toEqual({ x: 0, y: -1 });
  });

  it("rejects unsafe expressions and builds questions from equation ground truth", () => {
    expect(normalizeGraphDefinition({ equation: "evaluate(x)" })).toBeNull();
    const question = buildGraphQuestion({ id: "g1", equation: "2*x + 3", domain_min: -5, domain_max: 5 });
    expect(question.correct_option).toBe("y = 2*x + 3");
    expect(question.visual_question.assets[0].render_ref).toBe("2*x + 3");
  });
});
