import { describe, expect, it } from "vitest";
import { validateEnrichmentPlan } from "./lessonEnrichment";

describe("validateEnrichmentPlan", () => {
  it("keeps only additions with exact section anchors", () => {
    const result = validateEnrichmentPlan({
      enrichments: [
        { id: "a", after_section_heading: "Cell membranes", heading: "Microscopy context", body: "A useful extension." },
        { id: "b", after_section_heading: "cell membranes", heading: "Wrong case", body: "Should not survive." },
        { id: "c", after_section_heading: "Unknown", heading: "Off scope", body: "Should not survive." },
      ],
      visual_requests: [
        { id: "v1", type: "reference_image", domain: "biology", title: "Membrane", purpose: "Show the arrangement", query: "cell membrane", section_heading: "Cell membranes" },
        { id: "v2", type: "reference_image", domain: "biology", title: "Other", purpose: "Off scope", query: "organism", section_heading: "Unknown" },
      ],
    }, ["Cell membranes"]);

    expect(result.enrichments).toHaveLength(1);
    expect(result.visual_requests).toHaveLength(1);
    expect(result.visual_requests[0].section_heading).toBe("Cell membranes");
  });

  it("allows only one external expansion per original section", () => {
    const result = validateEnrichmentPlan({ enrichments: [
      { id: "a", after_section_heading: "Forces", heading: "One", body: "First" },
      { id: "b", after_section_heading: "Forces", heading: "Two", body: "Second" },
    ] }, ["Forces"]);
    expect(result.enrichments.map((item) => item.id)).toEqual(["a"]);
  });
});
