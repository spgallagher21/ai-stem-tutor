import { describe, expect, it } from "vitest";
import { authenticationMode, firebaseProjectId, requestAuthenticationMode } from "./_security";

describe("API authentication configuration", () => {
  it("uses Firebase when a project is configured", () => {
    expect(authenticationMode({ FIREBASE_PROJECT_ID: "studyloop" })).toBe("firebase");
    expect(authenticationMode({ VITE_FIREBASE_PROJECT_ID: "studyloop" })).toBe("firebase");
    expect(firebaseProjectId({ VITE_FIREBASE_PROJECT_ID: "studyloop" })).toBe("studyloop");
  });

  it("rejects mismatched browser and server Firebase projects", () => {
    expect(authenticationMode({ FIREBASE_PROJECT_ID: "server", VITE_FIREBASE_PROJECT_ID: "browser" })).toBe("misconfigured");
    expect(firebaseProjectId({ FIREBASE_PROJECT_ID: "server", VITE_FIREBASE_PROJECT_ID: "browser" })).toBe(null);
  });

  it("fails closed when authentication is missing", () => {
    expect(authenticationMode({ NODE_ENV: "production" })).toBe("misconfigured");
    expect(authenticationMode({})).toBe("misconfigured");
  });

  it("allows explicitly enabled local development only", () => {
    expect(authenticationMode({ ALLOW_LOCAL_UNAUTHENTICATED: "true", NODE_ENV: "development" })).toBe("local");
    expect(authenticationMode({ ALLOW_LOCAL_UNAUTHENTICATED: "true", VERCEL_ENV: "production" })).toBe("misconfigured");
  });

  it("permits only explicitly BYOK-capable routes in local-only production", () => {
    const production = { VERCEL_ENV: "production" };
    expect(requestAuthenticationMode(production)).toBe("misconfigured");
    expect(requestAuthenticationMode(production, { allowGuestByok: true })).toBe("guest-byok");
  });
});
