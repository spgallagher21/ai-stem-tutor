import { describe, expect, it } from "vitest";
import { extractQuotaInfo, modelsForTools, requestUsesGoogleSearch } from "./api/generate";

describe("Gemini request routing", () => {
  it("recognises grounded search requests", () => {
    expect(requestUsesGoogleSearch([{ google_search: {} }])).toBe(true);
    expect(requestUsesGoogleSearch(undefined)).toBe(false);
    expect(modelsForTools([{ google_search: {} }])[0]).toBe("gemini-2.5-flash-lite");
    expect(modelsForTools(undefined)[0]).toBe("gemini-3.1-flash-lite");
  });

  it("extracts safe quota diagnostics", () => {
    const info = extractQuotaInfo({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "requests_per_day", quotaId: "free-tier" }] }] } });
    expect(info).toEqual({ quotaMetric: "requests_per_day", quotaReason: "free-tier" });
  });
});
