const TYPES = new Set(["identify", "label", "sequence", "spot_fault", "match", "select_correct"]);
const DOMAINS = new Set(["chemistry", "anatomy", "circuits", "astronomy", "biology", "crystal", "physics", "math"]);
const METHODS = new Set(["canonicalized_match", "coordinate_projection", "simulation_result", "lookup_table"]);
const MODERATION = new Set(["pending", "approved", "rejected"]);

export function validateVisualQuestion(value) {
  if (!value || !TYPES.has(value.type) || !DOMAINS.has(value.domain) || !String(value.prompt_text || "").trim()) return null;
  const assets = (value.assets || []).filter((asset) => asset?.asset_id && asset?.render_source && asset?.render_ref).slice(0, 6).map((asset) => ({ asset_id: String(asset.asset_id), render_source: String(asset.render_source), render_ref: String(asset.render_ref) }));
  if (!assets.length || !METHODS.has(value.verification_method)) return null;
  const moderation_status = MODERATION.has(value.moderation_status) ? value.moderation_status : "pending";
  if (value.domain === "anatomy" && moderation_status === "approved") return null;
  return { question_id: String(value.question_id || ""), type: value.type, domain: value.domain, prompt_text: String(value.prompt_text), assets, correct_answer: value.correct_answer, distractors: (value.distractors || []).slice(0, 8), source_metadata: value.source_metadata || {}, verification_method: value.verification_method, moderation_status };
}

export function verifyVisualQuestionAgainstAssets(question, visualAssets = []) {
  const visual = validateVisualQuestion(question?.visual_question);
  if (!visual || (question.type === "multiple_choice" && String(visual.correct_answer) !== String(question.correct_option))) return { ...question, visual_question: null, technical_visual_ids: [] };
  const byId = new Map(visualAssets.map((asset) => [asset.id, asset]));
  const valid = visual.assets.every((ref) => {
    const asset = byId.get(ref.asset_id); if (!asset) return false;
    if (ref.render_source === "smiles") return asset.kind === "molecule_2d" && ref.render_ref === asset.smiles;
    if (ref.render_source === "netlist") return asset.kind === "circuit" && ref.render_ref === JSON.stringify(asset.components || []);
    return false;
  });
  return valid ? { ...question, visual_question: visual, technical_visual_ids: visual.assets.map((asset) => asset.asset_id) } : { ...question, visual_question: null, technical_visual_ids: [] };
}
