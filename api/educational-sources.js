import { fetchWithTimeout, secureRequest } from "./_security.js";

const cache = new Map();
const text = (value, max = 240) => String(value || "").replace(/<[^>]*>/g, " ").trim().slice(0, max);

export function normalizeResearchQueries(queries) {
  return (Array.isArray(queries) ? queries : []).slice(0, 3).map((item) => ({
    query: text(item.query, 180),
    source: item.source === "europepmc" ? "europepmc" : "wikipedia",
    section: text(item.section, 160),
  })).filter((item) => item.query && item.section);
}

async function getJson(url) {
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json", "User-Agent": "StudyLoop/1.0 (educational source retrieval)" } }, 12000);
  if (!response.ok) throw new Error(`Educational source returned ${response.status}.`);
  return response.json();
}

async function retrieve(item) {
  const key = JSON.stringify([item.source, item.query]);
  const cached = cache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.sources.map((source) => ({ ...source, section: item.section }));
  let sources;
  if (item.source === "europepmc") {
    const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
    url.search = new URLSearchParams({ query: item.query, format: "json", resultType: "core", pageSize: "3" });
    const data = await getJson(url);
    sources = (data.resultList?.result || []).filter((article) => article.abstractText && /^[\w-]+$/.test(article.id) && /^[\w-]+$/.test(article.source)).map((article) => ({
      title: text(article.title, 300), url: `https://europepmc.org/article/${article.source}/${article.id}`,
      passage: text(article.abstractText, 3500), kind: "research abstract", attribution: "Europe PMC", year: text(article.pubYear, 4),
    }));
  } else {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: item.query, gsrlimit: "2", gsrnamespace: "0", prop: "extracts", exintro: "1", explaintext: "1", exlimit: "2", exchars: "1200" });
    const data = await getJson(url);
    sources = (data.query?.pages || []).filter((page) => page.extract && page.pageid).map((page) => ({
      title: text(page.title, 300), url: `https://en.wikipedia.org/?curid=${Number(page.pageid)}`,
      passage: text(page.extract, 3500), kind: "encyclopedia introduction", attribution: "Wikipedia contributors; see source for licence and revision history",
    }));
  }
  cache.set(key, { sources, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
  while (cache.size > 200) cache.delete(cache.keys().next().value);
  return sources.map((source) => ({ ...source, section: item.section }));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  if (!await secureRequest(req, res, { limit: 12, maxBodyBytes: 10000, allowGuestByok: true })) return;
  const queries = normalizeResearchQueries(req.body?.queries);
  const results = await Promise.allSettled(queries.map(retrieve));
  const sources = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return res.status(200).json({ sources, incomplete: results.some((result) => result.status === "rejected") });
}
