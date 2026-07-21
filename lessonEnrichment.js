import { validateVisualRequests } from "./visualEnhancements";

const clean = (value, max = 6000) => String(value || "").trim().slice(0, max);

export function validateEnrichmentPlan(value, sectionHeadings = []) {
  const headings = new Set(sectionHeadings.map((heading) => clean(heading, 160)).filter(Boolean));
  const seen = new Set();
  const enrichments = (value?.enrichments || [])
    .filter((item) => item && headings.has(clean(item.after_section_heading, 160)))
    .map((item, index) => ({
      id: clean(item.id || `enrichment-${index + 1}`, 80),
      after_section_heading: clean(item.after_section_heading, 160),
      heading: clean(item.heading || "Further context", 160),
      body: clean(item.body),
      why_needed: clean(item.why_needed, 500),
    }))
    .filter((item) => item.body && !seen.has(item.after_section_heading) && seen.add(item.after_section_heading))
    .slice(0, 8);

  const visualRequests = validateVisualRequests({ requests: value?.visual_requests || value?.requests || [] })
    .filter((item) => headings.has(item.section_heading))
    .slice(0, 12);

  return { enrichments, visual_requests: visualRequests };
}
