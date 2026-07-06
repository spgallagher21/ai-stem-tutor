import React, { useState, useRef, useEffect, useMemo } from "react";

// --- Configuration ---
// The Gemini call now goes through /api/generate (a Vercel serverless function)
// instead of hitting Google directly from the browser. See api/generate.js.
const GENERATE_ENDPOINT = "/api/generate";

// Below this size (characters), we send the whole document. Gemini 2.5 Flash
// has a ~1M token context window, so this is intentionally generous — it's
// there to keep requests fast/cheap for genuinely huge uploads, not because
// the model can't handle more.
const FULL_CONTEXT_LIMIT = 150000;

const THEME = {
  bg: "#0f172a",
  card: "#1e293b",
  border: "#334155",
  text: "#f8fafc",
  textMuted: "#94a3b8",
  primary: "#818cf8",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  accent: "#4f46e5",
};

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

// --- JSON schemas (Gemini structured output — no more regex-scraping prose) ---

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
              },
              required: ["name", "difficulty", "estimatedMinutes"],
            },
          },
        },
        required: ["name", "subtopics"],
      },
    },
  },
  required: ["topics"],
};

const LESSON_SCHEMA = {
  type: "OBJECT",
  properties: {
    explanation: { type: "STRING" },
    worked_example: { type: "STRING" },
    diagram_mermaid: { type: "STRING" },
    common_mistakes: { type: "ARRAY", items: { type: "STRING" } },
    summary: { type: "STRING" },
    source_refs: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["explanation", "worked_example", "common_mistakes", "summary"],
};

const EXAM_PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    question_types: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: {
            type: "STRING",
            enum: ["multiple_choice", "fill_blank", "short_answer", "derivation", "long_answer"],
          },
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
    type: {
      type: "STRING",
      enum: ["multiple_choice", "fill_blank", "short_answer", "derivation", "long_answer"],
    },
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

const GRADING_SCHEMA = {
  type: "OBJECT",
  properties: {
    correct: { type: "BOOLEAN" },
    partial_credit_percent: { type: "NUMBER" },
    feedback: { type: "STRING" },
    misconception: { type: "STRING" },
    what_to_review: { type: "STRING" },
    mistake_type: {
      type: "STRING",
      enum: ["concept_gap", "careless_error", "misread_question", "none"],
    },
  },
  required: ["correct", "partial_credit_percent", "feedback", "mistake_type"],
};

// --- Utilities ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeParseJSON(rawStr) {
  try {
    return JSON.parse(rawStr);
  } catch (e) {
    const jsonMatch = rawStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        throw new Error("The AI returned data in an unexpected format. Please try again.");
      }
    }
    throw new Error("The AI returned data in an unexpected format. Please try again.");
  }
}

// Splits text on paragraph boundaries and scores each chunk against query
// terms, so long documents get a relevance-ranked slice instead of an
// arbitrary character cutoff. Only used when a document exceeds FULL_CONTEXT_LIMIT.
function chunkText(fullText, targetChunkSize = 1500) {
  const paras = fullText.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks = [];
  let buf = "";
  for (const p of paras) {
    if (buf && (buf.length + p.length) > targetChunkSize) {
      chunks.push(buf);
      buf = p;
    } else {
      buf += (buf ? "\n\n" : "") + p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function getRelevantContext(fullText, queryText, maxChars = 60000) {
  if (!fullText) return "";
  if (fullText.length <= maxChars) return fullText;

  const terms = queryText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

  if (terms.length === 0) return fullText.slice(0, maxChars);

  const chunks = chunkText(fullText, 1500);
  const scored = chunks.map((c) => {
    const lower = c.toLowerCase();
    let score = 0;
    for (const t of terms) {
      score += lower.split(t).length - 1;
    }
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);

  let out = "";
  for (const { c } of scored) {
    if (out.length >= maxChars) break;
    out += c + "\n\n";
  }
  return out.length > 0 ? out : fullText.slice(0, maxChars);
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

function keyFor(tIdx, sIdx) {
  return `${tIdx}-${sIdx}`;
}

// Waits for a window global to exist (e.g. pdf.js/mermaid/katex loaded from a <script> tag)
function waitForGlobal(name, { timeout = 15000, interval = 150 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window[name]) return resolve(window[name]);
      if (Date.now() - start > timeout) return reject(new Error(`${name} failed to load. Check your connection and refresh.`));
      setTimeout(check, interval);
    };
    check();
  });
}

async function extractTextFromPDF(file) {
  await waitForGlobal("pdfjsLib");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((s) => s.str).join(" ") + " \n ";
  }
  return text;
}

// --- Gemini call (via server proxy), with client-side retry for network blips ---

async function callGemini({ contents, generationConfig, apiKey }, { retries = 2 } = {}) {
  const trimmedApiKey = (apiKey || "").trim();
  if (!trimmedApiKey) {
    throw new Error("Enter your Gemini API key before using the tutor.");
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GENERATE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents, generationConfig, apiKey: trimmedApiKey }),
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error("The server returned an unreadable response.");
      }

      if (!res.ok || data.error) {
        const msg = data.error || `Request failed (status ${res.status}).`;
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(600 * (attempt + 1));
          lastErr = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }

      const candidate = data.candidates?.[0];
      if (!candidate) throw new Error("Gemini returned no response (it may have been blocked by safety filters). Try rephrasing.");
      if (candidate.finishReason === "SAFETY") throw new Error("Gemini blocked this response for safety reasons. Try rephrasing your notes or question.");

      const textPart = candidate.content?.parts?.[0]?.text;
      if (!textPart) throw new Error("Gemini returned an empty response. Please try again.");
      return textPart;
    } catch (networkErr) {
      lastErr = networkErr;
      if (attempt >= retries) throw lastErr;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

// --- UI Components ---

const MathRenderer = ({ text }) => {
  const containerRef = useRef();
  useEffect(() => {
    if (window.renderMathInElement && containerRef.current) {
      window.renderMathInElement(containerRef.current, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
        ],
        throwOnError: false,
      });
    }
  }, [text]);
  return (
    <div
      ref={containerRef}
      style={{ lineHeight: 1.8, color: THEME.text }}
      dangerouslySetInnerHTML={{ __html: (text || "").replace(/\n/g, "<br/>") }}
    />
  );
};

const MermaidRenderer = ({ chart }) => {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);
  const id = useMemo(() => `mer-` + Math.random().toString(36).substr(2, 9), []);
  useEffect(() => {
    let cancelled = false;
    const renderChart = async () => {
      if (!chart) return;
      try {
        await waitForGlobal("mermaid");
        window.mermaid.initialize({ theme: "dark", startOnLoad: false });
        const { svg: renderedSvg } = await window.mermaid.render(id, chart);
        if (!cancelled) setSvg(renderedSvg);
      } catch (e) {
        console.error("Visual error:", e);
        if (!cancelled) setError(true);
      }
    };
    renderChart();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error || !chart) return null;
  return (
    <div
      style={{ background: "#000", padding: "20px", borderRadius: "12px", border: `1px solid ${THEME.border}`, margin: "20px 0", display: "flex", justifyContent: "center", overflowX: "auto" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

const CollapsibleList = ({ title, items, accentColor }) => {
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: "20px", border: `1px solid ${THEME.border}`, borderRadius: "12px", overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%", textAlign: "left", padding: "14px 16px", background: THEME.bg, color: accentColor || THEME.text,
          border: "none", cursor: "pointer", fontWeight: "bold", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}
      >
        <span>{title} ({items.length})</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <ul style={{ margin: 0, padding: "12px 24px", background: THEME.card }}>
          {items.map((item, i) => (
            <li key={i} style={{ marginBottom: "8px", color: THEME.textMuted }}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [geminiApiKey, setGeminiApiKey] = useState(() => sessionStorage.getItem("stem-gemini-api-key") || "");
  const [subject, setSubject] = useState(() => localStorage.getItem("stem-subject") || "");
  const [curriculum, setCurriculum] = useState(() => {
    const saved = localStorage.getItem("stem-curriculum");
    return saved ? JSON.parse(saved) : null;
  });
  const [masteryLog, setMasteryLog] = useState(() => {
    const saved = localStorage.getItem("stem-mastery-log");
    return saved ? JSON.parse(saved) : {};
  });
  const [examPlan, setExamPlan] = useState(() => {
    const saved = localStorage.getItem("stem-exam-plan");
    return saved ? JSON.parse(saved) : null;
  });
  const [notesContent, setNotesContent] = useState("");
  const [examContent, setExamContent] = useState("");
  const [notesFileNames, setNotesFileNames] = useState([]);
  const [examFileNames, setExamFileNames] = useState([]);

  const [screen, setScreen] = useState(curriculum ? "curriculum" : "setup");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [activePath, setActivePath] = useState({ tIdx: 0, sIdx: 0 });
  const [phase, setPhase] = useState("notes");
  const [sessionData, setSessionData] = useState({
    explanation: "", worked_example: "", diagram: "", common_mistakes: [], summary: "", source_refs: [], question: null,
  });
  const [studentAnswer, setStudentAnswer] = useState("");
  const [selectedOption, setSelectedOption] = useState(null);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (geminiApiKey.trim()) {
      sessionStorage.setItem("stem-gemini-api-key", geminiApiKey);
    } else {
      sessionStorage.removeItem("stem-gemini-api-key");
    }
  }, [geminiApiKey]);

  useEffect(() => {
    localStorage.setItem("stem-subject", subject);
    if (curriculum) localStorage.setItem("stem-curriculum", JSON.stringify(curriculum));
    localStorage.setItem("stem-mastery-log", JSON.stringify(masteryLog));
    if (examPlan) localStorage.setItem("stem-exam-plan", JSON.stringify(examPlan));
  }, [subject, curriculum, masteryLog, examPlan]);

  useEffect(() => {
    const scripts = [
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      "https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js",
      "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
      "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js",
    ];
    scripts.forEach((src) => {
      if (document.querySelector(`script[src="${src}"]`)) return;
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      document.head.appendChild(s);
    });
    if (!document.querySelector("link[data-katex-css]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
      link.setAttribute("data-katex-css", "true");
      document.head.appendChild(link);
    }

    const timer = setInterval(() => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        clearInterval(timer);
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const handleFileUpload = async (e, type) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setLoading(true);
    setLoadingMsg(`Reading ${type}...`);
    let combined = "";
    try {
      for (let file of files) {
        const text = await extractTextFromPDF(file);
        combined += `\n[SOURCE: ${file.name}]\n${text}\n`;
      }
      if (type === "Notes") {
        setNotesContent(combined);
        setNotesFileNames(files.map((f) => f.name));
      } else {
        setExamContent(combined);
        setExamFileNames(files.map((f) => f.name));
        setExamPlan(null); // force re-analysis against the new papers
      }
    } catch (err) {
      alert("Couldn't read that PDF: " + err.message);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const buildCurriculum = async () => {
    if (!subject.trim()) { alert("Please enter a subject first."); return; }
    if (!notesContent.trim()) { alert("Please upload lecture notes first — the tutor needs material to teach from."); return; }
    setLoading(true); setLoadingMsg("Reading your notes and mapping the syllabus...");
    try {
      const notesForPrompt = notesContent.length <= FULL_CONTEXT_LIMIT ? notesContent : getRelevantContext(notesContent, subject, FULL_CONTEXT_LIMIT);
      const prompt = `You are designing a college-level curriculum for "${subject}" based on the student's own lecture notes below. Break the material into topics and subtopics that mirror how the notes are actually structured — don't invent topics that aren't covered. Rate each subtopic's difficulty from 1 (easy) to 5 (hard) relative to typical exam demands, and estimate minutes needed to learn it.

LECTURE NOTES:
${notesForPrompt}`;
      const res = await callGemini({
        apiKey: geminiApiKey,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: CURRICULUM_SCHEMA },
      });
      const parsed = safeParseJSON(res);
      if (!parsed?.topics?.length) throw new Error("The AI returned an empty curriculum. Try again or add more complete notes.");
      setCurriculum(parsed);
      setMasteryLog({});
      setScreen("curriculum");
    } catch (e) { alert("Error: " + e.message); }
    setLoading(false);
  };

  const ensureExamPlan = async () => {
    if (examPlan) return examPlan;
    if (!examContent.trim()) {
      setExamPlan(DEFAULT_EXAM_PLAN);
      return DEFAULT_EXAM_PLAN;
    }
    setLoadingMsg("Analyzing your past papers' style...");
    try {
      const examForPrompt = examContent.length <= FULL_CONTEXT_LIMIT ? examContent : getRelevantContext(examContent, subject, FULL_CONTEXT_LIMIT);
      const prompt = `Analyze these past exam papers for "${subject}". Identify the real distribution of question types (multiple_choice, fill_blank, short_answer, derivation, long_answer), each one's approximate weight in the paper (percent, should sum to roughly 100), typical marks it's worth, and any notable phrasing or style conventions specific to this exam.

PAST PAPERS:
${examForPrompt}`;
      const res = await callGemini({
        apiKey: geminiApiKey,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: EXAM_PLAN_SCHEMA },
      });
      const parsed = safeParseJSON(res);
      const plan = parsed?.question_types?.length ? parsed : DEFAULT_EXAM_PLAN;
      setExamPlan(plan);
      return plan;
    } catch (e) {
      // Don't block practice on an analysis failure — fall back to the default mix.
      setExamPlan(DEFAULT_EXAM_PLAN);
      return DEFAULT_EXAM_PLAN;
    }
  };

  const handleStartSubtopic = async (tIdx, sIdx) => {
    setLoading(true); setLoadingMsg("Preparing your lesson...");
    const st = curriculum.topics[tIdx].subtopics[sIdx];
    const key = keyFor(tIdx, sIdx);
    const entry = masteryLog[key];
    const priorMistakesNote = entry?.mistakes?.length
      ? `The student has struggled with this subtopic before. Their recent mistakes: ${entry.mistakes.map((m) => `[${m.type}] ${m.note}`).join(" | ")}. Address these specifically in your explanation rather than just repeating a generic version.`
      : "";
    try {
      const context = notesContent.length <= FULL_CONTEXT_LIMIT
        ? notesContent
        : getRelevantContext(notesContent, `${curriculum.topics[tIdx].name} ${st.name}`, 80000);
      const prompt = `Teach the subtopic "${st.name}" (part of "${curriculum.topics[tIdx].name}") to a college student preparing for an exam, at difficulty ${st.difficulty}/5.

Ground your explanation strictly in the lecture notes provided below — do not introduce facts, formulas, or notation that aren't in the notes or standard prerequisite knowledge for this level. For source_refs, briefly note which source file or section each key fact came from.

Use LaTeX ($...$ inline, $$...$$ display) for math. Only fill in diagram_mermaid if a diagram (flowchart/graph/sequence) genuinely helps understanding — otherwise leave it as an empty string.
${priorMistakesNote}

LECTURE NOTES:
${context}`;
      const res = await callGemini({
        apiKey: geminiApiKey,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.25, responseMimeType: "application/json", responseSchema: LESSON_SCHEMA },
      });
      const parsed = safeParseJSON(res);
      setSessionData({
        explanation: parsed.explanation || "",
        worked_example: parsed.worked_example || "",
        diagram: parsed.diagram_mermaid || "",
        common_mistakes: parsed.common_mistakes || [],
        summary: parsed.summary || "",
        source_refs: parsed.source_refs || [],
        question: null,
      });
      setActivePath({ tIdx, sIdx });
      setPhase("notes");
      setScreen("learn");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const handleFetchQuestion = async () => {
    setLoading(true); setLoadingMsg("Writing a practice question...");
    const { tIdx, sIdx } = activePath;
    const st = curriculum.topics[tIdx].subtopics[sIdx];
    try {
      const plan = await ensureExamPlan();
      const chosenType = pickWeighted(plan.question_types, "weight_percent");
      const context = notesContent.length <= FULL_CONTEXT_LIMIT
        ? notesContent
        : getRelevantContext(notesContent, `${curriculum.topics[tIdx].name} ${st.name}`, 50000);
      const prompt = `Write ONE exam-style practice question on "${st.name}" for a college exam in "${subject}".

Question type: ${chosenType.type}. Style guidance from the real past papers: ${chosenType.style_notes || plan.overall_notes || "standard exam phrasing"}.
Difficulty: ${st.difficulty}/5 — make the question genuinely match this difficulty rather than defaulting to easy.
Marks: around ${chosenType.avg_marks || 5}.

If the type is multiple_choice: include exactly 4 plausible options in "options" (one clearly correct, the others real misconceptions/distractors) and put the exact correct option text in "correct_option". Otherwise leave "options" as an empty array and "correct_option" as an empty string.

Base the question on this source material:
${context}`;
      const res = await callGemini({
        apiKey: geminiApiKey,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json", responseSchema: QUESTION_SCHEMA },
      });
      const parsed = safeParseJSON(res);
      setSessionData((prev) => ({ ...prev, question: parsed }));
      setStudentAnswer(""); setSelectedOption(null); setFeedback(null); setPhase("question");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const updateMastery = (key, fb) => {
    setMasteryLog((prev) => {
      const entry = prev[key] || { status: "new", correctStreak: 0, mistakes: [] };
      const isGood = fb.correct || (fb.partial_credit_percent ?? 0) >= 80;
      let next;
      if (isGood) {
        const streak = entry.correctStreak + 1;
        next = { ...entry, correctStreak: streak, status: streak >= 2 ? "mastered" : "attempted" };
      } else {
        next = {
          ...entry,
          correctStreak: 0,
          status: "attempted",
          mistakes: [
            { type: fb.mistake_type || "concept_gap", note: fb.misconception || fb.what_to_review || "Needs review", ts: Date.now() },
            ...entry.mistakes,
          ].slice(0, 5),
        };
      }
      return { ...prev, [key]: next };
    });
  };

  const handleSubmitAnswer = async () => {
    const q = sessionData.question;
    const key = keyFor(activePath.tIdx, activePath.sIdx);

    if (q.type === "multiple_choice") {
      if (!selectedOption) { alert("Pick an option first."); return; }
      const correct = selectedOption === q.correct_option;
      const fb = {
        correct,
        partial_credit_percent: correct ? 100 : 0,
        feedback: correct ? "Correct." : `Not quite. The correct answer was: ${q.correct_option}`,
        misconception: correct ? "" : `Selected "${selectedOption}" instead of the correct option.`,
        what_to_review: correct ? "" : q.hint || "Review this subtopic's core concept.",
        mistake_type: correct ? "none" : "concept_gap",
      };
      setFeedback(fb);
      updateMastery(key, fb);
      return;
    }

    if (!studentAnswer.trim()) { alert("Write an answer first."); return; }
    setLoading(true); setLoadingMsg("Grading your answer...");
    try {
      const prompt = `Grade this student's exam answer like a strict but fair professor.

QUESTION: ${q.question}
MARKS AVAILABLE: ${q.marks || "n/a"}
MODEL ANSWER: ${q.modelAnswer}
STUDENT ANSWER: ${studentAnswer}

Give partial credit where deserved — don't just mark right/wrong. If the answer is wrong or partial, identify the specific misconception. Classify the mistake as exactly one of: concept_gap (doesn't understand the underlying idea), careless_error (understood it but made a slip), misread_question (answered something other than what was asked), or none (fully correct). State plainly what the student should review next.`;
      const res = await callGemini({
        apiKey: geminiApiKey,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: GRADING_SCHEMA },
      });
      const parsed = safeParseJSON(res);
      setFeedback(parsed);
      updateMastery(key, parsed);
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const jumpToWeakTopic = () => {
    for (const [key, entry] of Object.entries(masteryLog)) {
      if (entry.status === "attempted") {
        const [tIdx, sIdx] = key.split("-").map(Number);
        handleStartSubtopic(tIdx, sIdx);
        return;
      }
    }
  };

  const totalSubtopics = curriculum ? curriculum.topics.reduce((a, t) => a + t.subtopics.length, 0) : 0;
  const masteredCount = Object.values(masteryLog).filter((e) => e.status === "mastered").length;
  const weakCount = Object.values(masteryLog).filter((e) => e.status === "attempted").length;
  const progressPct = totalSubtopics > 0 ? Math.round((masteredCount / totalSubtopics) * 100) : 0;

  const inputStyle = { width: "100%", padding: "14px", borderRadius: "12px", border: `1px solid ${THEME.border}`, background: THEME.bg, color: THEME.text, marginBottom: "20px", boxSizing: "border-box" };
  const cardStyle = { background: THEME.card, border: `1px solid ${THEME.border}`, padding: "25px", borderRadius: "20px" };
  const btnStyle = { width: "100%", padding: "14px", borderRadius: "12px", background: THEME.primary, color: "#fff", border: "none", fontWeight: "bold", cursor: "pointer" };
  const btnDisabledStyle = { ...btnStyle, opacity: 0.5, cursor: "not-allowed" };
  const focusCss = `
    button:focus-visible, [role="button"]:focus-visible, input:focus-visible, textarea:focus-visible {
      outline: 3px solid ${THEME.primary};
      outline-offset: 2px;
    }
  `;

  if (screen === "setup") return (
    <div style={{ minHeight: "100vh", background: THEME.bg, color: THEME.text, padding: "40px 20px", fontFamily: "sans-serif" }}>
      <style>{focusCss}</style>
      <div style={{ maxWidth: 500, margin: "0 auto", ...cardStyle }}>
        <h2 style={{ marginBottom: "6px" }}>STEM Tutor AI</h2>
        <p style={{ fontSize: "13px", color: THEME.textMuted, marginTop: 0, marginBottom: "20px" }}>
          Enter your own Gemini API key. It stays in this browser session and is sent only to generate tutor responses.
        </p>
        <input
          type="password"
          placeholder="Gemini API Key"
          value={geminiApiKey}
          onChange={(e) => setGeminiApiKey(e.target.value)}
          style={inputStyle}
          aria-label="Gemini API key"
          autoComplete="off"
        />
        <input placeholder="Subject Title" value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} aria-label="Subject title" />

        <label style={{ fontSize: "12px", color: THEME.textMuted }}>Lecture Notes (PDF)</label>
        <input type="file" multiple accept=".pdf" onChange={(e) => handleFileUpload(e, "Notes")} style={{ ...inputStyle, padding: "10px" }} aria-label="Upload lecture notes PDFs" />
        {notesFileNames.length > 0 && (
          <div style={{ fontSize: "12px", color: THEME.success, marginTop: "-12px", marginBottom: "16px" }}>
            Loaded: {notesFileNames.join(", ")} ({notesContent.length.toLocaleString()} chars extracted)
          </div>
        )}

        <label style={{ fontSize: "12px", color: THEME.textMuted }}>Past Papers (PDF)</label>
        <input type="file" multiple accept=".pdf" onChange={(e) => handleFileUpload(e, "Exams")} style={{ ...inputStyle, padding: "10px" }} aria-label="Upload past exam paper PDFs" />
        {examFileNames.length > 0 && (
          <div style={{ fontSize: "12px", color: THEME.success, marginTop: "-12px", marginBottom: "16px" }}>
            Loaded: {examFileNames.join(", ")} — practice questions will match this exam's real style and question mix.
          </div>
        )}

        <button onClick={buildCurriculum} disabled={loading || !subject.trim() || !geminiApiKey.trim()} style={(loading || !subject.trim() || !geminiApiKey.trim()) ? btnDisabledStyle : btnStyle}>
          {loading ? loadingMsg || "Working..." : "Start Learning"}
        </button>
      </div>
    </div>
  );

  if (screen === "curriculum") return (
    <div style={{ minHeight: "100vh", background: THEME.bg, color: THEME.text, padding: "60px 20px" }}>
      <style>{focusCss}</style>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h1>{subject}</h1>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: THEME.primary }}>{progressPct}%</div>
        </div>
        <input
          type="password"
          placeholder="Gemini API Key"
          value={geminiApiKey}
          onChange={(e) => setGeminiApiKey(e.target.value)}
          style={{ ...inputStyle, maxWidth: 420 }}
          aria-label="Gemini API key"
          autoComplete="off"
        />
        {weakCount > 0 && (
          <button
            onClick={jumpToWeakTopic}
            style={{ background: "none", border: `1px solid ${THEME.warning}`, color: THEME.warning, borderRadius: "10px", padding: "10px 16px", cursor: "pointer", marginBottom: "30px", fontWeight: "bold" }}
          >
            ⟳ Review {weakCount} weak topic{weakCount > 1 ? "s" : ""}
          </button>
        )}
        {curriculum.topics.map((topic, tIdx) => (
          <div key={tIdx} style={{ marginBottom: "40px" }}>
            <h3 style={{ fontSize: "13px", color: THEME.textMuted, textTransform: "uppercase" }}>{topic.name}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "15px" }}>
              {topic.subtopics.map((st, sIdx) => {
                const key = keyFor(tIdx, sIdx);
                const entry = masteryLog[key];
                const borderColor = entry?.status === "mastered" ? THEME.success : entry?.status === "attempted" ? THEME.warning : THEME.border;
                return (
                  <div
                    key={sIdx}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleStartSubtopic(tIdx, sIdx)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleStartSubtopic(tIdx, sIdx); } }}
                    style={{ ...cardStyle, padding: "20px", cursor: "pointer", border: `1px solid ${borderColor}` }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <span>{st.name}</span>
                      <span style={{ fontSize: "11px", color: THEME.textMuted, whiteSpace: "nowrap", marginLeft: "8px" }}>{"★".repeat(st.difficulty || 1)}</span>
                    </div>
                    {entry?.status === "attempted" && (
                      <div style={{ fontSize: "11px", color: THEME.warning, marginTop: "8px" }}>Needs review</div>
                    )}
                    {entry?.status === "mastered" && (
                      <div style={{ fontSize: "11px", color: THEME.success, marginTop: "8px" }}>Mastered</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <button onClick={() => { localStorage.clear(); window.location.reload(); }} style={{ color: THEME.danger, background: "none", border: "none", cursor: "pointer", marginTop: "20px" }}>
          Reset Progress
        </button>
      </div>
      {loading && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, color: THEME.text }}>
          {loadingMsg}
        </div>
      )}
    </div>
  );

  if (screen === "learn") {
    const st = curriculum.topics[activePath.tIdx].subtopics[activePath.sIdx];
    return (
      <div style={{ minHeight: "100vh", background: THEME.bg, color: THEME.text, padding: "40px 20px" }}>
        <style>{focusCss}</style>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <button onClick={() => setScreen("curriculum")} style={{ background: "none", border: "none", color: THEME.textMuted, cursor: "pointer", marginBottom: "20px" }}>← Back</button>
          <div style={cardStyle}>
            {phase === "notes" ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 style={{ color: THEME.primary, margin: 0 }}>{st.name}</h2>
                  <span style={{ fontSize: "12px", color: THEME.textMuted }}>Difficulty {"★".repeat(st.difficulty || 1)}</span>
                </div>
                {sessionData.diagram && <MermaidRenderer chart={sessionData.diagram} />}
                <MathRenderer text={sessionData.explanation} />
                {sessionData.worked_example && (
                  <>
                    <h4 style={{ color: THEME.textMuted, marginTop: "24px", marginBottom: "8px" }}>Worked Example</h4>
                    <MathRenderer text={sessionData.worked_example} />
                  </>
                )}
                <CollapsibleList title="Common Mistakes to Avoid" items={sessionData.common_mistakes} accentColor={THEME.warning} />
                {sessionData.summary && (
                  <div style={{ marginTop: "20px", padding: "14px 16px", background: THEME.bg, borderRadius: "10px", fontSize: "14px", color: THEME.textMuted }}>
                    <strong style={{ color: THEME.text }}>Summary: </strong>{sessionData.summary}
                  </div>
                )}
                {sessionData.source_refs?.length > 0 && (
                  <div style={{ marginTop: "12px", fontSize: "11px", color: THEME.textMuted }}>
                    Grounded in: {sessionData.source_refs.join(" · ")}
                  </div>
                )}
                <button style={{ ...btnStyle, marginTop: "30px" }} onClick={handleFetchQuestion}>Go to Practice</button>
              </div>
            ) : sessionData.question ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                  <span style={{ fontSize: "12px", color: THEME.primary, fontWeight: "bold" }}>{QUESTION_TYPE_LABELS[sessionData.question.type] || sessionData.question.type}</span>
                  <span style={{ fontSize: "12px", color: THEME.textMuted }}>{sessionData.question.marks ? `${sessionData.question.marks} marks` : ""}</span>
                </div>
                <h3><MathRenderer text={sessionData.question.question} /></h3>

                {sessionData.question.type === "multiple_choice" ? (
                  <div style={{ marginBottom: "20px" }}>
                    {(sessionData.question.options || []).map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedOption(opt)}
                        disabled={!!feedback}
                        style={{
                          display: "block", width: "100%", textAlign: "left", padding: "14px", marginBottom: "10px", borderRadius: "10px",
                          border: `1px solid ${selectedOption === opt ? THEME.primary : THEME.border}`,
                          background: selectedOption === opt ? THEME.accent : THEME.bg, color: THEME.text, cursor: feedback ? "default" : "pointer",
                        }}
                      >
                        <MathRenderer text={opt} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <textarea value={studentAnswer} onChange={(e) => setStudentAnswer(e.target.value)} style={{ ...inputStyle, height: "140px" }} placeholder="Your answer..." aria-label="Your answer" disabled={!!feedback} />
                )}

                {!feedback ? (
                  <button style={btnStyle} onClick={handleSubmitAnswer}>Submit</button>
                ) : (
                  <div style={{ marginTop: "20px", padding: "20px", borderRadius: "15px", background: feedback.correct ? "#064e3b" : (feedback.partial_credit_percent >= 80 ? "#3f2d0a" : "#450a0a") }}>
                    {typeof feedback.partial_credit_percent === "number" && (
                      <div style={{ fontWeight: "bold", marginBottom: "8px" }}>{feedback.correct ? "Correct" : `Partial credit: ${feedback.partial_credit_percent}%`}</div>
                    )}
                    <p style={{ margin: 0 }}>{feedback.feedback}</p>
                    {feedback.misconception && <p style={{ marginTop: "10px", fontSize: "14px", color: THEME.textMuted }}><strong>Misconception:</strong> {feedback.misconception}</p>}
                    {feedback.what_to_review && <p style={{ marginTop: "6px", fontSize: "14px", color: THEME.textMuted }}><strong>Review:</strong> {feedback.what_to_review}</p>}
                    <button
                      style={{ ...btnStyle, marginTop: "15px", background: "#fff", color: "#000" }}
                      onClick={() => {
                        const key = keyFor(activePath.tIdx, activePath.sIdx);
                        const status = masteryLog[key]?.status;
                        const isGood = feedback.correct || feedback.partial_credit_percent >= 80;
                        if (isGood && status === "mastered") {
                          setScreen("curriculum");
                        } else if (isGood) {
                          handleFetchQuestion();
                        } else {
                          setPhase("notes");
                        }
                      }}
                    >
                      {feedback.correct || feedback.partial_credit_percent >= 80
                        ? (masteryLog[keyFor(activePath.tIdx, activePath.sIdx)]?.status === "mastered" ? "Back to topics" : "One more to master it →")
                        : "Review the lesson again"}
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
        {loading && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            {loadingMsg}
          </div>
        )}
      </div>
    );
  }

  return null;
}
