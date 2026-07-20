import { compile } from "mathjs";

const clean = (value, max = 240) => String(value || "").trim().slice(0, max);
const FORBIDDEN = /\b(import|createUnit|evaluate|parse|simplify|derivative|resolve|typed)\b|[;{}\[\]]/i;

export function normalizeGraphDefinition(value, index = 0) {
  const variable = /^[a-z]$/i.test(clean(value?.variable, 1)) ? clean(value.variable, 1) : "x";
  const rawEquation = clean(value?.equation, 300).replace(/^\s*[a-z]\s*=\s*/i, "");
  if (!rawEquation || FORBIDDEN.test(rawEquation) || rawEquation.includes("=")) return null;
  const domainMin = Number.isFinite(Number(value?.domain_min)) ? Number(value.domain_min) : -5;
  const domainMax = Number.isFinite(Number(value?.domain_max)) ? Number(value.domain_max) : 5;
  if (domainMin >= domainMax || domainMax - domainMin > 10000) return null;
  try { compile(rawEquation).evaluate({ [variable]: (domainMin + domainMax) / 2 }); } catch { return null; }
  return { id: clean(value?.id || `graph-${index + 1}`, 80), title: clean(value?.title || "Function graph", 120), section_heading: clean(value?.section_heading, 160), purpose: clean(value?.purpose, 320), equation: rawEquation, variable, domain_min: domainMin, domain_max: domainMax, x_label: clean(value?.x_label || variable, 40), y_label: clean(value?.y_label || "y", 40) };
}

export function sampleGraph(graph, samples = 180) {
  const definition = normalizeGraphDefinition(graph);
  if (!definition) return [];
  const evaluator = compile(definition.equation); const points = [];
  for (let index = 0; index <= samples; index += 1) {
    const x = definition.domain_min + (definition.domain_max - definition.domain_min) * index / samples;
    try { const y = Number(evaluator.evaluate({ [definition.variable]: x })); points.push(Number.isFinite(y) ? { x, y } : null); } catch { points.push(null); }
  }
  return points;
}

export function buildGraphQuestion(graph, id = "") {
  const definition = normalizeGraphDefinition(graph);
  if (!definition) return null;
  const correct = `y = ${definition.equation}`;
  const distractors = [`y = (${definition.equation}) + 1`, `y = -(${definition.equation})`, `y = (${definition.equation})/2`].filter((item) => item !== correct);
  return { id: id || `graph-question-${definition.id}`, type: "multiple_choice", question: "Which equation produced the graph shown?", options: [correct, ...distractors].slice(0, 4), correct_option: correct, modelAnswer: `The graph was rendered directly from $${correct.replace("y = ", "y=")}$.`, hint: "Compare the intercepts, sign, and vertical scale.", marks: 2, difficulty: 3, requires_calculation: false, calculation_requests: [], technical_visual_ids: [], visual_question: { question_id: id || `graph-question-${definition.id}`, type: "select_correct", domain: "math", prompt_text: "Which equation produced this graph?", assets: [{ asset_id: definition.id, render_source: "equation", render_ref: definition.equation }], correct_answer: correct, distractors, source_metadata: { attribution: "Generated locally from the verified lesson equation", license: "", original_source_url: "" }, verification_method: "canonicalized_match", moderation_status: "approved" }, graph: definition };
}
