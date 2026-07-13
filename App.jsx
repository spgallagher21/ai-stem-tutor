import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { AuthProvider, getSettings, saveSettings, useAuth } from "./AuthContext";
import { db, firebaseReady } from "./firebase";
import { getLocalPdf, saveLocalPdf } from "./localPdfStore";
import {
  MAX_INLINE_DOCUMENT_BYTES,
  arrayBufferToBase64,
  buildPageIndex,
  extractPages,
  inlinePdfDocumentPart,
  scoreRelevantPages,
  termsFor,
  waitForGlobal,
} from "./pdfUtils";

const GENERATE_ENDPOINT = "/api/generate";
const UPLOAD_FILE_ENDPOINT = "/api/upload-file";
const MAX_ATTEMPTS_STORED = 20;
const QUESTION_BATCH_SIZE = 3;
const APP_NAME = "StudyLoop";

const THEME_CHOICES = [
  { id: "aurora-dark", name: "Aurora Dark" },
  { id: "aurora-light", name: "Aurora Light" },
  { id: "sunset-dark", name: "Sunset Dark" },
  { id: "sunset-light", name: "Sunset Light" },
  { id: "verdant-dark", name: "Verdant Dark" },
  { id: "verdant-light", name: "Verdant Light" },
];

const REFERRAL_CHOICES = [
  { id: "friend", label: "Friend/classmate" },
  { id: "instagram", label: "Instagram" },
  { id: "search", label: "Online search" },
  { id: "other", label: "Other" },
];

function normalizeThemeId(theme) {
  if (theme === "aurora") return "aurora-dark";
  if (theme === "refraction") return "aurora-light";
  if (theme === "sunset") return "sunset-dark";
  return theme || "aurora-dark";
}

const QUESTION_TYPE_LABELS = {
  multiple_choice: "Multiple choice",
  fill_blank: "Fill in the blank",
  short_answer: "Short answer",
  derivation: "Derivation / worked problem",
  long_answer: "Long answer",
};

const DEFAULT_EXAM_PLAN = {
  question_types: [
    { type: "short_answer", weight_percent: 40, avg_marks: 5, style_notes: "Concise written answers." },
    { type: "multiple_choice", weight_percent: 25, avg_marks: 2, style_notes: "Single best answer." },
    { type: "fill_blank", weight_percent: 15, avg_marks: 2, style_notes: "Key term or value." },
    { type: "derivation", weight_percent: 20, avg_marks: 8, style_notes: "Multi-step derivation or problem." },
  ],
  overall_notes: "No past papers were provided, so this is a balanced default mix rather than one tailored to your actual exam.",
};

const CURRICULUM_SCHEMA = {
  type: "OBJECT",
  properties: {
    topics: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          subtopics: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                difficulty: { type: "NUMBER" },
                estimatedMinutes: { type: "NUMBER" },
                sourceFileNames: { type: "ARRAY", items: { type: "STRING" } },
                sourcePageHints: { type: "ARRAY", items: { type: "NUMBER" } },
              },
              required: ["name", "difficulty", "estimatedMinutes"],
            },
          },
          summary: { type: "STRING" },
        },
        required: ["name", "subtopics"],
      },
    },
  },
  required: ["topics"],
};

const SOURCE_INDEX_SCHEMA = {
  type: "OBJECT",
  properties: {
    documentTitle: { type: "STRING" },
    summary: { type: "STRING" },
    broadTopics: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          summary: { type: "STRING" },
          pageHints: { type: "ARRAY", items: { type: "NUMBER" } },
          likelySubtopics: { type: "ARRAY", items: { type: "STRING" } },
          keywords: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["name", "summary"],
      },
    },
  },
  required: ["documentTitle", "summary", "broadTopics"],
};

const MODULE_INDEX_SCHEMA = {
  type: "OBJECT",
  properties: {
    sourceIndex: SOURCE_INDEX_SCHEMA,
    curriculum: CURRICULUM_SCHEMA,
  },
  required: ["sourceIndex", "curriculum"],
};

const LESSON_SCHEMA_V2 = {
  type: "OBJECT",
  properties: {
    learning_outcomes: { type: "ARRAY", items: { type: "STRING" } },
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          heading: { type: "STRING" },
          body: { type: "STRING" },
          equations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                latex: { type: "STRING" },
                number: { type: "STRING" },
                explanation: { type: "STRING" },
              },
              required: ["latex", "number"],
            },
          },
          real_world_example: { type: "STRING" },
        },
        required: ["heading", "body"],
      },
    },
    worked_example: {
      type: "OBJECT",
      properties: {
        problem_statement: { type: "STRING" },
        steps: { type: "ARRAY", items: { type: "STRING" } },
        final_answer: { type: "STRING" },
      },
    },
    diagram_mermaid: { type: "STRING" },
    common_mistakes: { type: "ARRAY", items: { type: "STRING" } },
    summary: { type: "STRING" },
    source_refs: { type: "ARRAY", items: { type: "STRING" } },
    used_web_search: { type: "BOOLEAN" },
    needs_external_info: { type: "BOOLEAN" },
    external_info_gaps: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["sections", "worked_example", "common_mistakes", "summary"],
};

const REVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    accuracy_issues: { type: "ARRAY", items: { type: "STRING" } },
    clarity_issues: { type: "ARRAY", items: { type: "STRING" } },
    missing_steps: { type: "ARRAY", items: { type: "STRING" } },
    verdict: { type: "STRING", enum: ["approved", "needs_revision"] },
  },
  required: ["verdict"],
};

const EXAM_PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    question_types: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: ["multiple_choice", "fill_blank", "short_answer", "derivation", "long_answer"] },
          weight_percent: { type: "NUMBER" },
          avg_marks: { type: "NUMBER" },
          style_notes: { type: "STRING" },
        },
        required: ["type", "weight_percent"],
      },
    },
    overall_notes: { type: "STRING" },
  },
  required: ["question_types"],
};

const QUESTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", enum: ["multiple_choice", "fill_blank", "short_answer", "derivation", "long_answer"] },
    question: { type: "STRING" },
    options: { type: "ARRAY", items: { type: "STRING" } },
    correct_option: { type: "STRING" },
    modelAnswer: { type: "STRING" },
    hint: { type: "STRING" },
    marks: { type: "NUMBER" },
    difficulty: { type: "NUMBER" },
  },
  required: ["type", "question", "modelAnswer", "hint"],
};

const QUESTION_BATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: { type: "ARRAY", items: QUESTION_SCHEMA },
  },
  required: ["questions"],
};

const GRADING_SCHEMA = {
  type: "OBJECT",
  properties: {
    correct: { type: "BOOLEAN" },
    partial_credit_percent: { type: "NUMBER" },
    feedback: { type: "STRING" },
    misconception: { type: "STRING" },
    what_to_review: { type: "STRING" },
    mistake_type: { type: "STRING", enum: ["concept_gap", "careless_error", "misread_question", "none"] },
  },
  required: ["correct", "partial_credit_percent", "feedback", "mistake_type"],
};

function buildTeachingPhilosophyPrompt(studyContext) {
  const audience = studyContext && studyContext.trim() ? studyContext.trim() : "college-level student";
  return `Teach this like the world's best tutor for a ${audience}. Break it into bite-sized sections, each building on the last. Use plain language; if a technical term is unavoidable, define it in plain terms the first time it appears. Every section should connect back to a real-world physical example, not just abstract math. Every full equation must be on its own line, numbered sequentially, with each term explained in words. Include a worked example that mirrors realistic exam difficulty. Avoid unnecessary jargon. Ground everything strictly in the provided lecture notes unless a fact is genuinely missing from them.`;
}

const TUTOR_VOICE_PROMPT = `Write like an experienced, respected tutor — direct and honest, not a cheerleader. When work is genuinely strong, say so specifically and briefly. When it's weak, say exactly what's wrong and why, without padding it in unearned praise first. Never open feedback with generic encouragement ("Great effort!", "Good job!") unless the work specifically earned it. Prioritize being useful to the student's understanding over being nice.`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeParseJSON(rawStr) {
  try {
    return JSON.parse(rawStr);
  } catch (e) {
    const jsonMatch = rawStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error("The AI returned data in an unexpected format. Please try again.");
  }
}

function assignIds(curriculum) {
  return {
    topics: (curriculum.topics || []).map((topic) => ({
      ...topic,
      id: topic.id || crypto.randomUUID(),
      subtopics: (topic.subtopics || []).map((st) => ({ ...st, id: st.id || crypto.randomUUID() })),
    })),
  };
}

function normalizeName(value) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function preserveCurriculumIds(previous, next) {
  const previousTopics = new Map((previous?.topics || []).map((topic) => [normalizeName(topic.name), topic]));
  return {
    topics: (next?.topics || []).map((topic) => {
      const existingTopic = previousTopics.get(normalizeName(topic.name));
      const previousSubtopics = new Map((existingTopic?.subtopics || []).map((st) => [normalizeName(st.name), st]));
      return {
        ...topic,
        id: topic.id || existingTopic?.id || crypto.randomUUID(),
        subtopics: (topic.subtopics || []).map((st) => {
          const existingSubtopic = previousSubtopics.get(normalizeName(st.name));
          return { ...st, id: st.id || existingSubtopic?.id || crypto.randomUUID() };
        }),
      };
    }),
  };
}

function lessonKey(subjectId, subtopicId) {
  return `${subjectId}_${subtopicId}`;
}

function computeSubjectProgress(curriculum, masteryLog = {}) {
  let totalMinutes = 0;
  let masteredMinutes = 0;
  (curriculum?.topics || []).forEach((topic) => {
    (topic.subtopics || []).forEach((st) => {
      const minutes = st.estimatedMinutes || 10;
      totalMinutes += minutes;
      if (masteryLog[st.id]?.status === "mastered") masteredMinutes += minutes;
    });
  });
  return totalMinutes ? Math.round((masteredMinutes / totalMinutes) * 100) : 0;
}

function pickWeighted(items, weightKey) {
  const total = items.reduce((s, i) => s + (i[weightKey] || 1), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it[weightKey] || 1;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function appendAttempt(question, attempt) {
  return {
    ...question,
    attempts: [attempt, ...(question.attempts || [])].slice(0, MAX_ATTEMPTS_STORED),
  };
}

function truncateText(text, maxChars) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}...` : clean;
}

function pickDigestPages(pageIndex = [], maxPages = 28) {
  if (pageIndex.length <= maxPages) return pageIndex;
  const selected = new Map();
  pageIndex.slice(0, 4).forEach((page) => selected.set(page.pageNum, page));
  pageIndex.slice(-2).forEach((page) => selected.set(page.pageNum, page));
  const remaining = maxPages - selected.size;
  for (let i = 0; i < remaining; i += 1) {
    const idx = Math.round((i / Math.max(remaining - 1, 1)) * (pageIndex.length - 1));
    selected.set(pageIndex[idx].pageNum, pageIndex[idx]);
  }
  return [...selected.values()].sort((a, b) => a.pageNum - b.pageNum);
}

function buildDocumentDigest(file, { maxPages = 28, charsPerPage = 900 } = {}) {
  const pages = pickDigestPages(file.pageIndex || [], maxPages);
  const pageDigest = pages
    .map((page) => `Page ${page.pageNum}: ${truncateText(page.text, charsPerPage)}`)
    .join("\n\n");
  return `File: ${file.name}
Pages in PDF: ${file.pageIndex?.length || "unknown"}
Sampled pages: ${pages.map((page) => page.pageNum).join(", ") || "none"}

${pageDigest || "No selectable text was extracted from this PDF."}`;
}

function scorePageIndex(pageIndex = [], queryText = "") {
  const terms = termsFor(queryText);
  if (!terms.length) return 0;
  return pageIndex.reduce((total, page) => {
    const lower = (page.text || "").toLowerCase();
    return total + terms.reduce((sum, term) => sum + lower.split(term).length - 1, 0);
  }, 0);
}

function compactSourceIndexes(sourceIndexes = []) {
  return sourceIndexes.map((entry) => ({
    fileName: entry.fileName,
    documentTitle: entry.index?.documentTitle,
    summary: entry.index?.summary,
    broadTopics: (entry.index?.broadTopics || []).map((topic) => ({
      name: topic.name,
      summary: topic.summary,
      pageHints: topic.pageHints || [],
      likelySubtopics: topic.likelySubtopics || [],
      keywords: topic.keywords || [],
    })),
  }));
}

function findRelevantSourceContext(subject, topic, subtopic) {
  const query = normalizeName(`${topic?.name || ""} ${subtopic?.name || ""}`);
  const matches = (subject.meta?.sourceIndexes || [])
    .map((entry) => {
      const topicHits = (entry.index?.broadTopics || []).filter((item) => {
        const haystack = normalizeName(`${item.name} ${item.summary} ${(item.likelySubtopics || []).join(" ")} ${(item.keywords || []).join(" ")}`);
        return query.split(" ").some((term) => term.length > 2 && haystack.includes(term));
      });
      return topicHits.length ? { fileName: entry.fileName, topics: topicHits } : null;
    })
    .filter(Boolean)
    .slice(0, 3);
  return matches.length ? JSON.stringify(matches) : "No saved source-index match found; rely on the scoped PDF pages.";
}

// --- 3.3 Adaptive question difficulty based on real performance ---
function computeAdaptiveDifficulty(baseDifficulty, bank) {
  const recentAttempts = bank
    .flatMap((q) => q.attempts || [])
    .slice(-5); // last 5 attempts across this subtopic's bank
  if (recentAttempts.length < 2) return baseDifficulty; // not enough signal yet
  const avg = recentAttempts.reduce((s, a) => s + (a.partial_credit_percent ?? (a.correct ? 100 : 0)), 0) / recentAttempts.length;
  if (avg >= 85) return Math.min(5, baseDifficulty + 1);
  if (avg <= 45) return Math.max(1, baseDifficulty - 1);
  return baseDifficulty;
}

// --- 2.1 / 2.2 Proactive client-side throttling + backoff with jitter ---
const CALL_WINDOW_MS = 60000;
const SOFT_CEILING = 8; // conservative soft cap, intentionally under any real per-minute limit
const callTimestamps = [];

function pruneCallLog() {
  const cutoff = Date.now() - CALL_WINDOW_MS;
  while (callTimestamps.length && callTimestamps[0] < cutoff) callTimestamps.shift();
}

function getThrottleWaitMs() {
  pruneCallLog();
  if (callTimestamps.length < SOFT_CEILING) return 0;
  const oldest = callTimestamps[0];
  return Math.max(0, CALL_WINDOW_MS - (Date.now() - oldest) + 250);
}

function usageStorageKey() {
  return `stem-ai-calls-${new Date().toISOString().slice(0, 10)}`;
}

function getUsageTodayCount() {
  try {
    return parseInt(localStorage.getItem(usageStorageKey()) || "0", 10);
  } catch (e) {
    return 0;
  }
}

function incrementUsageToday() {
  try {
    const next = getUsageTodayCount() + 1;
    localStorage.setItem(usageStorageKey(), String(next));
    return next;
  } catch (e) {
    return getUsageTodayCount();
  }
}

function recordCall() {
  pruneCallLog();
  callTimestamps.push(Date.now());
  incrementUsageToday();
}

async function callGemini({ contents, generationConfig, apiKey, documentPart, tools }, { retries = 2, onStatus } = {}) {
  const trimmedApiKey = (apiKey || "").trim();
  if (!trimmedApiKey) throw new Error("Enter your Gemini API key before using the tutor.");

  const waitMs = getThrottleWaitMs();
  if (waitMs > 0) {
    let remaining = Math.ceil(waitMs / 1000);
    onStatus?.(`The AI needs a few seconds to catch up (${remaining}s)...`);
    while (remaining > 0) {
      await sleep(1000);
      remaining -= 1;
      if (remaining > 0) onStatus?.(`The AI needs a few seconds to catch up (${remaining}s)...`);
    }
  }
  recordCall();

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(GENERATE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents, generationConfig, apiKey: trimmedApiKey, documentPart, tools }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data.error || `Request failed (status ${res.status}).`;
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const backoff = Math.min(8000, 700 * 2 ** attempt) + Math.random() * 400;
          onStatus?.("The AI is recharging for a moment...");
          await sleep(backoff);
          lastErr = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }
      const candidate = data.candidates?.[0];
      if (!candidate) throw new Error("Gemini returned no response.");
      if (candidate.finishReason === "SAFETY") throw new Error("Gemini blocked this response for safety reasons.");
      const textPart = candidate.content?.parts?.find((part) => part.text)?.text;
      if (!textPart) throw new Error("Gemini returned an empty response.");
      return textPart;
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) throw lastErr;
      const backoff = Math.min(8000, 700 * 2 ** attempt) + Math.random() * 400;
      onStatus?.("The AI is recharging for a moment...");
      await sleep(backoff);
    }
  }
  throw lastErr;
}

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const showToast = (message, variant = "info") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 5000);
  };
  const removeToast = (id) => setToasts((prev) => prev.filter((toast) => toast.id !== id));
  return { toasts, showToast, removeToast };
}

// --- 3.1 Markdown + math rendering, replacing the old CDN/race-prone renderer ---
const MathRenderer = ({ text, paper = false }) => (
  <div style={{ lineHeight: 1.75, color: paper ? "#1a1a1a" : "inherit" }}>
    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
      {text || ""}
    </ReactMarkdown>
  </div>
);

const MermaidRenderer = ({ chart, paper = false }) => {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);
  const id = useMemo(() => `mer-${crypto.randomUUID().replaceAll("-", "")}`, []);
useEffect(() => {
  let cancelled = false;
  const renderChart = async () => {
    if (!chart) return;
    try {
      await waitForGlobal("mermaid");
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: paper
          ? { background: "#fdfbf7", primaryColor: "#dbeafe", primaryTextColor: "#1a1a1a", lineColor: "#6b6459", tertiaryColor: "#f7f2e9" }
          : { background: "transparent", primaryColor: "#151e33", primaryTextColor: "#f1f5f9", lineColor: "#818cf8" },
      });
      await window.mermaid.parse(chart);
      const { svg: renderedSvg } = await window.mermaid.render(id, chart);
      if (!cancelled) setSvg(renderedSvg);
    } catch (e) {
      if (!cancelled) setError(true);
    }
  };
  renderChart();
  return () => {
    cancelled = true;
  };
}, [chart, id, paper]);

  if (error || !chart) return null;
  return <div style={{ margin: "22px 0", overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: svg }} />;
};

function ThemePreviewCard({ theme, selected, onSelect }) {
  return (
    <button className="card" data-theme={theme.id} onClick={onSelect} aria-label={theme.name} style={{ width: "100%", textAlign: "left", padding: 18, cursor: "pointer", borderColor: selected ? "var(--accent-1)" : "var(--border)", color: "var(--text)" }}>
      <div className="heading" style={{ fontWeight: 700, marginBottom: 12 }}>{theme.name}</div>
      <div className="progress-bar" style={{ marginBottom: 14 }}><span style={{ width: "68%" }} /></div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ height: 28, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6 }} />
        <div style={{ height: 28, width: "72%", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6 }} />
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <span style={{ width: 38, height: 16, borderRadius: 999, background: "var(--accent-1)", display: "inline-block" }} />
          <span style={{ width: 38, height: 16, borderRadius: 999, background: "var(--accent-2)", display: "inline-block" }} />
          <span style={{ width: 38, height: 16, borderRadius: 999, background: "var(--accent-3)", display: "inline-block" }} />
        </div>
      </div>
    </button>
  );
}

// --- Small reusable modal primitives (replace window.prompt / window.confirm) ---
function Modal({ title, children, onClose }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 2000, padding: 16 }}
      onClick={onClose}
    >
      <div className="card" style={{ padding: 24, width: "100%", maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="heading" style={{ marginTop: 0 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function RenameModal({ title, initialValue, placeholder, onCancel, onSave }) {
  const [value, setValue] = useState(initialValue || "");
  const canSave = value.trim().length > 0;
  return (
    <Modal title={title} onClose={onCancel}>
      <input
        className="input"
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && canSave) onSave(value.trim()); }}
        style={{ marginBottom: 16 }}
      />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={!canSave} onClick={() => onSave(value.trim())}>Save</button>
      </div>
    </Modal>
  );
}

function ConfirmModal({ title, message, confirmLabel = "Delete", onCancel, onConfirm }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="muted">{message}</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

// --- 1.1 Multi-step onboarding ---
const ONBOARDING_STEPS_FULL = ["welcome", "apikey", "theme", "survey", "context", "tutorial"];
const ONBOARDING_STEPS_EDIT = ["apikey", "context", "theme"];

function Onboarding({ settings, onDone, showToast, editMode = false, onCancel }) {
  const steps = editMode ? ONBOARDING_STEPS_EDIT : ONBOARDING_STEPS_FULL;
  const [stepIndex, setStepIndex] = useState(0);
  const [apiKey, setApiKey] = useState(settings.geminiApiKey || "");
  const [theme, setTheme] = useState(normalizeThemeId(settings.theme));
  const [studyContext, setStudyContext] = useState(settings.studyContext || "");
  const [referralSource, setReferralSource] = useState(settings.referralSource || "");

  useEffect(() => {
    document.documentElement.dataset.theme = normalizeThemeId(theme);
  }, [theme]);

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const finish = async () => {
    await onDone({
      geminiApiKey: apiKey.trim(),
      theme,
      studyContext: studyContext.trim(),
      referralSource,
      onboarded: true,
      tutorialSeen: editMode ? settings.tutorialSeen : false,
    });
  };

  const goNext = () => {
    if (step === "apikey" && !apiKey.trim()) {
      showToast("Add your Gemini API key to continue.", "error");
      return;
    }
    if (isLast) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    if (isFirst) {
      onCancel?.();
      return;
    }
    setStepIndex((i) => i - 1);
  };

  return (
    <div className="app-shell">
      <div className="container narrow card" style={{ padding: 28 }}>
        {!editMode && (
          <div className="muted mono" style={{ fontSize: 12, marginBottom: 18 }}>
            Step {stepIndex + 1} of {steps.length}
          </div>
        )}

        {step === "welcome" && (
          <>
            <h1 className="heading" style={{ marginTop: 0 }}>{APP_NAME}</h1>
            <p className="muted">Create a module, upload its lecture PDFs, and let {APP_NAME} organise them into topics, bite-sized classes, and lessons.</p>
            <p className="muted">Connecting your own free Gemini key keeps the app free to use, while {APP_NAME} adds the prompting, review passes, and practice logic that make the output feel closer to a paid tutoring tool.</p>
            <p className="muted">Your notes, modules, and progress stay under your account and are not shared with other users.</p>
          </>
        )}

        {step === "apikey" && (
          <>
            <h1 className="heading" style={{ marginTop: 0 }}>{editMode ? "Update your API key" : "Your Gemini API key"}</h1>
            <p className="muted">
              This is what keeps {APP_NAME} free for you: your own Gemini quota powers the AI, and the app layers specialist tutoring prompts and checks on top.
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Get a free key at{" "}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>:
              sign in with Google, click "Create API key," then paste it below.
            </p>
            <label className="muted" style={{ fontSize: 13 }}>Gemini API key</label>
            <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" style={{ margin: "8px 0 0" }} />
            {editMode && (
              <p className="muted mono" style={{ fontSize: 12, marginTop: 16 }}>AI calls today: {getUsageTodayCount()}</p>
            )}
          </>
        )}

        {step === "survey" && (
          <>
            <h1 className="heading" style={{ marginTop: 0 }}>Quick question</h1>
            <p className="muted">How did you hear about us?</p>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 16 }}>
              {REFERRAL_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  className={referralSource === choice.id ? "btn" : "btn secondary"}
                  onClick={() => setReferralSource(choice.id)}
                  style={{ textAlign: "center" }}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <button className="btn ghost" onClick={() => setReferralSource("")} style={{ marginTop: 12 }}>Prefer not to say</button>
          </>
        )}

        {step === "tutorial" && (
          <>
            <h1 className="heading" style={{ marginTop: 0 }}>A 60-second walkthrough</h1>
            <p className="muted">After this, the dashboard will guide you through the real flow: create a module, upload PDFs, review the generated topics, and open a class-sized lesson.</p>
            <p className="muted">You can skip it at any time, and replay it later from Settings.</p>
          </>
        )}

        {step === "context" && (
          <>
            <h1 className="heading" style={{ marginTop: 0 }}>What are you studying?</h1>
            <p className="muted">This helps every generated lesson pitch itself at the right level for you, instead of a generic assumption.</p>
            <label className="muted" style={{ fontSize: 13 }}>Study level and context</label>
            <input
              className="input"
              value={studyContext}
              onChange={(e) => setStudyContext(e.target.value)}
              placeholder='e.g. "3rd year mechanical engineering"'
              style={{ margin: "8px 0 0" }}
            />
          </>
        )}

        {step === "theme" && (
          <>
            <h1 className="heading" style={{ marginTop: 0 }}>Pick a look</h1>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", margin: "18px 0" }}>
              {THEME_CHOICES.map((choice) => (
                <ThemePreviewCard key={choice.id} theme={choice} selected={choice.id === theme} onSelect={() => setTheme(choice.id)} />
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          {(!isFirst || editMode) && <button className="btn ghost" onClick={goBack}>{isFirst ? "Cancel" : "Back"}</button>}
          <button className="btn" style={{ flex: 1 }} onClick={goNext}>
            {isLast ? (editMode ? "Save Settings" : "Open Dashboard") : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ settings, onSave, onClose, onReplayTutorial, onDeleteData, showToast }) {
  const [apiKey, setApiKey] = useState(settings.geminiApiKey || "");
  const [studyContext, setStudyContext] = useState(settings.studyContext || "");

  const applyTheme = async (theme) => {
    document.documentElement.dataset.theme = normalizeThemeId(theme);
    await onSave({ theme });
  };

  const saveAiSettings = async () => {
    await onSave({ geminiApiKey: apiKey.trim(), studyContext: studyContext.trim() });
    showToast("Settings saved.", "success");
  };

  return (
    <div className="app-shell">
      <div className="container">
        <button className="btn ghost" onClick={onClose}>Back</button>
        <header style={{ marginBottom: 24 }}>
          <h1 className="heading" style={{ marginBottom: 6 }}>Settings</h1>
          <p className="muted" style={{ margin: 0 }}>Manage appearance, AI setup, privacy, and help.</p>
        </header>

        <div className="grid" style={{ gap: 20 }}>
          <section className="card" style={{ padding: 22 }}>
            <h2 className="heading" style={{ marginTop: 0 }}>Appearance</h2>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              {THEME_CHOICES.map((choice) => (
                <ThemePreviewCard key={choice.id} theme={choice} selected={normalizeThemeId(settings.theme) === choice.id} onSelect={() => applyTheme(choice.id)} />
              ))}
            </div>
          </section>

          <section className="card" style={{ padding: 22 }}>
            <h2 className="heading" style={{ marginTop: 0 }}>AI & API Key</h2>
            <p className="muted">Your own Gemini key keeps the app free to use and powers the tutoring pipeline.</p>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Get a Gemini API key</a>
            <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" style={{ marginTop: 12 }} />
            <p className="muted mono" style={{ fontSize: 12 }}>AI calls today: {getUsageTodayCount()}</p>
          </section>

          <section className="card" style={{ padding: 22 }}>
            <h2 className="heading" style={{ marginTop: 0 }}>Study Preferences</h2>
            <label className="muted" style={{ fontSize: 13 }}>Study level and context</label>
            <input className="input" value={studyContext} onChange={(e) => setStudyContext(e.target.value)} placeholder='e.g. "3rd year mechanical engineering"' style={{ marginTop: 8 }} />
            <button className="btn" onClick={saveAiSettings} style={{ marginTop: 14 }}>Save AI settings</button>
          </section>

          <section className="card" style={{ padding: 22 }}>
            <h2 className="heading" style={{ marginTop: 0 }}>Notifications</h2>
            <p className="muted">Study reminders will live here after launch. For now, your learning flow stays quiet unless you ask it to do something.</p>
          </section>

          <section className="card" style={{ padding: 22 }}>
            <h2 className="heading" style={{ marginTop: 0 }}>Data & Privacy</h2>
            <p className="muted">Modules, generated lessons, question history, and progress are stored under your Firebase user account when Firebase is configured. Source PDFs stay on this device in browser storage. Your Gemini key is saved to your settings so the app can make AI calls for your account.</p>
            <button className="btn secondary" onClick={onDeleteData}>Delete my data</button>
          </section>

          <section className="card" style={{ padding: 22 }}>
            <h2 className="heading" style={{ marginTop: 0 }}>Help</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn secondary" onClick={onReplayTutorial}>Replay tutorial</button>
              <button className="btn ghost" onClick={() => showToast("Support contact coming before public launch.", "info")}>Contact support</button>
            </div>
            <p className="muted mono" style={{ fontSize: 12, marginTop: 16 }}>{APP_NAME} launch candidate</p>
          </section>
        </div>
      </div>
    </div>
  );
}

const TUTORIAL_STEPS = [
  { target: "addModule", title: "Create a module", body: "A module is the top-level folder for one course or unit, like Applied Dynamics II." },
  { target: "moduleName", title: "Name the module", body: "Use the real course/module name. Good names help the AI separate broad topics like Vibrations, 3D Kinematics, or Lagrangian Mechanics." },
  { target: "fileUpload", title: "Upload notes topic by topic", body: "For faster processing and fewer API limit issues, start with one topic's lecture notes PDF. You can add more note PDFs to this module at any time." },
  { target: "examUpload", title: "Past papers are optional", body: "If you have past papers, add them now or later. They help practice questions match your exam style, but they are not required to generate topics." },
  { target: "buildCurriculum", title: "Generate topics", body: "Processing may take a moment. The AI groups your notes into the fewest useful topics and class-sized subtopics it can." },
  { target: "subjectCard", title: "Open a module", body: "Module cards show progress and remaining study time. Open one to see its generated topics." },
  { target: "subtopicCard", title: "Start a class", body: "Each class is a bite-sized lesson inside a topic. Dim cards have not generated notes yet." },
  { target: "done", title: "You're set up", body: "Use Settings to replay this walkthrough, update your API key, or change themes at any time." },
];

function TutorialOverlay({ step, onNext, onBack, onSkip }) {
  const current = TUTORIAL_STEPS[step] || TUTORIAL_STEPS[0];
  const isLast = step >= TUTORIAL_STEPS.length - 1;
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1700, pointerEvents: "none" }} />
      <div className="card" style={{ position: "fixed", right: 20, bottom: 20, padding: 22, width: "min(380px, calc(100vw - 40px))", zIndex: 2000 }}>
        <div className="muted mono" style={{ fontSize: 12, marginBottom: 8 }}>Step {step + 1} of {TUTORIAL_STEPS.length}</div>
        <h3 className="heading" style={{ marginTop: 0 }}>{current.title}</h3>
        <p className="muted">{current.body}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 18 }}>
          <button className="btn ghost" onClick={onSkip}>Skip</button>
          <div style={{ display: "flex", gap: 10 }}>
            {step > 0 && <button className="btn secondary" onClick={onBack}>Back</button>}
            <button className="btn" onClick={onNext}>{isLast ? "Done" : "Next"}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function Dashboard({
  subjects, modules,
  onAddSubject, onOpenSubject, onSettings,
  onCreateModule, onRenameModule, onDeleteModule,
  onRenameSubject, onDeleteSubject, onMoveSubject,
}) {
  const isEmpty = subjects.length === 0;

  return (
    <div className="app-shell">
      <div className="container">
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 28 }}>
          <div>
            <h1 className="heading" style={{ margin: 0 }}>Modules</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>Create one module per course, upload notes at module level, then study AI-organised topics and classes.</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn secondary" onClick={onSettings}>Settings</button>
            <button className="btn" data-tour="addModule" onClick={onAddSubject}>Create Module</button>
          </div>
        </header>

        {isEmpty ? (
          <div className="card" style={{ padding: 40, textAlign: "center" }}>
            <h2 className="heading" style={{ marginTop: 0 }}>No modules yet</h2>
            <p className="muted">Create your first module and upload lecture notes to generate topics and class-sized lessons.</p>
            <button className="btn" data-tour="addModule" onClick={onAddSubject} style={{ marginTop: 8 }}>Create Module</button>
          </div>
        ) : (
          <SubjectGrid subjects={subjects} modules={[]} onOpenSubject={onOpenSubject} onMoveSubject={onMoveSubject} onRenameSubject={onRenameSubject} onDeleteSubject={onDeleteSubject} />
        )}
      </div>
    </div>
  );
}

function SubjectGrid({ subjects, modules, onOpenSubject, onMoveSubject, onRenameSubject, onDeleteSubject }) {
  if (!subjects.length) return <p className="muted">No modules here yet.</p>;
  return (
    <div className="grid subject-grid">
      {subjects.map((subject) => {
        const progress = computeSubjectProgress(subject.meta?.curriculum, subject.masteryLog);
        const remaining = (subject.meta?.curriculum?.topics || []).reduce((sum, topic) => sum + (topic.subtopics || []).reduce((inner, st) => inner + (subject.masteryLog?.[st.id]?.status === "mastered" ? 0 : st.estimatedMinutes || 10), 0), 0);
        return (
          <div key={subject.id} className="card" data-tour="subjectCard" style={{ padding: 18 }}>
            <button className="btn ghost" onClick={() => onOpenSubject(subject)} style={{ width: "100%", textAlign: "left", padding: 0, minHeight: "auto", color: "var(--text)" }}>
              <h3 className="heading" style={{ margin: "8px 0" }}>{subject.meta?.name || "Untitled module"}</h3>
              <div className="progress-bar"><span style={{ width: `${progress}%` }} /></div>
              <div className="muted mono" style={{ fontSize: 13, marginTop: 10 }}>{progress}% complete - {remaining} min left</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{subject.meta?.curriculum?.topics?.length || 0} topic{subject.meta?.curriculum?.topics?.length === 1 ? "" : "s"}</div>
            </button>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn ghost" onClick={() => onRenameSubject(subject)} style={{ flex: 1 }}>Rename</button>
              <button className="btn ghost" onClick={() => onDeleteSubject(subject)} style={{ flex: 1 }}>Delete</button>
            </div>
            {modules.length > 0 && (
              <select className="input" value={subject.meta?.moduleId || ""} onChange={(e) => onMoveSubject(subject.id, e.target.value || null)} style={{ marginTop: 10 }}>
                <option value="">Ungrouped</option>
                {modules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SubjectView({ subject, lessonStatus, onBack, onStartSubtopic, onReviewWeak, onAddModuleFiles, loading, loadingMsg, showToast }) {
  const [notesFiles, setNotesFiles] = useState([]);
  const [examFiles, setExamFiles] = useState([]);
  const masteryLog = subject.masteryLog || {};
  const weakCount = Object.values(masteryLog).filter((entry) => entry.status === "attempted").length;
  const progress = computeSubjectProgress(subject.meta?.curriculum, masteryLog);

  const readFiles = async (files, setter, label) => {
    const next = [];
    for (const file of Array.from(files || [])) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pageIndex = await buildPageIndex(new File([bytes], file.name, { type: file.type || "application/pdf" }));
      next.push({ name: file.name, type: file.type || "application/pdf", bytes, pageIndex });
    }
    setter(next);
    showToast(`${label} indexed and ready.`, "success");
  };

  const canUpdate = notesFiles.length > 0 || examFiles.length > 0;

  return (
    <div className="app-shell">
      <div className="container">
        <button className="btn ghost" onClick={onBack}>Back</button>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 22 }}>
          <div>
            <h1 className="heading" style={{ marginBottom: 6 }}>{subject.meta?.name}</h1>
            <div className="muted mono">{progress}% complete - {(subject.meta?.curriculum?.topics || []).length} topic{(subject.meta?.curriculum?.topics || []).length === 1 ? "" : "s"}</div>
          </div>
          {weakCount > 0 && <button className="btn secondary" onClick={onReviewWeak}>Review {weakCount} weak topic{weakCount > 1 ? "s" : ""}</button>}
        </header>

        <section className="card" style={{ padding: 20, marginBottom: 28 }}>
          <h2 className="heading" style={{ marginTop: 0 }}>Module source notes</h2>
          <p className="muted">Upload more lecture notes or past papers here. The module will preserve existing topics where possible, add new topics when the notes warrant it, and keep classes bite-sized.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              <label className="muted" style={{ fontSize: 13 }}>More lecture notes, one topic at a time</label>
              <input className="input" type="file" accept=".pdf" onChange={(e) => readFiles(e.target.files, setNotesFiles, "Lecture notes")} style={{ marginTop: 8 }} />
              {notesFiles.length > 0 && <p className="muted">{notesFiles.map((f) => f.name).join(", ")}</p>}
            </div>
            <div>
              <label className="muted" style={{ fontSize: 13 }}>More past papers</label>
              <input className="input" type="file" accept=".pdf" multiple onChange={(e) => readFiles(e.target.files, setExamFiles, "Past papers")} style={{ marginTop: 8 }} />
              {examFiles.length > 0 && <p className="muted">{examFiles.map((f) => f.name).join(", ")}</p>}
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>This can take a moment while the AI indexes the new notes and updates your saved module map.</p>
          <button
            className="btn secondary"
            disabled={!canUpdate || loading}
            onClick={async () => {
              await onAddModuleFiles(subject, { notesFiles, examFiles });
              setNotesFiles([]);
              setExamFiles([]);
            }}
            style={{ marginTop: 16 }}
          >
            {loading ? loadingMsg || "Updating..." : "Update Module Organisation"}
          </button>
        </section>

        {(subject.meta?.curriculum?.topics || []).map((topic) => (
          <section key={topic.id} style={{ marginBottom: 34 }}>
            <h2 className="heading" style={{ fontSize: 18 }}>{topic.name}</h2>
            <div className="grid subject-grid">
              {(topic.subtopics || []).map((st) => {
                const entry = masteryLog[st.id];
                const hasLesson = lessonStatus.has(st.id);
                const borderColor = entry?.status === "mastered" ? "var(--success)" : entry?.status === "attempted" ? "var(--warning)" : "var(--border)";
                return (
                  <div
                    key={st.id}
                    role="button"
                    tabIndex={0}
                    className="card signature-line"
                    data-tour="subtopicCard"
                    onClick={() => onStartSubtopic(topic, st)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onStartSubtopic(topic, st); } }}
                    style={{ padding: 18, cursor: "pointer", borderColor, opacity: hasLesson ? 1 : 0.62 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <strong>{st.name}</strong>
                      <span className="mono muted">{st.difficulty || 1}/5</span>
                    </div>
                    <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                      {entry?.status === "mastered" ? "Mastered" : entry?.status === "attempted" ? "Needs review" : hasLesson ? "Lesson ready" : "Lesson not generated yet"}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function AddSubject({ onBack, onCreate, loading, loadingMsg, showToast }) {
  const [name, setName] = useState("");
  const [notesFiles, setNotesFiles] = useState([]);
  const [examFiles, setExamFiles] = useState([]);

  const readFiles = async (files, setter, label) => {
    const next = [];
    for (const file of Array.from(files || [])) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pageIndex = await buildPageIndex(new File([bytes], file.name, { type: file.type || "application/pdf" }));
      next.push({ name: file.name, type: file.type || "application/pdf", bytes, pageIndex });
    }
    setter(next);
    showToast(`${label} indexed and ready.`, "success");
  };

  return (
    <div className="app-shell">
      <div className="container narrow card" style={{ padding: 28 }}>
        <button className="btn ghost" onClick={onBack}>Back</button>
        <h1 className="heading">Create Module</h1>
        <p className="muted">A module is the folder for one course or unit. Upload one topic's lecture notes to start; you can add more note PDFs and past papers to the module at any time.</p>
        <p className="muted">For quicker processing and fewer API limit issues, upload notes topic by topic rather than selecting a whole semester of PDFs at once.</p>
        <p className="muted">PDFs are stored on this device. Your module, lessons, questions, and progress can sync through Firestore, but source PDFs must be re-uploaded on a different device before regenerating content there.</p>
        <label className="muted" style={{ fontSize: 13 }}>Module title</label>
        <input className="input" data-tour="moduleName" value={name} onChange={(e) => setName(e.target.value)} style={{ margin: "8px 0 18px" }} />
        <label className="muted" style={{ fontSize: 13 }}>Lecture notes PDF for one topic</label>
        <input className="input" data-tour="fileUpload" type="file" accept=".pdf" onChange={(e) => readFiles(e.target.files, setNotesFiles, "Lecture notes")} style={{ margin: "8px 0 10px" }} />
        {notesFiles.length > 0 && <p className="muted">{notesFiles.map((f) => f.name).join(", ")}</p>}
        <label className="muted" style={{ fontSize: 13 }}>Past papers PDFs</label>
        <input className="input" data-tour="examUpload" type="file" accept=".pdf" multiple onChange={(e) => readFiles(e.target.files, setExamFiles, "Past papers")} style={{ margin: "8px 0 10px" }} />
        {examFiles.length > 0 && <p className="muted">{examFiles.map((f) => f.name).join(", ")}</p>}
        <p className="muted" style={{ fontSize: 13 }}>Generating topics can take a moment while the AI indexes your notes and saves the module map.</p>
        <button className="btn" data-tour="buildCurriculum" disabled={loading || !name.trim() || notesFiles.length === 0} onClick={() => onCreate({ name, notesFiles, examFiles })} style={{ width: "100%", marginTop: 16 }}>
          {loading ? loadingMsg || "Working..." : "Generate Topics"}
        </button>
      </div>
    </div>
  );
}

function NotePaper({ lesson, onRegenerate, onPractice, loading }) {
  const outcomes = lesson.learning_outcomes || [];
  const worked = lesson.worked_example || {};
  return (
    <div className="note-paper">
      {outcomes.length > 0 && (
        <div className="worked-box" style={{ marginTop: 0 }}>
          <strong>Learning outcomes</strong>
          <ul>{outcomes.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
      )}
      {lesson.diagram_mermaid && <MermaidRenderer chart={lesson.diagram_mermaid} paper />}
      {(lesson.sections || []).map((section, idx) => (
        <section className="note-section" key={`${section.heading}-${idx}`}>
          <h2>{section.heading}</h2>
          <MathRenderer text={section.body} paper />
          {(section.equations || []).map((eq) => (
            <div className="equation-row" key={eq.number}>
              <div>
                <MathRenderer text={`$$${eq.latex}$$`} paper />
                {eq.explanation && <div className="paper-muted">{eq.explanation}</div>}
              </div>
              <div className="equation-number">({eq.number})</div>
            </div>
          ))}
          {section.real_world_example && <p className="paper-muted"><strong>Real world:</strong> {section.real_world_example}</p>}
        </section>
      ))}
      {worked.problem_statement && (
        <div className="worked-box">
          <h2 style={{ marginTop: 0 }}>Worked Example</h2>
          <MathRenderer text={worked.problem_statement} paper />
          <ol>{(worked.steps || []).map((step, i) => <li key={i}><MathRenderer text={step} paper /></li>)}</ol>
          {worked.final_answer && <strong><MathRenderer text={worked.final_answer} paper /></strong>}
        </div>
      )}
      {lesson.common_mistakes?.length > 0 && (
        <div className="note-section">
          <h2>Common Mistakes</h2>
          <ul>{lesson.common_mistakes.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
      )}
      {lesson.summary && <p className="paper-muted"><strong>Summary:</strong> {lesson.summary}</p>}
      {lesson.source_refs?.length > 0 && <p className="paper-muted">Sources: {lesson.source_refs.map((ref, i) => <span key={i}>{ref.includes("web:") ? "[web] " : ""}{ref}{i < lesson.source_refs.length - 1 ? " | " : ""}</span>)}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 28 }}>
        <button className="btn" onClick={onPractice}>Go to Practice</button>
        <button className="btn secondary" onClick={onRegenerate} disabled={loading}>Regenerate notes</button>
      </div>
    </div>
  );
}

// --- 1.5 "Peek at notes" slide-over during practice ---
function NotesPeek({ lesson, onClose }) {
  return (
    <div
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(440px, 92vw)",
        background: "var(--surface, #10182b)", borderLeft: "1px solid var(--border)",
        zIndex: 1700, overflowY: "auto", padding: 22, boxShadow: "-10px 0 28px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <strong>Lesson notes</strong>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      {(lesson.sections || []).map((section, idx) => (
        <section key={idx} style={{ marginBottom: 22 }}>
          <h4 style={{ marginBottom: 6 }}>{section.heading}</h4>
          <MathRenderer text={section.body} />
        </section>
      ))}
      {lesson.summary && <p className="muted"><strong>Summary:</strong> {lesson.summary}</p>}
    </div>
  );
}

// --- 1.5 Past-questions bank list ---
function QuestionBankPanel({ bank, onOpenQuestion }) {
  const statusFor = (q) => {
    if (!q.attempts?.length) return { label: "Unattempted", color: "var(--border)" };
    const last = q.attempts[0];
    if (last.correct) return { label: "Correct", color: "var(--success)" };
    if ((last.partial_credit_percent ?? 0) > 0) return { label: "Partial", color: "var(--warning)" };
    return { label: "Wrong", color: "#ef4444" };
  };
  if (!bank.length) return <p className="muted">No questions generated yet for this class.</p>;
  return (
    <div className="grid" style={{ gap: 10 }}>
      {bank.map((q) => {
        const status = statusFor(q);
        return (
          <button key={q.id} className="card" onClick={() => onOpenQuestion(q)} style={{ textAlign: "left", padding: 16, cursor: "pointer", color: "var(--text)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <strong>{QUESTION_TYPE_LABELS[q.type] || q.type}</strong>
              <span className="mono" style={{ color: status.color, fontSize: 13 }}>{status.label}</span>
            </div>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>{q.question}</p>
          </button>
        );
      })}
    </div>
  );
}

function LearnView({
  subject, active, lesson, phase, setPhase, onBack, onRegenerate, onFetchQuestion, onSubmitAnswer,
  studentAnswer, setStudentAnswer, selectedOption, setSelectedOption, feedback, loading,
  questionBank, viewingBankQuestion, onOpenBankQuestion, onCloseBankQuestion,
  showNotesPeek, setShowNotesPeek, mistakePattern,
}) {
  const q = lesson.question;
  const inPractice = phase === "question" || phase === "bank";

  return (
    <div className="app-shell">
      <div className="container">
        <button className="btn ghost" onClick={onBack}>Back to module</button>
        <h1 className="heading">{active.subtopic.name}</h1>

        {inPractice && (
          <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
            <button className={`btn ${phase === "question" ? "" : "secondary"}`} onClick={() => setPhase("question")}>Practice</button>
            <button className={`btn ${phase === "bank" ? "" : "secondary"}`} onClick={() => setPhase("bank")}>Past questions ({questionBank.length})</button>
            <button className="btn ghost" onClick={() => setShowNotesPeek(true)} style={{ marginLeft: "auto" }}>Peek at notes</button>
          </div>
        )}

        {phase === "notes" ? (
          <NotePaper lesson={lesson} loading={loading} onRegenerate={onRegenerate} onPractice={onFetchQuestion} />
        ) : phase === "bank" ? (
          viewingBankQuestion ? (
            <div className="card" style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
              <button className="btn ghost" onClick={onCloseBankQuestion} style={{ marginBottom: 14 }}>Back to list</button>
              <strong style={{ color: "var(--accent-text)" }}>{QUESTION_TYPE_LABELS[viewingBankQuestion.type] || viewingBankQuestion.type}</strong>
              <h2><MathRenderer text={viewingBankQuestion.question} /></h2>
              {viewingBankQuestion.attempts?.[0] ? (
                <>
                  <p className="muted"><strong>Your answer:</strong> {viewingBankQuestion.attempts[0].selectedOption || viewingBankQuestion.attempts[0].studentAnswer}</p>
                  <div className="card" style={{ padding: 16, background: "var(--surface-2)" }}>
                    <strong>{viewingBankQuestion.attempts[0].correct ? "Correct" : `Partial credit: ${viewingBankQuestion.attempts[0].partial_credit_percent}%`}</strong>
                    <p style={{ marginBottom: 0 }}>{viewingBankQuestion.attempts[0].feedback}</p>
                  </div>
                </>
              ) : (
                <p className="muted">Not attempted yet.</p>
              )}
            </div>
          ) : (
            <QuestionBankPanel bank={questionBank} onOpenQuestion={onOpenBankQuestion} />
          )
        ) : q ? (
          <div className="card" style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <strong style={{ color: "var(--accent-text)" }}>{QUESTION_TYPE_LABELS[q.type] || q.type}</strong>
              <span className="muted mono">{q.marks ? `${q.marks} marks` : ""}</span>
            </div>
            <h2><MathRenderer text={q.question} /></h2>
            {q.type === "multiple_choice" ? (
              <div className="grid">
                {(q.options || []).map((opt) => (
                  <button key={opt} className="btn secondary" disabled={!!feedback} onClick={() => setSelectedOption(opt)} style={{ textAlign: "left", borderColor: selectedOption === opt ? "var(--accent-1)" : "var(--border)" }}>
                    <MathRenderer text={opt} />
                  </button>
                ))}
              </div>
            ) : (
              <textarea className="input" value={studentAnswer} onChange={(e) => setStudentAnswer(e.target.value)} disabled={!!feedback} placeholder="Your answer..." style={{ minHeight: 150 }} />
            )}
            {!feedback ? (
              <button className="btn" onClick={onSubmitAnswer} style={{ width: "100%", marginTop: 18 }}>Submit</button>
            ) : (
              <div className="card" style={{ padding: 18, marginTop: 18, background: "var(--surface-2)" }}>
                <strong>{feedback.correct ? "Correct" : `Partial credit: ${feedback.partial_credit_percent}%`}</strong>
                <p>{feedback.feedback}</p>
                {feedback.misconception && <p className="muted"><strong>Misconception:</strong> {feedback.misconception}</p>}
                {feedback.what_to_review && <p className="muted"><strong>Review:</strong> {feedback.what_to_review}</p>}
                {mistakePattern && <p style={{ color: "var(--warning)" }}>{mistakePattern}</p>}
                <button className="btn" onClick={() => (feedback.correct || feedback.partial_credit_percent >= 80 ? onFetchQuestion() : setPhase("notes"))}>
                  {feedback.correct || feedback.partial_credit_percent >= 80 ? "Try another question" : "Review the lesson again"}
                </button>
              </div>
            )}
          </div>
        ) : null}

        {showNotesPeek && <NotesPeek lesson={lesson} onClose={() => setShowNotesPeek(false)} />}
      </div>
    </div>
  );
}

function StemTutor() {
  const { uid, authLoading, firebaseReady: hasFirebase } = useAuth();
  const { toasts, showToast, removeToast } = useToasts();
  const [settings, setSettings] = useState({ onboarded: false, geminiApiKey: "", theme: "aurora-dark", studyContext: "", referralSource: "", tutorialSeen: false });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [modules, setModules] = useState([]);
  const [screen, setScreen] = useState("dashboard");
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [lessonStatus, setLessonStatus] = useState(new Set());
  const [active, setActive] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [phase, setPhase] = useState("notes");
  const [studentAnswer, setStudentAnswer] = useState("");
  const [selectedOption, setSelectedOption] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [mistakePattern, setMistakePattern] = useState(null);
  const [questionBank, setQuestionBank] = useState([]);
  const [viewingBankQuestion, setViewingBankQuestion] = useState(null);
  const [showNotesPeek, setShowNotesPeek] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [dashboardModal, setDashboardModal] = useState(null);
  const sessionPdfBytes = useRef(new Map());

  useEffect(() => {
    // Only pdf.js and Mermaid load from a CDN now; math/markdown rendering is bundled (see MathRenderer).
    const scripts = [
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      "https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js",
    ];
    scripts.forEach((src) => {
      if (document.querySelector(`script[src="${src}"]`)) return;
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      document.head.appendChild(script);
    });
    const timer = setInterval(() => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        clearInterval(timer);
      }
    }, 300);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!uid) return;
    getSettings(uid).then((saved) => {
      const next = saved || { onboarded: false, geminiApiKey: sessionStorage.getItem("stem-gemini-api-key") || "", theme: "aurora-dark", studyContext: "", referralSource: "", tutorialSeen: false };
      const normalized = { studyContext: "", referralSource: "", tutorialSeen: false, ...next, theme: normalizeThemeId(next.theme) };
      setSettings(normalized);
      document.documentElement.dataset.theme = normalized.theme;
      setSettingsLoaded(true);
    });
  }, [uid]);

  useEffect(() => {
    if (!uid || !settingsLoaded) return;
    if (new URLSearchParams(window.location.search).get("devOnboard") === "1") {
      persistSettings({ onboarded: false, tutorialSeen: false });
    }
  }, [uid, settingsLoaded]);

  useEffect(() => {
    document.documentElement.dataset.theme = normalizeThemeId(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    if (!uid || !settingsLoaded) return undefined;
    if (!hasFirebase || !db) {
      const savedSubjects = JSON.parse(localStorage.getItem("stem-subjects") || "[]");
      const savedModules = JSON.parse(localStorage.getItem("stem-modules") || "[]");
      if (!savedSubjects.length && localStorage.getItem("stem-curriculum")) {
        const migrated = {
          id: crypto.randomUUID(),
          meta: {
            name: localStorage.getItem("stem-subject") || "Imported Subject",
            moduleId: null,
            curriculum: assignIds(JSON.parse(localStorage.getItem("stem-curriculum"))),
            examPlan: JSON.parse(localStorage.getItem("stem-exam-plan") || "null"),
            sourceFiles: [],
            examFiles: [],
          },
          masteryLog: {},
        };
        localStorage.setItem("stem-subjects", JSON.stringify([migrated]));
        setSubjects([migrated]);
      } else {
        setSubjects(savedSubjects);
      }
      setModules(savedModules);
      return undefined;
    }

    const unsubSubjects = onSnapshot(collection(db, "users", uid, "subjects"), async (snap) => {
      const loaded = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      if (loaded.length === 0 && localStorage.getItem("stem-curriculum")) {
        const migrated = {
          meta: {
            name: localStorage.getItem("stem-subject") || "Imported Subject",
            moduleId: null,
            curriculum: assignIds(JSON.parse(localStorage.getItem("stem-curriculum"))),
            examPlan: JSON.parse(localStorage.getItem("stem-exam-plan") || "null"),
            createdAt: serverTimestamp(),
          },
          masteryLog: {},
        };
        await addDoc(collection(db, "users", uid, "subjects"), migrated);
        localStorage.removeItem("stem-curriculum");
        localStorage.removeItem("stem-mastery-log");
        localStorage.removeItem("stem-exam-plan");
      }
      setSubjects(loaded);
    });
    const unsubModules = onSnapshot(collection(db, "users", uid, "modules"), (snap) => {
      setModules(snap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (a.order || 0) - (b.order || 0)));
    });
    return () => {
      unsubSubjects();
      unsubModules();
    };
  }, [uid, settingsLoaded, hasFirebase]);

  useEffect(() => {
    if (!selectedSubject || !uid || !hasFirebase || !db) {
      setLessonStatus(new Set());
      return;
    }
    const keys = (selectedSubject.meta?.curriculum?.topics || []).flatMap((topic) => (topic.subtopics || []).map((st) => lessonKey(selectedSubject.id, st.id)));
    if (!keys.length) return;
    const chunks = [];
    for (let i = 0; i < keys.length; i += 10) chunks.push(keys.slice(i, i + 10));
    Promise.all(chunks.map((chunk) => getDocs(query(collection(db, "users", uid, "lessons"), where("__name__", "in", chunk)))))
      .then((snaps) => {
        const existing = new Set();
        snaps.flatMap((snap) => snap.docs).forEach((lessonDoc) => {
          const subtopicId = lessonDoc.id.replace(`${selectedSubject.id}_`, "");
          existing.add(subtopicId);
        });
        setLessonStatus(existing);
      })
      .catch(() => setLessonStatus(new Set()));
  }, [selectedSubject, uid, hasFirebase]);

  const persistSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    sessionStorage.setItem("stem-gemini-api-key", next.geminiApiKey || "");
    await saveSettings(uid, next);
  };

  useEffect(() => {
    document.querySelectorAll(".tour-active").forEach((node) => node.classList.remove("tour-active"));
    if (tutorialStep === null) return;
    const target = TUTORIAL_STEPS[tutorialStep]?.target;
    if (!target || target === "done") return;
    const node = document.querySelector(`[data-tour="${target}"]`);
    if (node) {
      node.classList.add("tour-active");
      node.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
    return () => {
      document.querySelectorAll(".tour-active").forEach((activeNode) => activeNode.classList.remove("tour-active"));
    };
  }, [tutorialStep, screen, subjects.length, modules.length, selectedSubject?.id]);

  const startTutorial = async () => {
    setShowSettings(false);
    setScreen("dashboard");
    setTutorialStep(0);
    await persistSettings({ tutorialSeen: false });
  };

  const finishTutorial = async () => {
    setTutorialStep(null);
    setScreen("dashboard");
    await persistSettings({ tutorialSeen: true });
  };

  const advanceTutorial = () => {
    const next = tutorialStep + 1;
    const target = TUTORIAL_STEPS[next]?.target;
    if (target === "moduleName" || target === "fileUpload" || target === "examUpload" || target === "buildCurriculum") setScreen("add");
    if (target === "subjectCard") setScreen("dashboard");
    if (target === "subtopicCard") {
      if (subjects[0]) {
        setSelectedSubject(subjects[0]);
        setScreen("subject");
      } else {
        showToast("Create a module first, then this step will make more sense.", "info");
        return;
      }
    }
    if (next >= TUTORIAL_STEPS.length) {
      finishTutorial();
      return;
    }
    setTutorialStep(next);
  };

  const goBackTutorial = () => {
    const prev = Math.max(0, tutorialStep - 1);
    const target = TUTORIAL_STEPS[prev]?.target;
    if (target === "moduleName" || target === "fileUpload" || target === "examUpload" || target === "buildCurriculum") setScreen("add");
    if (target === "addModule" || target === "subjectCard") setScreen("dashboard");
    setTutorialStep(prev);
  };

  useEffect(() => {
    if (settingsLoaded && settings.onboarded && !settings.tutorialSeen && tutorialStep === null && !showSettings) {
      setScreen("dashboard");
      setTutorialStep(0);
    }
  }, [settingsLoaded, settings.onboarded, settings.tutorialSeen, tutorialStep, showSettings]);

  const saveLocalCollections = (nextSubjects, nextModules = modules) => {
    localStorage.setItem("stem-subjects", JSON.stringify(nextSubjects));
    localStorage.setItem("stem-modules", JSON.stringify(nextModules));
  };

  const saveSubject = async (subjectId, patch) => {
    if (hasFirebase && db) {
      await setDoc(doc(db, "users", uid, "subjects", subjectId), patch, { merge: true });
    } else {
      const next = subjects.map((subject) => subject.id === subjectId ? { ...subject, ...patch, meta: { ...subject.meta, ...patch.meta }, masteryLog: patch.masteryLog || subject.masteryLog } : subject);
      setSubjects(next);
      saveLocalCollections(next);
      if (selectedSubject?.id === subjectId) setSelectedSubject(next.find((item) => item.id === subjectId));
    }
  };

  const storeSourceFiles = async (subjectId, files, folder) => {
    const records = [];
    for (const file of files) {
      const localPdfId = `${uid}:${subjectId}:${folder}:${crypto.randomUUID()}`;
      sessionPdfBytes.current.set(localPdfId, file.bytes);
      await saveLocalPdf({
        id: localPdfId,
        name: file.name,
        mimeType: file.type,
        bytes: file.bytes,
        pageIndex: file.pageIndex,
        savedAt: Date.now(),
      });
      records.push({ name: file.name, localPdfId, pageCount: file.pageIndex?.length || 0, mimeType: file.type, storage: "indexeddb" });
    }
    return records;
  };

  const createModuleIndexFromFile = async ({ moduleName, file, existingCurriculum = null, existingSourceIndexes = [] }) => {
    const digest = buildDocumentDigest(file);
    const hasExistingMap = existingCurriculum?.topics?.length;
    const prompt = hasExistingMap
      ? `You are updating the saved organisation for the college module "${moduleName}".

The app is intentionally giving you a compact text digest of the newly uploaded PDF, not the full PDF. Use this digest to create a reusable source index for this PDF and merge it into the existing module map.

Existing module map:
${JSON.stringify(existingCurriculum)}

Saved source indexes already in the module:
${JSON.stringify(compactSourceIndexes(existingSourceIndexes))}

New PDF digest:
${digest}

Return:
1. sourceIndex: a compact index of what this PDF covers, with broad topics, likely subtopics, useful keywords, and page hints.
2. curriculum: the full updated module map.

Rules:
- Preserve existing broad topics when the new notes fit them.
- Add a new topic only when the digest clearly introduces a distinct overarching area.
- Add or adjust subtopics/classes inside an existing topic when that is enough.
- Minimise the number of subtopics. Each subtopic should be a bite-sized but meaningful class, not a single slide or tiny concept.
- Put sourceFileNames and sourcePageHints on subtopics when the digest supports them.
- Do not duplicate existing subtopics under slightly different names.
- Do not invent content not supported by the existing map, saved indexes, or new digest.`
      : `You are organising the college module "${moduleName}".

The app is intentionally giving you a compact text digest of the uploaded lecture PDF, not the full PDF. Use this digest to create a reusable source index and an efficient module map.

PDF digest:
${digest}

Return:
1. sourceIndex: a compact index of what this PDF covers, with broad topics, likely subtopics, useful keywords, and page hints.
2. curriculum: a compact module map with this hierarchy only: Module -> topics -> subtopics/classes -> lessons generated later.

Rules:
- Topics must be broad lecture-note sections or recurring blocks the digest clearly supports.
- Subtopics are class-sized lesson units inside each topic.
- Minimise the number of subtopics. Prefer fewer, well-scoped classes over lots of tiny fragments.
- Do not create a subtopic for every heading, equation, or slide. Combine adjacent material when one lesson can teach it coherently.
- Put sourceFileNames and sourcePageHints on subtopics when the digest supports them.
- Do not invent topics that are not covered by the digest.
- Rate each subtopic's difficulty from 1 to 5 and estimate minutes needed to learn it.`;

    const result = safeParseJSON(await callGemini({
      apiKey: settings.geminiApiKey,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: hasExistingMap ? 0.15 : 0.2, responseMimeType: "application/json", responseSchema: MODULE_INDEX_SCHEMA },
    }, { onStatus: setLoadingMsg }));
    return {
      sourceIndex: result.sourceIndex,
      curriculum: hasExistingMap ? preserveCurriculumIds(existingCurriculum, result.curriculum) : assignIds(result.curriculum),
    };
  };

  const getLocalSource = async (source) => {
    const localPdfId = source.localPdfId || source.path;
    const cached = sessionPdfBytes.current.get(localPdfId);
    if (!localPdfId) throw new Error("Re-upload the source PDF to regenerate this content on this device.");
    const stored = await getLocalPdf(localPdfId);
    if (!cached && !stored?.bytes) throw new Error("This PDF is not stored on this device. Re-upload it to regenerate source-grounded notes or questions.");
    const bytes = cached || stored.bytes;
    sessionPdfBytes.current.set(localPdfId, bytes);
    return { bytes, pageIndex: stored?.pageIndex || source.pageIndex || [] };
  };

  const getDocumentPart = async (subject, { queryText, scoped = true, sourceKind = "notes" } = {}) => {
    const files = sourceKind === "exam" ? subject.meta?.examFiles || [] : subject.meta?.sourceFiles || [];
    let source = files[0];
    if (sourceKind === "notes" && scoped && files.length > 1) {
      let best = { source: files[0], score: -1 };
      for (const candidate of files) {
        const localPdfId = candidate.localPdfId || candidate.path;
        const stored = localPdfId ? await getLocalPdf(localPdfId) : null;
        const score = scorePageIndex(stored?.pageIndex || candidate.pageIndex || [], queryText);
        if (score > best.score) best = { source: candidate, score };
      }
      source = best.source;
    }
    if (!source) return null;
    const { bytes, pageIndex } = await getLocalSource(source);
    let payloadBytes = bytes;
    if (scoped && pageIndex.length) {
      const pages = scoreRelevantPages(pageIndex, queryText, 10);
      payloadBytes = await extractPages(bytes, pages);
    }
    if (payloadBytes.byteLength <= MAX_INLINE_DOCUMENT_BYTES) return inlinePdfDocumentPart(payloadBytes);

    const uploadRes = await fetch(UPLOAD_FILE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: settings.geminiApiKey,
        displayName: source.name,
        mimeType: source.mimeType || "application/pdf",
        data: arrayBufferToBase64(payloadBytes),
      }),
    });
    const data = await uploadRes.json();
    if (!uploadRes.ok || data.error) throw new Error(data.error || "Could not upload PDF to Gemini.");
    return { fileData: { mimeType: source.mimeType || "application/pdf", fileUri: data.fileUri } };
  };

  const buildCurriculum = async ({ name, notesFiles, examFiles }) => {
    setLoading(true);
    setLoadingMsg("Indexing the PDF and organising the module...");
    try {
      const indexed = await createModuleIndexFromFile({ moduleName: name, file: notesFiles[0] });
      const curriculum = indexed.curriculum;
      if (!curriculum.topics?.length) throw new Error("The AI returned an empty curriculum. Try more complete lecture notes.");

      const subjectId = hasFirebase && db ? doc(collection(db, "users", uid, "subjects")).id : crypto.randomUUID();
      const sourceFiles = await storeSourceFiles(subjectId, notesFiles, "notes");
      const sourceIndexes = sourceFiles[0] ? [{ fileName: sourceFiles[0].name, localPdfId: sourceFiles[0].localPdfId, index: indexed.sourceIndex }] : [];
      const storedExamFiles = await storeSourceFiles(subjectId, examFiles, "exam");
      const subjectDoc = {
        id: subjectId,
        meta: { name, moduleId: null, curriculum, sourceIndexes, examPlan: null, sourceFiles, examFiles: storedExamFiles, createdAt: hasFirebase ? serverTimestamp() : Date.now() },
        masteryLog: {},
      };
      if (hasFirebase && db) {
        await setDoc(doc(db, "users", uid, "subjects", subjectId), { meta: subjectDoc.meta, masteryLog: {} });
      } else {
        const next = [...subjects, subjectDoc];
        setSubjects(next);
        saveLocalCollections(next);
      }
      setSelectedSubject(subjectDoc);
      setScreen("subject");
      showToast("Curriculum created and saved.", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const updateModuleFromFiles = async (subject, { notesFiles, examFiles }) => {
    if (!notesFiles.length && !examFiles.length) return;
    setLoading(true);
    setLoadingMsg("Updating module organisation...");
    try {
      let curriculum = subject.meta?.curriculum || { topics: [] };
      let newSourceIndexEntries = [];

      if (notesFiles.length) {
        const notesFile = notesFiles[0];
        setLoadingMsg(`Indexing ${notesFile.name}...`);
        const indexed = await createModuleIndexFromFile({
          moduleName: subject.meta.name,
          file: notesFile,
          existingCurriculum: curriculum,
          existingSourceIndexes: subject.meta?.sourceIndexes || [],
        });
        curriculum = indexed.curriculum;
        newSourceIndexEntries = [{ pendingName: notesFile.name, index: indexed.sourceIndex }];
      }

      const newSourceFiles = await storeSourceFiles(subject.id, notesFiles, "notes");
      const newExamFiles = await storeSourceFiles(subject.id, examFiles, "exam");
      newSourceIndexEntries = newSourceIndexEntries.map((entry) => {
        const fileRecord = newSourceFiles.find((source) => source.name === entry.pendingName);
        return { fileName: fileRecord?.name || entry.pendingName, localPdfId: fileRecord?.localPdfId || null, index: entry.index };
      });

      const nextMeta = {
        ...subject.meta,
        curriculum,
        sourceIndexes: [...(subject.meta?.sourceIndexes || []), ...newSourceIndexEntries],
        sourceFiles: [...(subject.meta?.sourceFiles || []), ...newSourceFiles],
        examFiles: [...(subject.meta?.examFiles || []), ...newExamFiles],
        examPlan: newExamFiles.length ? null : subject.meta?.examPlan || null,
      };
      await saveSubject(subject.id, { meta: nextMeta });
      const nextSubject = { ...subject, meta: nextMeta };
      setSelectedSubject(nextSubject);
      setSubjects((prev) => prev.map((item) => item.id === subject.id ? nextSubject : item));
      showToast(newSourceFiles.length ? "Module topics updated." : "Past papers added to the module.", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const ensureExamPlan = async (subject) => {
    if (subject.meta?.examPlan) return subject.meta.examPlan;
    if (!subject.meta?.examFiles?.length) return DEFAULT_EXAM_PLAN;
    setLoadingMsg("Analyzing your past papers' style...");
    try {
      const documentPart = await getDocumentPart(subject, { scoped: false, sourceKind: "exam" });
      const res = await callGemini({
        apiKey: settings.geminiApiKey,
        contents: [{ role: "user", parts: [{ text: `Analyze the attached past exam paper for the module "${subject.meta.name}". Identify the distribution of question types, typical marks, and style conventions.` }] }],
        documentPart,
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: EXAM_PLAN_SCHEMA },
      }, { onStatus: setLoadingMsg });
      const plan = safeParseJSON(res)?.question_types?.length ? safeParseJSON(res) : DEFAULT_EXAM_PLAN;
      await saveSubject(subject.id, { meta: { ...subject.meta, examPlan: plan } });
      return plan;
    } catch (err) {
      return DEFAULT_EXAM_PLAN;
    }
  };

  const generateLesson = async (subject, topic, subtopic, force = false) => {
    setLoading(true);
    setLoadingMsg(force ? "Regenerating your lesson..." : "Checking saved notes...");
    try {
      const key = lessonKey(subject.id, subtopic.id);
      if (!force && hasFirebase && db) {
        const cached = await getDoc(doc(db, "users", uid, "lessons", key));
        if (cached.exists()) {
          setLesson(cached.data());
          setActive({ topic, subtopic });
          setPhase("notes");
          setScreen("learn");
          setLoading(false);
          return;
        }
      }

      setLoadingMsg("Drafting your lesson...");
      const sourceContext = findRelevantSourceContext(subject, topic, subtopic);
      const documentPart = await getDocumentPart(subject, { queryText: `${topic.name} ${subtopic.name}`, scoped: true });
      const draftPrompt = `${TUTOR_VOICE_PROMPT}

${buildTeachingPhilosophyPrompt(settings.studyContext)}

Saved source-index context for this class:
${sourceContext}

Create a sectioned lesson for the class "${subtopic.name}" inside the topic "${topic.name}" for the module "${subject.meta.name}". Keep the scope bite-sized: teach this class well, but do not expand into neighbouring classes unless needed for context. Use the saved source-index context to stay inside the intended module hierarchy, and refer to the attached scoped lecture-note pages for source material. Return only the requested JSON.`;
      let draft = safeParseJSON(await callGemini({
        apiKey: settings.geminiApiKey,
        contents: [{ role: "user", parts: [{ text: draftPrompt }] }],
        documentPart,
        generationConfig: { temperature: 0.25, responseMimeType: "application/json", responseSchema: LESSON_SCHEMA_V2 },
      }, { onStatus: setLoadingMsg }));

      if (draft.needs_external_info && draft.external_info_gaps?.length) {
        setLoadingMsg("Looking up a couple of details...");
        try {
          const gapPrompt = `Fill only these missing details for the lesson on "${subtopic.name}". Keep additions concise, cite sources in source_refs with a "web:" prefix, and preserve the JSON schema.

Gaps:
${draft.external_info_gaps.join("\n")}

Current draft:
${JSON.stringify(draft)}`;
          draft = safeParseJSON(await callGemini({
            apiKey: settings.geminiApiKey,
            contents: [{ role: "user", parts: [{ text: gapPrompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: LESSON_SCHEMA_V2 },
          }, { onStatus: setLoadingMsg }));
        } catch (err) {
          draft.used_web_search = false;
        }
      }

      setLoadingMsg("Checking it over...");
      let finalLesson = draft;
      try {
        const critique = safeParseJSON(await callGemini({
          apiKey: settings.geminiApiKey,
          contents: [{ role: "user", parts: [{ text: `You are a professor teaching the module ${subject.meta.name}, fact-checking a junior tutor's class-sized lesson before it reaches a student. Check every equation, every claim, and the worked example for correctness. Also flag any language that reads as filler, generic encouragement, or unearned praise rather than substantive feedback. Be specific and actionable.\n\nLesson:\n${JSON.stringify(draft)}` }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: REVIEW_SCHEMA },
        }, { onStatus: setLoadingMsg }));
        if (critique.verdict === "needs_revision") {
          setLoadingMsg("Polishing the final version...");
          finalLesson = safeParseJSON(await callGemini({
            apiKey: settings.geminiApiKey,
            contents: [{ role: "user", parts: [{ text: `Revise this lesson using the professor critique. Preserve the sectioned JSON schema.\n\nCritique:\n${JSON.stringify(critique)}\n\nDraft:\n${JSON.stringify(draft)}` }] }],
            generationConfig: { temperature: 0.15, responseMimeType: "application/json", responseSchema: LESSON_SCHEMA_V2 },
          }, { onStatus: setLoadingMsg }));
        }
      } catch (err) {
        finalLesson = { ...draft, _reviewSkipped: true };
      }

      const payload = { ...finalLesson, question: null, generatedAt: hasFirebase ? serverTimestamp() : Date.now(), notesVersion: (lesson?.notesVersion || 0) + 1 };
      if (hasFirebase && db) await setDoc(doc(db, "users", uid, "lessons", key), payload);
      setLesson(payload);
      setActive({ topic, subtopic });
      setPhase("notes");
      setScreen("learn");
      setLessonStatus((prev) => new Set([...prev, subtopic.id]));
      setQuestionBank([]);
      setViewingBankQuestion(null);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const fetchQuestion = async () => {
    if (!selectedSubject || !active) return;
    setLoading(true);
    setLoadingMsg("Writing practice questions...");
    setMistakePattern(null);
    setViewingBankQuestion(null);
    try {
      const key = lessonKey(selectedSubject.id, active.subtopic.id);
      let bank = [];
      if (hasFirebase && db) {
        const bankSnap = await getDoc(doc(db, "users", uid, "questionBanks", key));
        bank = bankSnap.exists() ? bankSnap.data().questions || [] : [];
      }
      setQuestionBank(bank);
      const unseen = bank.find((question) => !question.attempts?.length);
      if (unseen) {
        setLesson((prev) => ({ ...prev, question: unseen }));
        setStudentAnswer("");
        setSelectedOption(null);
        setFeedback(null);
        setPhase("question");
        setLoading(false);
        return;
      }
      const plan = await ensureExamPlan(selectedSubject);
      const chosenType = pickWeighted(plan.question_types, "weight_percent");
      const documentPart = await getDocumentPart(selectedSubject, { queryText: `${active.topic.name} ${active.subtopic.name}`, scoped: true });
      const adaptiveDifficulty = computeAdaptiveDifficulty(active.subtopic.difficulty, bank);
      const prompt = `Write ${QUESTION_BATCH_SIZE} DISTINCT exam-style practice questions on the class "${active.subtopic.name}" inside the topic "${active.topic.name}" for a college exam in the module "${selectedSubject.meta.name}", each testing a different angle of this class so they don't feel repetitive.

Question type: ${chosenType.type}. Style guidance from the real past papers: ${chosenType.style_notes || plan.overall_notes || "standard exam phrasing"}.
Difficulty: ${adaptiveDifficulty}/5.
Marks: around ${chosenType.avg_marks || 5}.

If multiple_choice, include exactly 4 plausible options per question and put the exact correct option text in correct_option. Otherwise leave options empty and correct_option empty. Refer to the attached lecture notes document for source material. Return the questions under a "questions" array.`;
      const parsed = safeParseJSON(await callGemini({
        apiKey: settings.geminiApiKey,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        documentPart,
        generationConfig: { temperature: 0.4, responseMimeType: "application/json", responseSchema: QUESTION_BATCH_SCHEMA },
      }, { onStatus: setLoadingMsg }));
      const newQuestions = (parsed.questions || []).map((qItem) => ({ ...qItem, id: crypto.randomUUID(), attempts: [], createdAt: Date.now() }));
      if (!newQuestions.length) throw new Error("The AI didn't return any questions. Try again.");
      const nextBank = [...bank, ...newQuestions];
      if (hasFirebase && db) await setDoc(doc(db, "users", uid, "questionBanks", key), { questions: nextBank }, { merge: true });
      setQuestionBank(nextBank);
      setLesson((prev) => ({ ...prev, question: newQuestions[0] }));
      setStudentAnswer("");
      setSelectedOption(null);
      setFeedback(null);
      setPhase("question");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const updateMastery = async (fb) => {
    const subject = selectedSubject;
    const subtopicId = active.subtopic.id;
    const entry = subject.masteryLog?.[subtopicId] || { status: "new", correctStreak: 0, mistakes: [] };
    const isGood = fb.correct || (fb.partial_credit_percent ?? 0) >= 80;
    const nextEntry = isGood
      ? { ...entry, correctStreak: entry.correctStreak + 1, status: entry.correctStreak + 1 >= 2 ? "mastered" : "attempted" }
      : {
          ...entry,
          correctStreak: 0,
          status: "attempted",
          mistakes: [{ type: fb.mistake_type || "concept_gap", note: fb.misconception || fb.what_to_review || "Needs review", ts: Date.now() }, ...(entry.mistakes || [])].slice(0, 5),
        };
    const nextLog = { ...(subject.masteryLog || {}), [subtopicId]: nextEntry };
    await saveSubject(subject.id, { masteryLog: nextLog });
    setSelectedSubject((prev) => ({ ...prev, masteryLog: nextLog }));

    // 3.4 Surface repeated mistake patterns back to the student
    if (!isGood) {
      const counts = {};
      (nextEntry.mistakes || []).forEach((m) => { counts[m.type] = (counts[m.type] || 0) + 1; });
      const repeated = Object.entries(counts).find(([type, count]) => count >= 2 && type !== "none");
      setMistakePattern(repeated ? `You've made a "${repeated[0].replace(/_/g, " ")}" error ${repeated[1]} times on this class.` : null);
    } else {
      setMistakePattern(null);
    }
  };

  const submitAnswer = async () => {
    const q = lesson?.question;
    if (!q) return;
    if (q.type === "multiple_choice" && !selectedOption) {
      showToast("Pick an option first.", "error");
      return;
    }
    if (q.type !== "multiple_choice" && !studentAnswer.trim()) {
      showToast("Write an answer first.", "error");
      return;
    }
    setLoading(true);
    setLoadingMsg("Grading your answer...");
    try {
      let parsed;
      if (q.type === "multiple_choice") {
        const correct = selectedOption === q.correct_option;
        parsed = {
          correct,
          partial_credit_percent: correct ? 100 : 0,
          feedback: correct ? "Correct." : `Not quite. The correct answer was: ${q.correct_option}`,
          misconception: correct ? "" : `Selected "${selectedOption}" instead of the correct option.`,
          what_to_review: correct ? "" : q.hint || "Review this class's core concept.",
          mistake_type: correct ? "none" : "concept_gap",
        };
      } else {
        const prompt = `${TUTOR_VOICE_PROMPT}

Grade this student's exam answer like a strict but fair professor.

QUESTION: ${q.question}
MARKS AVAILABLE: ${q.marks || "n/a"}
MODEL ANSWER: ${q.modelAnswer}
STUDENT ANSWER: ${studentAnswer}

Give partial credit where deserved. Identify misconceptions and classify the mistake as concept_gap, careless_error, misread_question, or none.`;
        parsed = safeParseJSON(await callGemini({
          apiKey: settings.geminiApiKey,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: GRADING_SCHEMA },
        }, { onStatus: setLoadingMsg }));
      }
      const attempt = { ...parsed, studentAnswer, selectedOption, gradedAt: Date.now() };
      const key = lessonKey(selectedSubject.id, active.subtopic.id);
      if (hasFirebase && db) {
        const bankSnap = await getDoc(doc(db, "users", uid, "questionBanks", key));
        const bank = bankSnap.exists() ? bankSnap.data().questions || [] : [q];
        const nextBank = bank.map((question) => question.id === q.id ? appendAttempt(question, attempt) : question);
        await setDoc(doc(db, "users", uid, "questionBanks", key), { questions: nextBank }, { merge: true });
        setQuestionBank(nextBank);
      }
      setFeedback(parsed);
      setLesson((prev) => ({ ...prev, question: appendAttempt(q, attempt) }));
      await updateMastery(parsed);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const createModule = async (name) => {
    if (!name?.trim()) return;
    if (hasFirebase && db) {
      await addDoc(collection(db, "users", uid, "modules"), { name: name.trim(), order: modules.length, createdAt: serverTimestamp() });
    } else {
      const next = [...modules, { id: crypto.randomUUID(), name: name.trim(), order: modules.length }];
      setModules(next);
      saveLocalCollections(subjects, next);
    }
  };

  const renameModule = async (moduleId, name) => {
    if (!name?.trim()) return;
    if (hasFirebase && db) {
      await setDoc(doc(db, "users", uid, "modules", moduleId), { name: name.trim() }, { merge: true });
    } else {
      const next = modules.map((m) => (m.id === moduleId ? { ...m, name: name.trim() } : m));
      setModules(next);
      saveLocalCollections(subjects, next);
    }
  };

  const deleteModule = async (moduleId) => {
    if (hasFirebase && db) {
      await Promise.all(subjects.filter((subject) => subject.meta?.moduleId === moduleId).map((subject) => updateDoc(doc(db, "users", uid, "subjects", subject.id), { "meta.moduleId": null })));
      await deleteDoc(doc(db, "users", uid, "modules", moduleId));
    } else {
      const nextSubjects = subjects.map((subject) => subject.meta?.moduleId === moduleId ? { ...subject, meta: { ...subject.meta, moduleId: null } } : subject);
      const nextModules = modules.filter((module) => module.id !== moduleId);
      setSubjects(nextSubjects);
      setModules(nextModules);
      saveLocalCollections(nextSubjects, nextModules);
    }
    showToast("Module deleted.", "info");
  };

  // 1.2 Delete subject + clean up its lessons/questionBanks docs to avoid orphaned Firestore data
  const deleteSubject = async (subject) => {
    const keys = (subject.meta?.curriculum?.topics || []).flatMap((topic) => (topic.subtopics || []).map((st) => lessonKey(subject.id, st.id)));
    if (hasFirebase && db) {
      await Promise.all(
        keys.flatMap((key) => [
          deleteDoc(doc(db, "users", uid, "lessons", key)).catch(() => {}),
          deleteDoc(doc(db, "users", uid, "questionBanks", key)).catch(() => {}),
        ])
      );
      await deleteDoc(doc(db, "users", uid, "subjects", subject.id));
    } else {
      const nextSubjects = subjects.filter((s) => s.id !== subject.id);
      setSubjects(nextSubjects);
      saveLocalCollections(nextSubjects);
    }
    if (selectedSubject?.id === subject.id) {
      setSelectedSubject(null);
      setScreen("dashboard");
    }
    showToast("Module deleted.", "info");
  };

  const deleteMyData = async () => {
    if (!window.confirm("Delete all modules, lessons, question banks, and local settings for this account?")) return;
    if (hasFirebase && db) {
      await Promise.all(subjects.map((subject) => deleteSubject(subject)));
      await Promise.all(modules.map((module) => deleteDoc(doc(db, "users", uid, "modules", module.id)).catch(() => {})));
      await setDoc(doc(db, "users", uid, "settings", "app"), {
        onboarded: false,
        tutorialSeen: false,
        geminiApiKey: "",
        studyContext: "",
        referralSource: "",
        theme: settings.theme || "aurora",
      });
    }
    localStorage.removeItem("stem-subjects");
    localStorage.removeItem("stem-modules");
    localStorage.removeItem("stem-settings");
    sessionStorage.removeItem("stem-gemini-api-key");
    setSubjects([]);
    setModules([]);
    setSelectedSubject(null);
    setShowSettings(false);
    await persistSettings({ onboarded: false, tutorialSeen: false, geminiApiKey: "", studyContext: "", referralSource: "" });
    showToast("Your app data has been reset.", "info");
  };

  const moveSubject = async (subjectId, moduleId) => {
    await saveSubject(subjectId, { meta: { ...subjects.find((subject) => subject.id === subjectId)?.meta, moduleId } });
  };

  const reviewWeak = () => {
    const curriculum = selectedSubject.meta?.curriculum;
    for (const topic of curriculum?.topics || []) {
      for (const subtopic of topic.subtopics || []) {
        if (selectedSubject.masteryLog?.[subtopic.id]?.status === "attempted") {
          generateLesson(selectedSubject, topic, subtopic);
          return;
        }
      }
    }
  };

  if (authLoading || !settingsLoaded) {
    return (
      <div className="app-shell">
        <div className="container">
          <div className="card" style={{ padding: 24, marginBottom: 16, height: 64, animation: "stem-pulse 1.4s ease-in-out infinite" }} />
          <div className="grid subject-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card" style={{ padding: 18, height: 120, animation: "stem-pulse 1.4s ease-in-out infinite" }} />
            ))}
          </div>
          <style>{"@keyframes stem-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }"}</style>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="toast-wrap">
        {toasts.map((toast) => (
          <button key={toast.id} className={`toast ${toast.variant}`} onClick={() => removeToast(toast.id)}>{toast.message}</button>
        ))}
      </div>
      {loading && (
        <div className="loading-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="card loading-message">{loadingMsg || "Working..."}</div>
        </div>
      )}

      {!settings.onboarded ? (
        <Onboarding settings={settings} showToast={showToast} onDone={persistSettings} />
      ) : showSettings ? (
        <SettingsPage
          settings={settings}
          showToast={showToast}
          onClose={() => setShowSettings(false)}
          onSave={persistSettings}
          onReplayTutorial={startTutorial}
          onDeleteData={deleteMyData}
        />
      ) : screen === "dashboard" ? (
        <>
          <Dashboard
            subjects={subjects}
            modules={modules}
            onAddSubject={() => setScreen("add")}
            onOpenSubject={(subject) => { setSelectedSubject(subject); setScreen("subject"); }}
            onCreateModule={() => setDashboardModal({ kind: "createModule" })}
            onRenameModule={(module) => setDashboardModal({ kind: "renameModule", module })}
            onDeleteModule={(module) => setDashboardModal({ kind: "deleteModule", module })}
            onRenameSubject={(subject) => setDashboardModal({ kind: "renameSubject", subject })}
            onDeleteSubject={(subject) => setDashboardModal({ kind: "deleteSubject", subject })}
            onMoveSubject={moveSubject}
            onSettings={() => setShowSettings(true)}
          />
        </>
      ) : screen === "add" ? (
        <AddSubject onBack={() => setScreen("dashboard")} onCreate={buildCurriculum} loading={loading} loadingMsg={loadingMsg} showToast={showToast} />
      ) : screen === "subject" && selectedSubject ? (
        <SubjectView
          subject={selectedSubject}
          lessonStatus={lessonStatus}
          onBack={() => setScreen("dashboard")}
          onStartSubtopic={(topic, subtopic) => generateLesson(selectedSubject, topic, subtopic)}
          onReviewWeak={reviewWeak}
          onAddModuleFiles={updateModuleFromFiles}
          loading={loading}
          loadingMsg={loadingMsg}
          showToast={showToast}
        />
      ) : screen === "learn" && selectedSubject && active && lesson ? (
        <LearnView
          subject={selectedSubject}
          active={active}
          lesson={lesson}
          phase={phase}
          setPhase={setPhase}
          onBack={() => setScreen("subject")}
          onRegenerate={() => generateLesson(selectedSubject, active.topic, active.subtopic, true)}
          onFetchQuestion={fetchQuestion}
          onSubmitAnswer={submitAnswer}
          studentAnswer={studentAnswer}
          setStudentAnswer={setStudentAnswer}
          selectedOption={selectedOption}
          setSelectedOption={setSelectedOption}
          feedback={feedback}
          loading={loading}
          questionBank={questionBank}
          viewingBankQuestion={viewingBankQuestion}
          onOpenBankQuestion={setViewingBankQuestion}
          onCloseBankQuestion={() => setViewingBankQuestion(null)}
          showNotesPeek={showNotesPeek}
          setShowNotesPeek={setShowNotesPeek}
          mistakePattern={mistakePattern}
        />
      ) : null}

      {tutorialStep !== null && settings.onboarded && (
        <TutorialOverlay
          step={tutorialStep}
          onNext={advanceTutorial}
          onBack={goBackTutorial}
          onSkip={finishTutorial}
        />
      )}

      {dashboardModal?.kind === "createModule" && (
        <RenameModal
          title="New module"
          placeholder="Module name"
          onCancel={() => setDashboardModal(null)}
          onSave={async (name) => { await createModule(name); setDashboardModal(null); }}
        />
      )}
      {dashboardModal?.kind === "renameModule" && (
        <RenameModal
          title="Rename module"
          initialValue={dashboardModal.module.name}
          onCancel={() => setDashboardModal(null)}
          onSave={async (name) => { await renameModule(dashboardModal.module.id, name); setDashboardModal(null); }}
        />
      )}
      {dashboardModal?.kind === "deleteModule" && (
        <ConfirmModal
          title="Delete module?"
          message={`"${dashboardModal.module.name}" will be removed. Older grouped module records will become ungrouped, not deleted.`}
          onCancel={() => setDashboardModal(null)}
          onConfirm={async () => { await deleteModule(dashboardModal.module.id); setDashboardModal(null); }}
        />
      )}
      {dashboardModal?.kind === "renameSubject" && (
        <RenameModal
          title="Rename module"
          initialValue={dashboardModal.subject.meta?.name || ""}
          onCancel={() => setDashboardModal(null)}
          onSave={async (name) => { await saveSubject(dashboardModal.subject.id, { meta: { ...dashboardModal.subject.meta, name } }); setDashboardModal(null); }}
        />
      )}
      {dashboardModal?.kind === "deleteSubject" && (
        <ConfirmModal
          title="Delete module?"
          message={`"${dashboardModal.subject.meta?.name}" and all of its notes and practice history will be permanently deleted.`}
          onCancel={() => setDashboardModal(null)}
          onConfirm={async () => { await deleteSubject(dashboardModal.subject); setDashboardModal(null); }}
        />
      )}

      {!hasFirebase && settings.onboarded && (
        <div style={{ position: "fixed", left: 16, bottom: 16, maxWidth: 360 }} className="toast">
          Firebase env vars are missing, so modules and progress are local-only. PDFs are always stored on this device.
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StemTutor />
    </AuthProvider>
  );
}
