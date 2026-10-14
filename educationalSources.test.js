import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./api/_security.js", () => ({ secureRequest: vi.fn(async () => ({ uid: "test" })), fetchWithTimeout: vi.fn() }));
import handler, { normalizeResearchQueries } from "./api/educational-sources.js";
import { fetchWithTimeout } from "./api/_security.js";

afterEach(() => vi.clearAllMocks());
describe("public educational retrieval", () => {
  it("bounds queries and prevents user-selected remote hosts", () => {
    const queries = normalizeResearchQueries(Array.from({ length: 10 }, () => ({ query: "bridge", source: "https://internal", section: "Measurement" })));
    expect(queries).toHaveLength(3);
    expect(queries[0].source).toBe("wikipedia");
    expect(normalizeResearchQueries([{ query: "missing section" }])).toEqual([]);
  });
  it("retains usable evidence when another public source fails", async () => {
    fetchWithTimeout.mockImplementation(async (url) => {
      if (String(url).includes("europepmc")) throw new Error("unavailable");
      return { ok: true, json: async () => ({ query: { pages: [{ pageid: 123, title: "Wheatstone bridge", extract: "A bridge circuit compares electrical resistances." }] } }) };
    });
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handler({ method: "POST", body: { queries: [{ query: "Wheatstone bridge test", section: "Measurement" }, { query: "nerve test", source: "europepmc", section: "Physiology" }] } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ incomplete: true, sources: [expect.objectContaining({ url: "https://en.wikipedia.org/?curid=123", section: "Measurement" })] }));
  });
});
