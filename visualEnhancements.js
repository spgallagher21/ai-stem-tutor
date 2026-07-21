const TYPES = new Set(["molecule_2d", "structure_3d", "circuit", "reference_image", "anatomy"]);
const DOMAINS = new Set(["chemistry", "biology", "astronomy", "medical", "electrical", "anatomy", "physics", "math", "crystal", "general"]);

const clean = (value, max = 240) => String(value || "").trim().slice(0, max);

export function validateVisualRequests(value) {
  return (value?.requests || [])
    .filter((item) => item && TYPES.has(item.type))
    .slice(0, 12)
    .map((item, index) => ({
      id: clean(item.id || `visual-${index + 1}`, 80),
      type: item.type,
      domain: DOMAINS.has(item.domain) ? item.domain : "general",
      title: clean(item.title || "Supplementary visual", 120),
      purpose: clean(item.purpose, 400),
      section_heading: clean(item.section_heading, 160),
      query: clean(item.query, 180),
      smiles: clean(item.smiles, 500),
      compound_name: clean(item.compound_name, 160),
      pdb_id: clean(item.pdb_id, 12).toUpperCase(),
      fma_id: clean(item.fma_id, 24).toUpperCase(),
      components: (item.components || []).slice(0, 30).map((component) => ({
        id: clean(component.id, 30), type: clean(component.type, 30).toLowerCase(),
        value: clean(component.value, 40), from: clean(component.from, 30), to: clean(component.to, 30),
      })),
    }))
    .filter((item) => item.query || item.smiles || item.compound_name || item.pdb_id || item.fma_id || item.components.length);
}

export function visualCacheKey(request) {
  return [request.type, request.domain, request.smiles || request.compound_name || request.pdb_id || request.fma_id || request.query || JSON.stringify(request.components)].join(":").toLowerCase();
}

export function isMedicalVisual(request) {
  return request?.domain === "medical" || request?.domain === "anatomy" || request?.type === "anatomy";
}
