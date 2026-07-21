import { fetchWithTimeout, secureRequest } from "./_security.js";

const cache = globalThis.__studyLoopContentCache || new Map();
globalThis.__studyLoopContentCache = cache;
const LICENSE_PATTERN = /(creativecommons\.org\/(publicdomain|licenses\/(by|by-sa))|\bCC0\b|\bCC BY(?:-SA)?\b)/i;

function clean(value, max = 300) { return String(value || "").trim().slice(0, max); }
function stripHtml(value) { return clean(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "), 300); }
async function getJson(url) {
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json", "User-Agent": "StudyLoop/1.0 educational-content-resolver" } }, 15_000);
  if (!response.ok) throw new Error(`Trusted source returned ${response.status}.`);
  return response.json();
}

async function resolveMolecule(request) {
  const namespace = request.smiles ? "smiles" : "name";
  const identifier = clean(request.smiles || request.compound_name, 500);
  if (!identifier) throw new Error("A SMILES string or compound name is required.");
  const base = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${namespace}/${encodeURIComponent(identifier)}`;
  const data = await getJson(`${base}/property/Title,IUPACName,ConnectivitySMILES,SMILES,MolecularFormula/JSON`);
  const property = data?.PropertyTable?.Properties?.[0];
  if (!property?.CID) throw new Error("PubChem could not verify this compound.");
  return { status: "ready", kind: "molecule_2d", title: property.Title || request.title, cid: property.CID, iupacName: property.IUPACName || "", smiles: property.SMILES || property.ConnectivitySMILES || identifier, formula: property.MolecularFormula || "", imageUrl: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${property.CID}/PNG?image_size=large`, sourceUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${property.CID}`, attribution: "PubChem, National Library of Medicine" };
}

async function resolveStructure(request) {
  const pdbId = clean(request.pdb_id, 8).toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(pdbId)) throw new Error("A valid four-character PDB ID is required.");
  const data = await getJson(`https://data.rcsb.org/rest/v1/core/entry/${encodeURIComponent(pdbId)}`);
  return { status: "ready", kind: "structure_3d", title: request.title || data?.struct?.title || `PDB ${pdbId}`, pdbId, viewerUrl: `https://molstar.org/viewer/?pdb=${encodeURIComponent(pdbId)}&hide-controls=1`, sourceUrl: `https://www.rcsb.org/structure/${encodeURIComponent(pdbId)}`, attribution: "RCSB Protein Data Bank · rendered with Mol*" };
}

async function resolveBiologyImage(request) {
  const data = await getJson(`https://api.gbif.org/v1/occurrence/search?scientific_name=${encodeURIComponent(clean(request.query, 180))}&media_type=StillImage&limit=20`);
  for (const occurrence of data?.results || []) for (const media of occurrence.media || []) {
    if (media.type !== "StillImage" || !media.identifier || !LICENSE_PATTERN.test(media.license || "")) continue;
    return { status: "ready", kind: "reference_image", title: request.title || occurrence.scientificName || request.query, imageUrl: media.identifier, sourceUrl: media.references || occurrence.references || `https://www.gbif.org/occurrence/${occurrence.key}`, license: media.license, attribution: [media.creator, media.rightsHolder, "GBIF"].filter(Boolean).join(" · ") };
  }
  throw new Error("GBIF returned no image with a confirmed reusable licence.");
}

async function resolveAstronomyImage(request) {
  const data = await getJson(`https://images-api.nasa.gov/search?q=${encodeURIComponent(clean(request.query, 180))}&media_type=image&page_size=20`);
  const item = (data?.collection?.items || []).find((entry) => entry?.links?.some((link) => link.render === "image") && entry?.data?.[0]?.nasa_id && entry?.data?.[0]?.center);
  if (!item) throw new Error("NASA returned no verified image for this query.");
  const metadata = item.data[0]; const image = item.links.find((link) => link.render === "image");
  return { status: "ready", kind: "reference_image", title: request.title || metadata.title || request.query, imageUrl: image.href, sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(metadata.nasa_id)}`, license: "NASA media usage guidelines", attribution: `${metadata.center} · NASA · ${metadata.nasa_id}` };
}

async function resolveCommonsImage(request) {
  const query = clean(request.query || request.title, 180);
  if (!query) throw new Error("A precise image query is required.");
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({ action: "query", generator: "search", gsrsearch: query, gsrnamespace: "6", gsrlimit: "12", prop: "imageinfo", iiprop: "url|mime|extmetadata", iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit", iiextmetadatalanguage: "en", iiurlwidth: "1400", format: "json", formatversion: "2" }).toString();
  const data = await getJson(url.toString());
  for (const page of data?.query?.pages || []) {
    const info = page?.imageinfo?.[0]; const metadata = info?.extmetadata || {};
    const license = stripHtml(metadata.LicenseShortName?.value || metadata.License?.value);
    const licenseUrl = clean(metadata.LicenseUrl?.value, 500);
    if (!info?.url || !String(info.mime || "").startsWith("image/") || !LICENSE_PATTERN.test(`${license} ${licenseUrl}`)) continue;
    const creator = stripHtml(metadata.Artist?.value || metadata.Credit?.value);
    return { status: "ready", kind: "reference_image", title: request.title || clean(page.title?.replace(/^File:/, ""), 120) || query, imageUrl: info.thumburl || info.url, sourceUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`, license: license || licenseUrl, attribution: [creator, "Wikimedia Commons"].filter(Boolean).join(" · ") };
  }
  throw new Error("Wikimedia Commons returned no relevant image with a confirmed reusable licence.");
}

async function resolve(request) {
  if (request.domain === "medical" || request.domain === "anatomy" || request.type === "anatomy") return { status: "review_required", kind: request.type, title: request.title, reason: "Medical and anatomy visuals require explicit human review before student display.", fmaId: request.fma_id || "" };
  if (request.type === "molecule_2d") return resolveMolecule(request);
  if (request.type === "structure_3d") return resolveStructure(request);
  if (request.type === "circuit") return { status: "ready", kind: "circuit", title: request.title, components: request.components || [], attribution: "Deterministic StudyLoop schematic" };
  if (request.type === "reference_image" && request.domain === "biology") return resolveBiologyImage(request);
  if (request.type === "reference_image" && request.domain === "astronomy") return resolveAstronomyImage(request);
  if (request.type === "reference_image") return resolveCommonsImage(request);
  return { status: "unsupported", kind: request.type, title: request.title, reason: "No licence-safe resolver is available for this request." };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  if (!await secureRequest(req, res, { limit: 40, maxBodyBytes: 100_000 })) return;
  const requests = Array.isArray(req.body?.requests) ? req.body.requests.slice(0, 12) : [];
  const results = [];
  for (const request of requests) {
    const key = clean(req.body?.cacheNamespace, 100) + ":" + clean(request.cacheKey, 700);
    if (cache.has(key)) { results.push(cache.get(key)); continue; }
    try { const result = { id: clean(request.id, 80), purpose: clean(request.purpose, 400), sectionHeading: clean(request.section_heading, 160), ...(await resolve(request)) }; cache.set(key, result); results.push(result); }
    catch (error) { results.push({ id: clean(request.id, 80), kind: request.type, title: clean(request.title, 120), status: "unavailable", reason: error.message }); }
  }
  return res.status(200).json({ results });
}
