import { calibrateLearningMinutes } from "./timeEstimates";
import { normalizeGraphDefinition } from "./graphing";
import { validateVisualQuestion } from "./visualQuestions";

const QUESTION_TYPES = new Set(["multiple_choice", "fill_blank", "short_answer", "derivation", "long_answer"]);
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

export function validateQuestion(question) {
  if (!question || !QUESTION_TYPES.has(question.type) || !String(question.question || "").trim()) {
    throw new Error("The AI returned an invalid question. Please regenerate it.");
  }
  const next = {
    ...question,
    question: String(question.question).trim(),
    modelAnswer: String(question.modelAnswer || "").trim(),
    hint: String(question.hint || "").trim(),
    marks: clamp(question.marks, 1, 100, 5),
    difficulty: clamp(question.difficulty, 1, 5, 3),
    technical_visual_ids: [...new Set((question.technical_visual_ids || []).map(String).filter(Boolean))].slice(0, 4),
    visual_question: validateVisualQuestion(question.visual_question),
  };
  if (!next.modelAnswer) throw new Error("The AI returned a question without a model answer.");
  if (next.type === "multiple_choice") {
    next.options = [...new Set((question.options || []).map((item) => String(item).trim()).filter(Boolean))];
    next.correct_option = String(question.correct_option || "").trim();
    if (next.options.length !== 4 || !next.options.includes(next.correct_option)) throw new Error("The AI returned malformed answer choices.");
  } else {
    next.options = [];
    next.correct_option = "";
  }
  return next;
}

export function validateGrading(value) {
  if (!value || typeof value !== "object") throw new Error("The AI returned invalid grading feedback.");
  return {
    correct: Boolean(value.correct),
    partial_credit_percent: clamp(value.partial_credit_percent, 0, 100, value.correct ? 100 : 0),
    feedback: String(value.feedback || "No feedback was returned."),
    misconception: String(value.misconception || ""),
    what_to_review: String(value.what_to_review || ""),
    mistake_type: ["concept_gap", "careless_error", "misread_question", "none"].includes(value.mistake_type) ? value.mistake_type : "concept_gap",
    rubric_results: Array.isArray(value.rubric_results) ? value.rubric_results.slice(0, 12) : [],
  };
}

export function validateLesson(value, validPages = []) {
  if (!value || !Array.isArray(value.sections) || !value.sections.length || !String(value.summary || "").trim()) {
    throw new Error("The AI returned an incomplete lesson. Please regenerate it.");
  }
  const allowed = new Set(validPages.map(Number));
  return {
    ...value,
    schemaVersion: 2,
    sections: value.sections.filter((section) => section && section.heading && section.body).slice(0, 20),
    source_refs: [...new Set((value.source_refs || []).map(String))].slice(0, 30),
    flagged_image_pages: (value.flagged_image_pages || []).filter((item) => !allowed.size || allowed.has(Number(item.page))),
    graphs: (value.graphs || []).map(normalizeGraphDefinition).filter(Boolean).slice(0, 8),
  };
}

export function validateCurriculum(value) {
  if (!value || !Array.isArray(value.topics) || !value.topics.length) throw new Error("The AI returned an empty curriculum.");
  const names = new Set();
  value.topics.forEach((topic) => {
    const name = String(topic.name || "").trim().toLowerCase();
    if (!name || names.has(name)) throw new Error("The AI returned duplicate or unnamed topics.");
    names.add(name);
    topic.subtopics = (topic.subtopics || []).map((item) => {
      const difficulty = clamp(item.difficulty, 1, 5, 3);
      return { ...item, difficulty, estimatedMinutes: calibrateLearningMinutes(item.estimatedMinutes, difficulty), timeEstimateVersion: 2 };
    });
  });
  return value;
}

export function validateNotesAnswer(value, pageMap = []) {
  if (!value || !String(value.answer || "").trim()) throw new Error("The AI returned an empty notes answer.");
  const normalize = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const validPages = new Set(pageMap.filter((item) => !item.divider).map((item) => `${normalize(item.fileName)}:${Number(item.originalPage)}`));
  const citations = (value.citations || []).filter((citation) => validPages.has(`${normalize(citation.file_name)}:${Number(citation.page)}`)).slice(0, 12);
  return {
    answer: String(value.answer).trim(),
    supported: Boolean(value.supported) && citations.length > 0,
    uncertainty: String(value.uncertainty || ""),
    citations,
    follow_up_questions: (value.follow_up_questions || []).map(String).slice(0, 3),
  };
}
