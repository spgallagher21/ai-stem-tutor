import { describe, expect, it } from "vitest";
import { canFallbackSearchQuota, extractQuotaInfo, modelsForTools, requestUsesGoogleSearch } from "./api/generate";

describe("Gemini request routing", () => {
  it("falls back only for model-scoped generation quotas", () => {
    const quota = (violation) => ({ error: { details: [{ violations: [violation] }] } });
    expect(canFallbackSearchQuota(quota({ quotaMetric: "generate_content_requests", quotaDimensions: { model: "flash" } }))).toBe(true);
    expect(canFallbackSearchQuota(quota({ quotaMetric: "grounding_search_requests", quotaDimensions: { model: "flash" } }))).toBe(false);
    expect(canFallbackSearchQuota(quota({ quotaMetric: "requests_per_project" }))).toBe(false);
    expect(canFallbackSearchQuota({ error: { message: "Resource exhausted" } })).toBe(false);
  });
  it("recognises grounded search requests", () => {
    expect(requestUsesGoogleSearch([{ google_search: {} }])).toBe(true);
    expect(requestUsesGoogleSearch(undefined)).toBe(false);
    expect(modelsForTools([{ google_search: {} }])[0]).toBe("gemini-3.8-flash");
    expect(modelsForTools(undefined)[0]).toBe("gemini-3.5-flash-lite");
  });

  it("extracts safe quota diagnostics", () => {
    const info = extractQuotaInfo({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "requests_per_day", quotaId: "free-tier" }] }] } });
    expect(info).toEqual({ quotaMetric: "requests_per_day", quotaReason: "free-tier" });
  });
});
