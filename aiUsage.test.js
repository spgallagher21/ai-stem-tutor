import { describe, expect, it } from "vitest";
import { describeAiFailure, mergeAiUsage } from "./aiUsage";

describe("AI usage diagnostics", () => {
  it("keeps actual provider attempts and token totals", () => {
    const usage = mergeAiUsage({ providerAttempts: 2, inputTokens: 100 }, { apiRequests: 1, providerAttempts: 2, searchRequests: 1, inputTokens: 50, outputTokens: 20, totalTokens: 70 });
    expect(usage).toMatchObject({ apiRequests: 1, providerAttempts: 4, searchRequests: 1, inputTokens: 150, outputTokens: 20, totalTokens: 70 });
  });

  it("distinguishes the app limiter from Gemini quota failures", () => {
    expect(describeAiFailure({ errorSource: "app_rate_limit", retryAfterSeconds: 22 }, 429).message).toContain("StudyLoop");
    expect(describeAiFailure({ requestKind: "search", model: "gemini-2.5-flash-lite" }, 429).message).toContain("Google Search");
  });

  it("does not tell students to wait for a daily limit", () => {
    const result = describeAiFailure({ quotaMetric: "generate_content_free_tier_requests_per_day", model: "gemini-3.1-flash-lite" }, 429);
    expect(result.retryable).toBe(false);
    expect(result.message).toContain("daily allowance");
    expect(describeAiFailure({ requestKind: "search", retryAfterSeconds: 3600 }, 429).retryable).toBe(false);
  });
});
