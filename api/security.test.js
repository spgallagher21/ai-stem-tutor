import { describe, expect, it } from "vitest";
import { authenticationMode } from "./_security";

describe("API authentication configuration", () => {
  it("uses Firebase when a project is configured", () => {
    expect(authenticationMode({ FIREBASE_PROJECT_ID: "studyloop" })).toBe("firebase");
  });

  it("fails closed when authentication is missing", () => {
    expect(authenticationMode({ NODE_ENV: "production" })).toBe("misconfigured");
    expect(authenticationMode({})).toBe("misconfigured");
  });

  it("allows explicitly enabled local development only", () => {
    expect(authenticationMode({ ALLOW_LOCAL_UNAUTHENTICATED: "true", NODE_ENV: "development" })).toBe("local");
    expect(authenticationMode({ ALLOW_LOCAL_UNAUTHENTICATED: "true", VERCEL_ENV: "production" })).toBe("misconfigured");
  });
});
