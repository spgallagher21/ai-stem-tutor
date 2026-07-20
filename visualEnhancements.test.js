import { describe, expect, it } from "vitest";
import { isMedicalVisual, validateVisualRequests, visualCacheKey } from "./visualEnhancements";

describe("visual enhancement requests", () => {
  it("keeps only bounded structured requests", () => {
    const requests = validateVisualRequests({ requests: [{ type: "molecule_2d", domain: "chemistry", compound_name: "Aspirin", title: "Structure" }, { type: "made_up", query: "ignore" }] });
    expect(requests).toHaveLength(1);
    expect(requests[0].compound_name).toBe("Aspirin");
  });

  it("uses stable cache keys and flags medical content", () => {
    const request = { type: "anatomy", domain: "anatomy", fma_id: "FMA7163" };
    expect(visualCacheKey(request)).toContain("fma7163");
    expect(isMedicalVisual(request)).toBe(true);
  });
});
