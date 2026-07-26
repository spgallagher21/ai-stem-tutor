import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathMarkdown, placeLessonCalculations } from "./noteMath";

describe("lesson maths presentation", () => {
  it("repairs escaped inline delimiters and JSON-damaged LaTeX controls", () => {
    const raw = String.raw`Range: \$0^{\circ}\text{C}\$ to \(\frac{100}{5}\).`.replace("\\text", "\text").replace("\\frac", "\frac");
    expect(normalizeMathMarkdown(raw)).toBe(String.raw`Range: $0^{\circ}\text{C}$ to $\frac{100}{5}$.`);
  });

  it("renders the reported PT100 example as KaTeX instead of literal dollar text", () => {
    const text = String.raw`A PT100 has a range of $0^{\circ}\text{C}$ to $100^{\circ}\text{C}$ and an output of $4\text{ mA}$ to $20\text{ mA}$.`;
    const markup = renderToStaticMarkup(React.createElement(
      ReactMarkdown,
      { remarkPlugins: [[remarkMath, { singleDollarTextMath: true }]], rehypePlugins: [rehypeKatex] },
      normalizeMathMarkdown(text),
    ));
    expect(markup).toContain("class=\"katex\"");
    expect(markup).not.toContain("$0^{");
  });

  it("places anchored checks under their equation and worked step", () => {
    const lesson = {
      sections: [{ equations: [{ number: "1" }, { number: "2" }] }],
      worked_example: { steps: ["Substitute", "Evaluate"] },
      verified_calculations: [
        { label: "Span", equation_number: "2" },
        { label: "Final value", worked_step: 2 },
      ],
    };
    const placed = placeLessonCalculations(lesson);
    expect(placed.byEquation["0:1"][0].label).toBe("Span");
    expect(placed.byWorkedStep["1"][0].label).toBe("Final value");
  });

  it("keeps legacy unanchored checks beside the worked calculation", () => {
    const placed = placeLessonCalculations({
      sections: [{ equations: [{ number: "1" }] }],
      worked_example: { steps: ["Substitute", "Evaluate"] },
      verified_calculations: [{ label: "Legacy result" }],
    });
    expect(placed.byWorkedStep["1"][0].label).toBe("Legacy result");
    expect(placed.unplaced).toEqual([]);
  });
});
