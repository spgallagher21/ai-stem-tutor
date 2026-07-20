const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS = (process.env.OPENROUTER_VISION_MODELS || "qwen/qwen2.5-vl-32b-instruct:free,openrouter/free").split(",").map((model) => model.trim()).filter(Boolean);
const STEM_MODELS = (process.env.OPENROUTER_STEM_VISION_MODELS || "qwen/qwen3-vl-32b-instruct,google/gemini-3.1-flash-lite").split(",").map((model) => model.trim()).filter(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

async function callVision(model, prompt, imageBase64, { json = false } = {}) {
  const response = await fetchWithTimeout(OPENROUTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] }],
    }),
  }, 60_000);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || `OpenRouter request failed with status ${response.status}.`);
  return { content: data.choices?.[0]?.message?.content || "", model: data.model || model };
}

export function isReliableMathTranscription(transcript, verification) {
  const confidence = Number(transcript?.confidence || 0);
  const verifierConfidence = Number(verification?.confidence || 0);
  const ambiguities = Array.isArray(transcript?.ambiguities) ? transcript.ambiguities : [];
  const discrepancies = Array.isArray(verification?.discrepancies) ? verification.discrepancies : [];
  return Boolean(String(transcript?.transcription_markdown || "").trim()) && transcript?.image_quality !== "poor" && confidence >= 0.9 && verification?.approved === true && verifierConfidence >= 0.9 && ambiguities.length === 0 && discrepancies.length === 0;
}

async function transcribeMathAnswer(imageBase64) {
  const transcriptionPrompt = `Transcribe this student's handwritten mathematics exactly and conservatively. Preserve every visible line in reading order, including crossed-out work only when it affects interpretation. Convert mathematical notation to LaTeX inside Markdown. Never solve, correct, simplify, infer a missing symbol, or add steps. Distinguish 1/l, 0/O, x/×, minus signs, subscripts, superscripts, roots, fractions, brackets, vectors, units, decimal points, and equality/inequality signs. If any symbol is unclear, record an ambiguity instead of guessing.

Return JSON only with this shape:
{"transcription_markdown":"...","equations_latex":["..."],"final_answer":"... or empty","confidence":0.0,"image_quality":"good|usable|poor","ambiguities":[{"location":"line or region","candidates":["..."],"reason":"..."}]}`;

  let transcript;
  let transcriptModel;
  let lastError;
  for (const model of MODELS) {
    try {
      const result = await callVision(model, transcriptionPrompt, imageBase64, { json: true });
      transcript = parseJsonContent(result.content);
      transcriptModel = result.model;
      break;
    } catch (error) { lastError = error; }
  }
  if (!transcript) throw lastError || new Error("Could not transcribe the handwritten answer.");

  const verificationPrompt = `Independently compare this image with the proposed transcription below. Do not solve or correct the mathematics. Check every symbol, operator, number, exponent, subscript, fraction, bracket, unit, equality sign, line break, and final answer against the pixels. Reject if anything material is missing, invented, reordered, or ambiguous.

PROPOSED_TRANSCRIPTION_START
${JSON.stringify(transcript)}
PROPOSED_TRANSCRIPTION_END

Return JSON only:
{"approved":false,"confidence":0.0,"discrepancies":[{"location":"...","expected":"...","observed":"..."}]}`;
  let verification;
  let verifierModel;
  lastError = null;
  for (const model of [...MODELS].reverse()) {
    try {
      const result = await callVision(model, verificationPrompt, imageBase64, { json: true });
      verification = parseJsonContent(result.content);
      verifierModel = result.model;
      break;
    } catch (error) { lastError = error; }
  }
  if (!verification) throw lastError || new Error("Could not verify the handwritten transcription.");

  const confidence = Number(transcript.confidence || 0);
  const verifierConfidence = Number(verification.confidence || 0);
  const ambiguities = Array.isArray(transcript.ambiguities) ? transcript.ambiguities : [];
  const discrepancies = Array.isArray(verification.discrepancies) ? verification.discrepancies : [];
  const reliable = isReliableMathTranscription(transcript, verification);
  return { reliable, transcription: String(transcript.transcription_markdown || ""), equations: transcript.equations_latex || [], finalAnswer: String(transcript.final_answer || ""), confidence, verifierConfidence, imageQuality: transcript.image_quality || "poor", ambiguities, discrepancies, modelUsed: transcriptModel, verifierModel };
}

async function recognizeStemNotation(imageBase64) {
  const prompt = `Inspect this single lecture-note page specifically for chemical structure diagrams and electrical circuit schematics. Do not describe ordinary prose, decorative images, graphs, or equations.

For every chemical structure, transcribe only bonds and stereochemistry that are clearly visible. Give a SMILES string only when every material atom, bond order, charge, ring closure, and stereochemical marker is unambiguous; otherwise leave smiles empty and record ambiguities. For every circuit, transcribe component ids/types/values and explicit node connectivity. Never infer a hidden wire, value, bond, or stereocentre.

Return JSON only:
{"chemical_structures":[{"id":"chem-1","title":"...","compound_name":"... or empty","smiles":"... or empty","confidence":0.0,"ambiguities":["..."]}],"circuits":[{"id":"circuit-1","title":"...","confidence":0.0,"components":[{"id":"R1","type":"resistor","value":"10 kOhm","from":"node-a","to":"node-b"}],"ambiguities":["..."]}]}`;
  const first = await callVision(STEM_MODELS[0], prompt, imageBase64, { json: true });
  const recognition = parseJsonContent(first.content);
  const verificationPrompt = `Independently verify the proposed chemistry/circuit transcription against the pixels. Reject an item if any atom, bond order, stereochemistry, charge, component type, component value, node, or wire is missing, invented, or ambiguous. Do not repair it and do not solve the circuit.

PROPOSED_START
${JSON.stringify(recognition)}
PROPOSED_END

Return JSON only: {"approved_chemical_ids":["..."],"approved_circuit_ids":["..."],"confidence":0.0,"discrepancies":["..."]}`;
  const second = await callVision(STEM_MODELS[1] || STEM_MODELS[0], verificationPrompt, imageBase64, { json: true });
  const verification = parseJsonContent(second.content);
  const approvedChemicals = new Set(verification.approved_chemical_ids || []); const approvedCircuits = new Set(verification.approved_circuit_ids || []);
  const reliable = Number(verification.confidence || 0) >= 0.9 && !(verification.discrepancies || []).length;
  return {
    chemical_structures: reliable ? (recognition.chemical_structures || []).filter((item) => approvedChemicals.has(item.id) && Number(item.confidence || 0) >= 0.9 && !(item.ambiguities || []).length && (item.smiles || item.compound_name)) : [],
    circuits: reliable ? (recognition.circuits || []).filter((item) => approvedCircuits.has(item.id) && Number(item.confidence || 0) >= 0.9 && !(item.ambiguities || []).length && item.components?.length) : [],
    reliable, modelUsed: first.model, verifierModel: second.model,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!await secureRequest(req, res, { limit: 12, maxBodyBytes: 8 * 1024 * 1024 })) return;

  const { imageBase64, mode = "describe" } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required." });
  try { validateBase64(imageBase64, 6 * 1024 * 1024); } catch (error) { return res.status(400).json({ error: error.message }); }
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({ error: "Image description is not configured." });
  }

  if (mode === "math_answer") {
    try {
      const result = await transcribeMathAnswer(imageBase64);
      if (!result.reliable) return res.status(422).json({ error: "The handwriting could not be transcribed with enough confidence. Please retake the photo or type the answer.", ...result });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(502).json({ error: error.message || "Handwritten maths transcription failed." });
    }
  }

  if (mode === "stem_notation") {
    try { return res.status(200).json(await recognizeStemNotation(imageBase64)); }
    catch (error) { return res.status(502).json({ error: error.message || "STEM notation recognition failed." }); }
  }

  const prompt = "Describe this lecture slide image in detail for a student who cannot see it. If it is a diagram, chart, scan, histology image, table, circuit, graph, or figure, describe its structure, labeled parts, axes, trends, spatial relationships, or steps precisely enough that someone could reason about it from your description alone. If it is decorative or mostly text-only, say so plainly.";
  let lastError = "OpenRouter request failed.";

  for (let i = 0; i < MODELS.length; i += 1) {
    const model = MODELS[i];
    try {
      const result = await callVision(model, prompt, imageBase64);
      return res.status(200).json({ description: result.content, modelUsed: result.model });
    } catch (err) {
      lastError = err.message || "Network error calling OpenRouter.";
      if (i < MODELS.length - 1) {
        await sleep(700 + Math.random() * 400);
        continue;
      }
    }
  }

  return res.status(502).json({ error: lastError });
}
import { fetchWithTimeout, secureRequest, validateBase64 } from "./_security.js";
