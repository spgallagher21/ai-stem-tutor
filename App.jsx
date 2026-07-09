import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
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
  writeBatch
} from "firebase/firestore";
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
  waitForGlobal,
} from "./pdfUtils";

const GENERATE_ENDPOINT = "/api/generate";
const UPLOAD_FILE_ENDPOINT = "/api/upload-file";
const MAX_ATTEMPTS_STORED = 20;

const THEME_CHOICES = [
  { id: "aurora", name: "Midnight Aurora" },
  { id: "sunset", name: "Pink Sunset" },
  { id: "refraction", name: "White Refraction" },
];

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

const BATCH_QUESTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
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
      }
    }
  },
  required: ["questions"]
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

const TEACHING_PHILOSOPHY_PROMPT = `Teach this like the world's best tutor for a student studying [STUDY_CONTEXT]. Break it into bite-sized sections, each building on the last. Use plain language; if a technical term is unavoidable, define it in plain terms the first time it appears. Every section should connect back to a real-world physical example, not just abstract math. Every full equation must be on its own line, numbered sequentially, with each term explained in words. Include a worked example that mirrors realistic exam difficulty. Avoid unnecessary jargon. Ground everything strictly in the provided lecture notes unless a fact is genuinely missing from them.`;

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

function computeAdaptiveDifficulty(baseDifficulty, bank = []) {
  const recentAttempts = bank
    .flatMap(q => q.attempts || [])
    .slice(-5);
  if (recentAttempts.length < 2) return baseDifficulty;
  const avg = recentAttempts.reduce((s, a) => s + (a.partial_credit_percent ?? (a.correct ? 100 : 0)), 0) / recentAttempts.length;
  if (avg >= 85) return Math.min(5, baseDifficulty + 1);
  if (avg <= 45) return Math.max(1, baseDifficulty - 1);
  return baseDifficulty;
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

// Client-side rolling logs for local rate limiting
function trackGeminiCall() {
  const now = Date.now();
  const logs = JSON.parse(localStorage.getItem("stem_gemini_logs") || "[]");
  logs.push(now);
  const oneHourAgo = now - 3600000;
  const pruned = logs.filter(ts => ts > oneHourAgo);
  localStorage.setItem("stem_gemini_logs", JSON.stringify(pruned));
}

function getGeminiCallCounts() {
  const now = Date.now();
  const logs = JSON.parse(localStorage.getItem("stem_gemini_logs") || "[]");
  const pastHour = logs.filter(ts => ts > now - 3600000).length;
  const pastDay = logs.filter(ts => ts > now - 86400000).length;
  return { pastHour, pastDay };
}

async function callGemini({ contents, generationConfig, apiKey, documentPart, tools }, { retries = 3 } = {}) {
  const trimmedApiKey = (apiKey || "").trim();
  if (!trimmedApiKey) throw new Error("Enter your Gemini API key before using the tutor.");

  // Check rolling calls in the last 60 seconds (Soft ceiling limit of 10 requests per minute)
  const now = Date.now();
  let calls60 = JSON.parse(localStorage.getItem("stem_gemini_60s_logs") || "[]").filter(ts => ts > now - 60000);
  if (calls60.length >= 10) {
    const waitTime = Math.ceil((60000 - (now - calls60[0])) / 1000);
    throw new Error(`throttled:${waitTime}`);
  }

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
          // Exponential backoff with jitter
          const delay = Math.min(10000, Math.pow(2, attempt) * 1500) + Math.random() * 500;
          await sleep(delay);
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

      // Log successful call
      trackGeminiCall();
      const runLogs = JSON.parse(localStorage.getItem("stem_gemini_60s_logs") || "[]").filter(ts => ts > Date.now() - 60000);
      runLogs.push(Date.now());
      localStorage.setItem("stem_gemini_60s_logs", JSON.stringify(runLogs));

      return textPart;
    } catch (err) {
      lastErr = err;
      if (err.message && err.message.startsWith("throttled:")) throw err;
      if (attempt >= retries) throw lastErr;
      const delay = Math.min(8000, Math.pow(2, attempt) * 1000) + Math.random() * 400;
      await sleep(delay);
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

const StyleOverrides = () => (
  <style>{`
    :root {
      --signature: linear-gradient(90deg, var(--accent-1), var(--accent-2), var(--accent-3), var(--accent-1));
    }
    [data-theme="sunset"] {
      --accent-2: #f8bbd0 !important;
    }
    .note-paper .btn.secondary {
      color: #1a1a1a !important;
      border-color: #e5dfd3 !important;
      background: transparent !important;
    }
    .note-paper .btn.secondary:hover {
      background: #f7f2e9 !important;
    }
    .note-paper .btn {
      background: #1a1a1a !important;
      color: #fdfbf7 !important;
      border: none !important;
    }
    .note-paper .btn:hover {
      background: #333333 !important;
    }
    .note-paper-text h1, .note-paper-text h2, .note-paper-text h3 {
      color: #1a1a1a !important;
    }
    
    /* Elegant CSS Skeleton Loader */
    .skeleton-wrap {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
    }
    .skeleton-line {
      height: 20px;
      width: 100%;
      background: linear-gradient(90deg, var(--surface-2) 25%, var(--border) 50%, var(--surface-2) 75%);
      background-size: 200% 100%;
      animation: skeleton-wave 1.6s infinite ease-in-out;
      border-radius: 6px;
    }
    .skeleton-line.heading {
      height: 32px;
      width: 60%;
    }
    .skeleton-line.short {
      width: 40%;
    }
    @keyframes skeleton-wave {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* Micro-interactions */
    .card, .btn, .subject-grid div {
      transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .card:hover, .subject-grid div:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    }
    .btn:active {
      transform: scale(0.98);
    }
    
    /* Sliding and responsive Split Layouts */
    .split-layout {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
    }
    @media (min-width: 1024px) {
      .split-layout {
        grid-template-columns: 1.2fr 0.8fr;
      }
    }
    
    /* Tutorial highlight and standard elements */
    .tutorial-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.72);
      backdrop-filter: blur(4px);
      z-index: 2000;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    .tutorial-card {
      background: var(--surface-1);
      border: 1px solid var(--accent-1);
      border-radius: 12px;
      padding: 24px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    }
    
    /* Custom Modals */
    .custom-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(4px);
      z-index: 1800;
      display: grid;
      place-items: center;
      padding: 16px;
    }
    .custom-modal {
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      animation: modal-pop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes modal-pop {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    
    /* Past Questions History list styling */
    .history-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 400px;
      overflow-y: auto;
      padding-right: 6px;
    }
    .history-item {
      padding: 12px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      border-radius: 8px;
      cursor: pointer;
    }
    .history-item:hover {
      background: var(--surface-1);
      border-color: var(--accent-1);
    }
    .status-chip {
      display: inline-block;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: bold;
    }
    .status-chip.correct { background: var(--success); color: #fff; }
    .status-chip.partial { background: var(--warning); color: #000; }
    .status-chip.wrong { background: #ef4444; color: #fff; }
    .status-chip.unattempted { background: var(--border); color: var(--text); }
  `}</style>
);

const MathRenderer = ({ text, paper = false }) => {
  return (
    <div className={paper ? "note-paper-text" : "app-text"} style={{ lineHeight: 1.75 }}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
      >
        {text || ""}
      </ReactMarkdown>
    </div>
  );
};

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
    <button className="card" data-theme={theme.id} onClick={onSelect} style={{ width: "100%", textAlign: "left", padding: 18, cursor: "pointer", borderColor: selected ? "var(--accent-1)" : "var(--border)", color: "var(--text)" }}>
      <div className="progress-bar" style={{ marginBottom: 14 }}><span style={{ width: "68%" }} /></div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ height: 28, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6 }} />
        <div style={{ height: 28, width: "72%", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6 }} />
      </div>
    </button>
  );
}

function Onboarding({ settings, setSettings, onDone, showToast }) {
  const [step, setStep] = useState(1);
  const [apiKey, setApiKey] = useState(settings.geminiApiKey || "");
  const [theme, setTheme] = useState(settings.theme || "aurora");
  const [studyContext, setStudyContext] = useState(settings.studyContext || "");
  const [studyLevel, setStudyLevel] = useState(settings.studyLevel || "");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const handleNext = () => {
    if (step === 2 && !apiKey.trim()) {
      showToast("Please provide an API key to proceed.", "error");
      return;
    }
    if (step === 3 && (!studyContext.trim() || !studyLevel.trim())) {
      showToast("Please enter your study focus and educational level.", "error");
      return;
    }
    setStep(prev => prev + 1);
  };

  const handleBack = () => {
    setStep(prev => Math.max(1, prev - 1));
  };

  const finish = async () => {
    await onDone({
      geminiApiKey: apiKey.trim(),
      theme,
      studyContext: studyContext.trim(),
      studyLevel: studyLevel.trim(),
      onboarded: true,
      tutorialSeen: false // Reset tutorial so it shows on the dashboard
    });
  };

  return (
    <div className="app-shell">
      <div className="container narrow card" style={{ padding: 28 }}>
        {step === 1 && (
          <div>
            <h1 className="heading" style={{ marginTop: 0 }}>Welcome to STEM Tutor AI</h1>
            <p className="muted" style={{ lineHeight: 1.6 }}>
              Unlock structured tutoring tailored explicitly to your academic materials. 
              Upload lecture notes, generate responsive summaries, analyze past exams, 
              and practice with adaptive professor-validated exercises.
            </p>
            <button className="btn" style={{ width: "100%", marginTop: 16 }} onClick={handleNext}>Continue</button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="heading" style={{ marginTop: 0 }}>Configure Gemini API</h2>
            <p className="muted" style={{ fontSize: 14 }}>
              Your tutor runs on your personal Gemini quota. We store your key securely in Firebase 
              (readable only by your authenticated user account) and use it directly for AI requests.
            </p>
            <div style={{ background: "var(--surface-2)", padding: 14, borderRadius: 8, margin: "16px 0", fontSize: 13, border: "1px solid var(--border)" }}>
              <strong>How to get a key:</strong>
              <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                <li>Visit <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" style={{ color: "var(--accent-1)", textDecoration: "underline" }}>Google AI Studio</a>.</li>
                <li>Sign in with any standard Google account.</li>
                <li>Tap <strong>Get API Key</strong> and select your project.</li>
              </ol>
            </div>
            <label className="muted" style={{ fontSize: 13 }}>Gemini API key</label>
            <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" style={{ margin: "8px 0 22px", width: "100%" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn secondary" style={{ flex: 1 }} onClick={handleBack}>Back</button>
              <button className="btn" style={{ flex: 1 }} onClick={handleNext}>Next</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="heading" style={{ marginTop: 0 }}>Syllabus & Goal Setup</h2>
            <p className="muted" style={{ fontSize: 14 }}>
              This details your targeted learning parameters. Your generated summaries and exercises will adjust dynamically to this complexity.
            </p>
            <label className="muted" style={{ fontSize: 13 }}>What are you studying?</label>
            <input className="input" value={studyContext} onChange={(e) => setStudyContext(e.target.value)} placeholder="e.g. 3rd year mechanical engineering, AP Physics" style={{ margin: "8px 0 16px", width: "100%" }} />
            
            <label className="muted" style={{ fontSize: 13 }}>What level is this targeted at?</label>
            <input className="input" value={studyLevel} onChange={(e) => setStudyLevel(e.target.value)} placeholder="e.g. Undergrad, High School, Ph.D. prep" style={{ margin: "8px 0 22px", width: "100%" }} />
            
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn secondary" style={{ flex: 1 }} onClick={handleBack}>Back</button>
              <button className="btn" style={{ flex: 1 }} onClick={handleNext}>Next</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="heading" style={{ marginTop: 0 }}>Choose Theme</h2>
            <p className="muted" style={{ fontSize: 14, marginBottom: 16 }}>
              Select a preferred aesthetic style. This choice can be reconfigured in Settings later.
            </p>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 24 }}>
              {THEME_CHOICES.map((choice) => (
                <ThemePreviewCard key={choice.id} theme={choice} selected={choice.id === theme} onSelect={() => setTheme(choice.id)} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn secondary" style={{ flex: 1 }} onClick={handleBack}>Back</button>
              <button className="btn" style={{ flex: 1 }} onClick={handleNext}>Next</button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 className="heading" style={{ marginTop: 0 }}>Initialization Ready!</h2>
            <p className="muted" style={{ lineHeight: 1.6 }}>
              All configuration data has been successfully staged. Your academic notes will reside securely on this device, and progress indicators sync via your authenticated Firestore space.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
              <button className="btn secondary" style={{ flex: 1 }} onClick={handleBack}>Back</button>
              <button className="btn" style={{ flex: 1 }} onClick={finish}>Get Started</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TutorialOverlay({ onComplete }) {
  const [tutStep, setTutStep] = useState(0);

  const steps = [
    {
      title: "Syllabus Mapping",
      text: "Tap 'Add Subject' to upload your lecture notes. The AI will map your structure cleanly, keeping all resources local.",
    },
    {
      title: "Active Mastery Tracker",
      text: "Your subject progress rings and module outlines adjust over time based on active quiz assessments.",
    },
    {
      title: "Targeted Revision & Peek Options",
      text: "Tap subtopic cards to access summaries. During active quizzes, toggle 'Peek at Notes' or track errors through Question History.",
    }
  ];

  const handleNext = () => {
    if (tutStep < steps.length - 1) {
      setTutStep(prev => prev + 1);
    } else {
      onComplete();
    }
  };

  return (
    <div className="tutorial-overlay">
      <div className="tutorial-card">
        <h3 className="heading" style={{ marginTop: 0, color: "var(--accent-1)" }}>{steps[tutStep].title}</h3>
        <p className="muted" style={{ lineHeight: 1.5, margin: "14px 0 24px" }}>{steps[tutStep].text}</p>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="mono muted" style={{ fontSize: 12 }}>{tutStep + 1} / {steps.length}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={onComplete}>Skip</button>
            <button className="btn" onClick={handleNext}>{tutStep === steps.length - 1 ? "Finish" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ subjects, modules, onAddSubject, onOpenSubject, onCreateModule, onDeleteModule, onRenameModule, onRenameSubject, onDeleteSubject, onMoveSubject, onSettings }) {
  const ungrouped = subjects.filter((subject) => !subject.meta?.moduleId);
  
  const moduleProgress = (moduleId) => {
    const owned = subjects.filter((subject) => subject.meta?.moduleId === moduleId);
    if (!owned.length) return 0;
    return Math.round(owned.reduce((sum, subject) => sum + computeSubjectProgress(subject.meta?.curriculum, subject.masteryLog), 0) / owned.length);
  };

  return (
    <div className="app-shell">
      <div className="container">
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 28 }}>
          <div>
            <h1 className="heading" style={{ margin: 0 }}>Study Dashboard</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>Subjects, modules, progress, and cached lessons in one place.</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn secondary" onClick={onSettings}>Settings</button>
            <button className="btn secondary" onClick={onCreateModule}>Add Module</button>
            <button className="btn" onClick={onAddSubject}>Add Subject</button>
          </div>
        </header>

        {subjects.length === 0 && modules.length === 0 ? (
          <div className="card" style={{ padding: "48px 24px", textAlign: "center", maxWidth: 600, margin: "40px auto" }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-1)" strokeWidth="1.5" style={{ marginBottom: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
            <h2 className="heading" style={{ marginTop: 0 }}>Get Started with STEM Tutor</h2>
            <p className="muted" style={{ margin: "8px 0 24px", lineHeight: 1.5 }}>
              Begin by mapping your physical syllabus. Upload your first lecture notes PDF to generate notes, summaries, and exam-style practices.
            </p>
            <button className="btn" onClick={onAddSubject}>Add Your First Subject</button>
          </div>
        ) : null}

        {modules.map((module) => {
          const owned = subjects.filter((subject) => subject.meta?.moduleId === module.id);
          return (
            <section key={module.id} className="card" style={{ padding: 20, marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <h2 className="heading" style={{ margin: 0 }}>{module.name}</h2>
                    <button className="btn ghost" style={{ minHeight: "auto", padding: "2px 6px" }} onClick={() => onRenameModule(module.id, module.name)}>
                      ✏️
                    </button>
                  </div>
                  <div className="muted mono" style={{ fontSize: 13 }}>{moduleProgress(module.id)}% module progress</div>
                </div>
                <button className="btn ghost" onClick={() => onDeleteModule(module.id)}>Delete module</button>
              </div>
              <SubjectGrid 
                subjects={owned} 
                modules={modules} 
                onOpenSubject={onOpenSubject} 
                onMoveSubject={onMoveSubject}
                onRenameSubject={onRenameSubject}
                onDeleteSubject={onDeleteSubject}
              />
            </section>
          );
        })}

        {(ungrouped.length > 0 || (subjects.length > 0 && modules.length === 0)) && (
          <section>
            <h2 className="heading">Ungrouped Subjects</h2>
            <SubjectGrid 
              subjects={ungrouped} 
              modules={modules} 
              onOpenSubject={onOpenSubject} 
              onMoveSubject={onMoveSubject}
              onRenameSubject={onRenameSubject}
              onDeleteSubject={onDeleteSubject}
            />
          </section>
        )}
      </div>
    </div>
  );
}

function SubjectGrid({ subjects, modules, onOpenSubject, onMoveSubject, onRenameSubject, onDeleteSubject }) {
  if (!subjects.length) return <p className="muted">No subjects here yet.</p>;
  return (
    <div className="grid subject-grid">
      {subjects.map((subject) => {
        const progress = computeSubjectProgress(subject.meta?.curriculum, subject.masteryLog);
        const remaining = (subject.meta?.curriculum?.topics || []).reduce((sum, topic) => sum + (topic.subtopics || []).reduce((inner, st) => inner + (subject.masteryLog?.[st.id]?.status === "mastered" ? 0 : st.estimatedMinutes || 10), 0), 0);
        return (
          <div key={subject.id} className="card" style={{ padding: 18, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <button className="btn ghost" onClick={() => onOpenSubject(subject)} style={{ width: "100%", textAlign: "left", padding: 0, minHeight: "auto", color: "var(--text)" }}>
                  <h3 className="heading" style={{ margin: "4px 0" }}>{subject.meta?.name || "Untitled subject"}</h3>
                </button>
                <div style={{ display: "flex", gap: 2 }}>
                  <button className="btn ghost" style={{ minHeight: "auto", padding: "4px" }} onClick={() => onRenameSubject(subject.id, subject.meta?.name)}>✏️</button>
                  <button className="btn ghost" style={{ minHeight: "auto", padding: "4px" }} onClick={() => onDeleteSubject(subject.id, subject.meta?.name)}>🗑️</button>
                </div>
              </div>
              
              <button className="btn ghost" onClick={() => onOpenSubject(subject)} style={{ width: "100%", padding: 0, minHeight: "auto", textAlign: "left" }}>
                <div className="progress-bar" style={{ marginTop: 10 }}><span style={{ width: `${progress}%` }} /></div>
                <div className="muted mono" style={{ fontSize: 13, marginTop: 10 }}>{progress}% complete - {remaining} min left</div>
              </button>
            </div>
            
            {modules.length > 0 && (
              <select className="input" value={subject.meta?.moduleId || ""} onChange={(e) => onMoveSubject(subject.id, e.target.value || null)} style={{ marginTop: 14 }}>
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

function SubjectView({ subject, lessonStatus, onBack, onStartSubtopic, onReviewWeak }) {
  const masteryLog = subject.masteryLog || {};
  const weakCount = Object.values(masteryLog).filter((entry) => entry.status === "attempted").length;
  const progress = computeSubjectProgress(subject.meta?.curriculum, masteryLog);
  return (
    <div className="app-shell">
      <div className="container">
        <button className="btn ghost" onClick={onBack}>Back</button>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 22 }}>
          <div>
            <h1 className="heading" style={{ marginBottom: 6 }}>{subject.meta?.name}</h1>
            <div className="muted mono">{progress}% complete</div>
          </div>
          {weakCount > 0 && <button className="btn secondary" onClick={onReviewWeak}>Review {weakCount} weak topic{weakCount > 1 ? "s" : ""}</button>}
        </header>
        {(subject.meta?.curriculum?.topics || []).map((topic) => (
          <section key={topic.id} style={{ marginBottom: 34 }}>
            <h2 className="heading" style={{ fontSize: 18 }}>{topic.name}</h2>
            <div className="grid subject-grid">
              {(topic.subtopics || []).map((st) => {
                const entry = masteryLog[st.id];
                const hasLesson = lessonStatus.has(st.id);
                const borderColor = entry?.status === "mastered" ? "var(--success)" : entry?.status === "attempted" ? "var(--warning)" : "var(--border)";
                
                // Fetch mistake count to show warning patterns
                const misCount = entry?.mistakes?.length || 0;
                
                return (
                  <div
                    key={st.id}
                    role="button"
                    tabIndex={0}
                    className="card signature-line"
                    onClick={() => onStartSubtopic(topic, st)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onStartSubtopic(topic, st); } }}
                    style={{ padding: 18, cursor: "pointer", borderColor, opacity: hasLesson ? 1 : 0.62 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <strong>{st.name}</strong>
                      <span className="mono muted">{st.difficulty || 1}/5</span>
                    </div>
                    <div className="muted" style={{ marginTop: 10, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
                      <span>{entry?.status === "mastered" ? "Mastered" : entry?.status === "attempted" ? "Needs review" : hasLesson ? "Notes ready" : "Not generated yet"}</span>
                      {misCount > 0 && <span style={{ color: "var(--warning)", fontWeight: "bold" }}>⚠️ {misCount} errs</span>}
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
        <h1 className="heading">Add Subject</h1>
        <p className="muted">PDFs are stored on this device. Your subject, lessons, questions, and progress can sync through Firestore, but source PDFs must be re-uploaded on a different device before regenerating content there.</p>
        <label className="muted" style={{ fontSize: 13 }}>Subject title</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ margin: "8px 0 18px", width: "100%" }} />
        <label className="muted" style={{ fontSize: 13 }}>Lecture notes PDFs</label>
        <input className="input" type="file" accept=".pdf" multiple onChange={(e) => readFiles(e.target.files, setNotesFiles, "Lecture notes")} style={{ margin: "8px 0 10px", width: "100%" }} />
        {notesFiles.length > 0 && <p className="muted">{notesFiles.map((f) => f.name).join(", ")}</p>}
        <label className="muted" style={{ fontSize: 13 }}>Past papers PDFs</label>
        <input className="input" type="file" accept=".pdf" multiple onChange={(e) => readFiles(e.target.files, setExamFiles, "Past papers")} style={{ margin: "8px 0 10px", width: "100%" }} />
        {examFiles.length > 0 && <p className="muted">{examFiles.map((f) => f.name).join(", ")}</p>}
        <button className="btn" disabled={loading || !name.trim() || notesFiles.length === 0} onClick={() => onCreate({ name, notesFiles, examFiles })} style={{ width: "100%", marginTop: 16 }}>
          {loading ? loadingMsg || "Working..." : "Build Curriculum"}
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
          <strong style={{ color: "#1a1a1a" }}>Learning outcomes</strong>
          <ul style={{ color: "#1a1a1a" }}>{outcomes.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
      )}
      {lesson.diagram_mermaid && <MermaidRenderer chart={lesson.diagram_mermaid} paper />}
      {(lesson.sections || []).map((section, idx) => (
        <section className="note-section" key={`${section.heading}-${idx}`}>
          <h2 style={{ color: "#1a1a1a" }}>{section.heading}</h2>
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
          <h2 style={{ marginTop: 0, color: "#1a1a1a" }}>Worked Example</h2>
          <MathRenderer text={worked.problem_statement} paper />
          <ol style={{ color: "#1a1a1a" }}>{(worked.steps || []).map((step, i) => <li key={i}><MathRenderer text={step} paper /></li>)}</ol>
          {worked.final_answer && <strong style={{ color: "#1a1a1a" }}><MathRenderer text={worked.final_answer} paper /></strong>}
        </div>
      )}
      {lesson.common_mistakes?.length > 0 && (
        <div className="note-section">
          <h2 style={{ color: "#1a1a1a" }}>Common Mistakes</h2>
          <ul style={{ color: "#1a1a1a" }}>{lesson.common_mistakes.map((item, i) => <li key={i}>{item}</li>)}</ul>
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

function LearnView({ subject, active, lesson, phase, setPhase, onBack, onRegenerate, onFetchQuestion, onSubmitAnswer, studentAnswer, setStudentAnswer, selectedOption, setSelectedOption, feedback, loading, subtopicBank = [] }) {
  const [peekNotes, setPeekNotes] = useState(false);
  const [activeTab, setActiveTab] = useState("current"); // "current" | "history"
  const [viewHistoryItem, setViewHistoryItem] = useState(null); // specific question item to read

  const q = lesson.question;
  const entry = subject.masteryLog?.[active.subtopic.id];

  return (
    <div className="app-shell">
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button className="btn ghost" onClick={onBack}>Back to subject</button>
          {phase === "question" && (
            <button className="btn secondary" onClick={() => setPeekNotes(prev => !prev)}>
              {peekNotes ? "Hide Notes Peek" : "Peek at Notes"}
            </button>
          )}
        </div>
        
        <h1 className="heading">{active.subtopic.name}</h1>

        <div className="split-layout">
          {/* Main Content Area */}
          <div>
            {phase === "notes" ? (
              <NotePaper lesson={lesson} loading={loading} onRegenerate={onRegenerate} onPractice={onFetchQuestion} />
            ) : q ? (
              <div>
                {/* Collapsible Quick Peek Panel */}
                {peekNotes && (
                  <div className="card" style={{ padding: 18, marginBottom: 20, maxHeight: 400, overflowY: "auto", border: "1.5px solid var(--accent-1)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <strong style={{ color: "var(--accent-1)" }}>Quick Study Peek</strong>
                      <button className="btn ghost" style={{ minHeight: "auto", padding: "2px 8px" }} onClick={() => setPeekNotes(false)}>Close</button>
                    </div>
                    <NotePaper lesson={lesson} loading={loading} onRegenerate={onRegenerate} onPractice={() => setPeekNotes(false)} />
                  </div>
                )}

                {/* Subtopic Error Warnings summary */}
                {entry?.mistakes?.length > 0 && (
                  <div className="card" style={{ padding: 12, marginBottom: 16, background: "rgba(245, 158, 11, 0.1)", border: "1px solid var(--warning)", borderRadius: 8 }}>
                    <strong style={{ color: "var(--warning)" }}>⚠️ Subtopic Error Patterns:</strong>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13 }}>
                      <li>You've recorded minor concept gaps and {entry.mistakes.filter(m => m.type === "careless_error").length} careless slip-ups recently.</li>
                    </ul>
                  </div>
                )}

                {/* Question Practice Card */}
                <div className="card" style={{ padding: 24, margin: "0 auto" }}>
                  {/* Practice Tabs */}
                  <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 18 }}>
                    <button 
                      className={`btn ghost ${activeTab === "current" ? "active" : ""}`} 
                      style={{ borderBottom: activeTab === "current" ? "2px solid var(--accent-1)" : "none", borderRadius: 0 }}
                      onClick={() => { setActiveTab("current"); setViewHistoryItem(null); }}
                    >
                      Active Question
                    </button>
                    <button 
                      className={`btn ghost ${activeTab === "history" ? "active" : ""}`} 
                      style={{ borderBottom: activeTab === "history" ? "2px solid var(--accent-1)" : "none", borderRadius: 0 }}
                      onClick={() => setActiveTab("history")}
                    >
                      Question History ({subtopicBank.length})
                    </button>
                  </div>

                  {activeTab === "current" ? (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                        <strong style={{ color: "var(--accent-1)" }}>{QUESTION_TYPE_LABELS[q.type] || q.type}</strong>
                        <span className="muted mono">{q.marks ? `${q.marks} marks` : ""}</span>
                      </div>
                      <h2><MathRenderer text={q.question} /></h2>
                      {q.type === "multiple_choice" ? (
                        <div className="grid" style={{ gap: 10, marginTop: 16 }}>
                          {(q.options || []).map((opt) => (
                            <button key={opt} className="btn secondary" disabled={!!feedback} onClick={() => setSelectedOption(opt)} style={{ textAlign: "left", borderColor: selectedOption === opt ? "var(--accent-1)" : "var(--border)", background: selectedOption === opt ? "var(--surface-2)" : "transparent" }}>
                              <MathRenderer text={opt} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <textarea className="input" value={studentAnswer} onChange={(e) => setStudentAnswer(e.target.value)} disabled={!!feedback} placeholder="Your answer..." style={{ minHeight: 150, width: "100%", marginTop: 14 }} />
                      )}
                      {!feedback ? (
                        <button className="btn" onClick={onSubmitAnswer} style={{ width: "100%", marginTop: 18 }}>Submit Answer</button>
                      ) : (
                        <div className="card" style={{ padding: 18, marginTop: 18, background: "var(--surface-2)" }}>
                          <strong>{feedback.correct ? "Correct" : `Partial credit: ${feedback.partial_credit_percent}%`}</strong>
                          <p>{feedback.feedback}</p>
                          {feedback.misconception && <p className="muted"><strong>Misconception:</strong> {feedback.misconception}</p>}
                          {feedback.what_to_review && <p className="muted"><strong>Review:</strong> {feedback.what_to_review}</p>}
                          <button className="btn" onClick={() => (feedback.correct || feedback.partial_credit_percent >= 80 ? onFetchQuestion() : setPhase("notes"))}>
                            {feedback.correct || feedback.partial_credit_percent >= 80 ? "Try another question" : "Review the lesson again"}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      {viewHistoryItem ? (
                        <div>
                          <button className="btn ghost" style={{ minHeight: "auto", padding: "4px 8px", marginBottom: 12 }} onClick={() => setViewHistoryItem(null)}>← Back to History List</button>
                          <h4>Question Prompt:</h4>
                          <MathRenderer text={viewHistoryItem.question} />
                          <h4 style={{ marginTop: 14 }}>Your Response:</h4>
                          <p style={{ fontStyle: "italic" }}>{viewHistoryItem.attempts?.[0]?.studentAnswer || viewHistoryItem.attempts?.[0]?.selectedOption || "No response saved."}</p>
                          <h4 style={{ marginTop: 14 }}>Feedback:</h4>
                          <p>{viewHistoryItem.attempts?.[0]?.feedback || "Not assessed."}</p>
                        </div>
                      ) : (
                        <div className="history-list">
                          {subtopicBank.map((item, idx) => {
                            const lastAttempt = item.attempts?.[0];
                            let status = "unattempted";
                            if (lastAttempt) {
                              if (lastAttempt.correct) status = "correct";
                              else if (lastAttempt.partial_credit_percent > 0) status = "partial";
                              else status = "wrong";
                            }
                            return (
                              <div key={item.id || idx} className="history-item" onClick={() => setViewHistoryItem(item)}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <strong>Q{subtopicBank.length - idx}: {QUESTION_TYPE_LABELS[item.type]}</strong>
                                  <span className={`status-chip ${status}`}>{status.toUpperCase()}</span>
                                </div>
                                <div className="muted" style={{ fontSize: 13, textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden", marginTop: 4 }}>
                                  {item.question}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomModal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div className="custom-modal-overlay" onClick={onClose}>
      <div className="custom-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 className="heading" style={{ margin: 0 }}>{title}</h3>
          <button className="btn ghost" style={{ minHeight: "auto", padding: "4px 8px" }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StemTutor() {
  const { uid, authLoading, firebaseReady: hasFirebase } = useAuth();
  const { toasts, showToast, removeToast } = useToasts();
  const [settings, setSettings] = useState({ onboarded: false, geminiApiKey: "", theme: "aurora", studyContext: "", studyLevel: "" });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
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
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [subtopicBank, setSubtopicBank] = useState([]);
  const sessionPdfBytes = useRef(new Map());

  // Dynamic state configs for custom modals
  const [modalState, setModalState] = useState({
    isOpen: false,
    type: "", // "createModule" | "renameModule" | "renameSubject" | "deleteModule" | "deleteSubject"
    title: "",
    targetId: "",
    inputValue: "",
  });

  useEffect(() => {
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
      const next = saved || { onboarded: false, geminiApiKey: sessionStorage.getItem("stem-gemini-api-key") || "", theme: "aurora", studyContext: "", studyLevel: "" };
      setSettings(next);
      document.documentElement.dataset.theme = next.theme || "aurora";
      setSettingsLoaded(true);
    });
  }, [uid]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme || "aurora";
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

  // Query active question list for history tab inside LearnView
  useEffect(() => {
    if (!selectedSubject || !active || !uid) return;
    const key = lessonKey(selectedSubject.id, active.subtopic.id);
    if (hasFirebase && db) {
      getDoc(doc(db, "users", uid, "questionBanks", key)).then((snap) => {
        if (snap.exists()) {
          setSubtopicBank(snap.data().questions || []);
        } else {
          setSubtopicBank([]);
        }
      });
    } else {
      const localBanks = JSON.parse(localStorage.getItem("stem_local_question_banks") || "{}");
      setSubtopicBank(localBanks[key] || []);
    }
  }, [selectedSubject, active, uid, feedback, hasFirebase]);

  const persistSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    sessionStorage.setItem("stem-gemini-api-key", next.geminiApiKey || "");
    await saveSettings(uid, next);
  };

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
    const source = files[0];
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
    setLoadingMsg("Saving PDFs on this device and mapping the syllabus...");
    try {
      const tempSubject = { meta: { sourceFiles: notesFiles.map((file, i) => ({ ...file, localPdfId: `session-notes-${i}` })) } };
      notesFiles.forEach((file, i) => sessionPdfBytes.current.set(`session-notes-${i}`, file.bytes));
      const documentPart = await getDocumentPart(tempSubject, { scoped: false });
      const prompt = `You are designing a college-level curriculum for "${name}" based on the attached lecture notes PDF. Break the material into topics and subtopics that mirror how the notes are actually structured. Do not invent topics that are not covered. Rate each subtopic's difficulty from 1 to 5 and estimate minutes needed to learn it.`;
      
      const res = await callGemini({
        apiKey: settings.geminiApiKey,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        documentPart,
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: CURRICULUM_SCHEMA },
      });
      const curriculum = assignIds(safeParseJSON(res));
      if (!curriculum.topics?.length) throw new Error("The AI returned an empty curriculum. Try more complete lecture notes.");

      const subjectId = hasFirebase && db ? doc(collection(db, "users", uid, "subjects")).id : crypto.randomUUID();
      const sourceFiles = await storeSourceFiles(subjectId, notesFiles, "notes");
      const storedExamFiles = await storeSourceFiles(subjectId, examFiles, "exam");
      const subjectDoc = {
        id: subjectId,
        meta: { name, moduleId: null, curriculum, examPlan: null, sourceFiles, examFiles: storedExamFiles, createdAt: hasFirebase ? serverTimestamp() : Date.now() },
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
      if (err.message && err.message.startsWith("throttled:")) {
        const time = err.message.split(":")[1];
        showToast(`AI is recharging. Retrying request in ${time} seconds.`, "info");
      } else {
        showToast(err.message, "error");
      }
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
        contents: [{ role: "user", parts: [{ text: `Analyze the attached past exam paper for "${subject.meta.name}". Identify the distribution of question types, typical marks, and style conventions.` }] }],
        documentPart,
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: EXAM_PLAN_SCHEMA },
      });
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
      const documentPart = await getDocumentPart(subject, { queryText: `${topic.name} ${subtopic.name}`, scoped: true });
      
      const studyLevelStr = settings.studyLevel ? `Academic level: ${settings.studyLevel}` : "college-level";
      const studyContextStr = settings.studyContext ? `Focus: ${settings.studyContext}` : "engineering student";
      
      const customPhilosophy = TEACHING_PHILOSOPHY_PROMPT
        .replace("[STUDY_CONTEXT]", `${studyLevelStr} ${studyContextStr}`);

      const draftPrompt = `${TUTOR_VOICE_PROMPT}\n\n${customPhilosophy}\n\nCreate a sectioned lesson for "${subtopic.name}" in the topic "${topic.name}" for "${subject.meta.name}". Refer to the attached lecture notes document for source material. Return only the requested JSON.`;
      
      let draft = safeParseJSON(await callGemini({
        apiKey: settings.geminiApiKey,
        contents: [{ role: "user", parts: [{ text: draftPrompt }] }],
        documentPart,
        generationConfig: { temperature: 0.25, responseMimeType: "application/json", responseSchema: LESSON_SCHEMA_V2 },
      }));

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
          }));
        } catch (err) {
          draft.used_web_search = false;
        }
      }

      setLoadingMsg("Checking it over...");
      let finalLesson = draft;
      try {
        const critiquePrompt = `You are a professor in ${subject.meta.name} fact-checking a junior tutor's lesson before it reaches a student. 
Check every equation, every claim, and the worked example for correctness. 
Rubric Checklist:
1. Academic Accuracy: Verify formula derivations and terminology.
2. Tutor Tone: Confirm the instruction tone is instructional, respectful, objective, and avoids unnecessary exclamation/praise filler.
3. Clarity check.
Be specific and actionable.\n\nLesson:\n${JSON.stringify(draft)}`;

        const critique = safeParseJSON(await callGemini({
          apiKey: settings.geminiApiKey,
          contents: [{ role: "user", parts: [{ text: critiquePrompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: REVIEW_SCHEMA },
        }));
        if (critique.verdict === "needs_revision") {
          setLoadingMsg("Polishing the final version...");
          finalLesson = safeParseJSON(await callGemini({
            apiKey: settings.geminiApiKey,
            contents: [{ role: "user", parts: [{ text: `Revise this lesson using the professor critique. Preserve the sectioned JSON schema.\n\nCritique:\n${JSON.stringify(critique)}\n\nDraft:\n${JSON.stringify(draft)}` }] }],
            generationConfig: { temperature: 0.15, responseMimeType: "application/json", responseSchema: LESSON_SCHEMA_V2 },
          }));
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
    } catch (err) {
      if (err.message && err.message.startsWith("throttled:")) {
        const time = err.message.split(":")[1];
        showToast(`AI is cooling down. Retrying lesson drafting in ${time} seconds.`, "info");
      } else {
        showToast(err.message, "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchQuestion = async () => {
    if (!selectedSubject || !active) return;
    setLoading(true);
    setLoadingMsg("Preparing practice questions...");
    try {
      const key = lessonKey(selectedSubject.id, active.subtopic.id);
      let bank = [];
      if (hasFirebase && db) {
        const bankSnap = await getDoc(doc(db, "users", uid, "questionBanks", key));
        bank = bankSnap.exists() ? bankSnap.data().questions || [] : [];
      } else {
        const localBanks = JSON.parse(localStorage.getItem("stem_local_question_banks") || "{}");
        bank = localBanks[key] || [];
      }
      
      // Look for an existing, completely unseen question in the cached bank to reduce active API call count
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

      setLoadingMsg("Batching 3 practice questions with the AI...");
      const plan = await ensureExamPlan(selectedSubject);
      const chosenType = pickWeighted(plan.question_types, "weight_percent");
      const documentPart = await getDocumentPart(selectedSubject, { queryText: `${active.topic.name} ${active.subtopic.name}`, scoped: true });
      
      // Calculate Adaptive Difficulty based on performance records
      const adaptiveDiff = computeAdaptiveDifficulty(active.subtopic.difficulty || 2, bank);

      const prompt = `Write THREE diverse exam-style practice questions on "${active.subtopic.name}" for a college exam in "${selectedSubject.meta.name}".

Question type request: ${chosenType.type}. Style guidance from real papers: ${chosenType.style_notes || plan.overall_notes || "standard exam phrasing"}.
Calculated Adaptive Target Difficulty: ${adaptiveDiff}/5.
Marks range: around ${chosenType.avg_marks || 5}.

For each question, if it is multiple_choice, include exactly 4 options and set correct_option. Otherwise options/correct_option should remain empty. Provide a rigorous model answer and target hint. Return exactly three valid questions as JSON in the batch schema format.`;
      
      const parsedBatch = safeParseJSON(await callGemini({
        apiKey: settings.geminiApiKey,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        documentPart,
        generationConfig: { temperature: 0.5, responseMimeType: "application/json", responseSchema: BATCH_QUESTION_SCHEMA },
      }));

      const newQuestions = (parsedBatch.questions || []).map(q => ({
        ...q,
        id: crypto.randomUUID(),
        attempts: [],
        createdAt: Date.now()
      }));

      if (!newQuestions.length) {
        throw new Error("AI returned an empty question list. Please try again.");
      }

      const nextBank = [...bank, ...newQuestions];
      if (hasFirebase && db) {
        await setDoc(doc(db, "users", uid, "questionBanks", key), { questions: nextBank }, { merge: true });
      } else {
        const localBanks = JSON.parse(localStorage.getItem("stem_local_question_banks") || "{}");
        localBanks[key] = nextBank;
        localStorage.setItem("stem_local_question_banks", JSON.stringify(localBanks));
      }

      // Serve the first question from the newly created batch
      const servedQuestion = newQuestions[0];
      setLesson((prev) => ({ ...prev, question: servedQuestion }));
      setStudentAnswer("");
      setSelectedOption(null);
      setFeedback(null);
      setPhase("question");
    } catch (err) {
      if (err.message && err.message.startsWith("throttled:")) {
        const time = err.message.split(":")[1];
        showToast(`AI rate limits reached. Recharging for ${time} seconds.`, "info");
      } else {
        showToast(err.message, "error");
      }
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
          what_to_review: correct ? "" : q.hint || "Review this subtopic's core concept.",
          mistake_type: correct ? "none" : "concept_gap",
        };
      } else {
        const prompt = `${TUTOR_VOICE_PROMPT}

Grade this student's exam answer like a strict but fair professor.

QUESTION: ${q.question}
MARKS AVAILABLE: ${q.marks || "n/a"}
MODEL ANSWER: ${q.modelAnswer}
STUDENT ANSWER: ${studentAnswer}

Give partial credit where deserved. Identify misconceptions and classify the mistake as concept_gap, careless_error, misread_question, or none. Provide honest, direct feedback.`;
        
        parsed = safeParseJSON(await callGemini({
          apiKey: settings.geminiApiKey,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: GRADING_SCHEMA },
        }));
      }
      const attempt = { ...parsed, studentAnswer, selectedOption, gradedAt: Date.now() };
      const key = lessonKey(selectedSubject.id, active.subtopic.id);
      
      if (hasFirebase && db) {
        const bankSnap = await getDoc(doc(db, "users", uid, "questionBanks", key));
        const bank = bankSnap.exists() ? bankSnap.data().questions || [] : [q];
        const nextBank = bank.map((question) => question.id === q.id ? appendAttempt(question, attempt) : question);
        await setDoc(doc(db, "users", uid, "questionBanks", key), { questions: nextBank }, { merge: true });
      } else {
        const localBanks = JSON.parse(localStorage.getItem("stem_local_question_banks") || "{}");
        const bank = localBanks[key] || [q];
        const nextBank = bank.map((question) => question.id === q.id ? appendAttempt(question, attempt) : question);
        localBanks[key] = nextBank;
        localStorage.setItem("stem_local_question_banks", JSON.stringify(localBanks));
      }
      setFeedback(parsed);
      setLesson((prev) => ({ ...prev, question: appendAttempt(q, attempt) }));
      await updateMastery(parsed);
    } catch (err) {
      if (err.message && err.message.startsWith("throttled:")) {
        const time = err.message.split(":")[1];
        showToast(`AI limits active. Grading will finish in ${time} seconds.`, "info");
      } else {
        showToast(err.message, "error");
      }
    } finally {
      setLoading(false);
    }
  };

  // Modals & Action Handlers
  const handleOpenModal = (type, title, targetId = "", initialVal = "") => {
    setModalState({
      isOpen: true,
      type,
      title,
      targetId,
      inputValue: initialVal,
    });
  };

  const handleCloseModal = () => {
    setModalState({ isOpen: false, type: "", title: "", targetId: "", inputValue: "" });
  };

  const executeModalAction = async () => {
    const { type, targetId, inputValue } = modalState;
    if (type === "createModule") {
      if (!inputValue.trim()) return;
      if (hasFirebase && db) {
        await addDoc(collection(db, "users", uid, "modules"), { name: inputValue.trim(), order: modules.length, createdAt: serverTimestamp() });
      } else {
        const next = [...modules, { id: crypto.randomUUID(), name: inputValue.trim(), order: modules.length }];
        setModules(next);
        saveLocalCollections(subjects, next);
      }
    } else if (type === "renameModule") {
      if (!inputValue.trim()) return;
      if (hasFirebase && db) {
        await setDoc(doc(db, "users", uid, "modules", targetId), { name: inputValue.trim() }, { merge: true });
      } else {
        const next = modules.map(m => m.id === targetId ? { ...m, name: inputValue.trim() } : m);
        setModules(next);
        saveLocalCollections(subjects, next);
      }
    } else if (type === "renameSubject") {
      if (!inputValue.trim()) return;
      await saveSubject(targetId, { meta: { name: inputValue.trim() } });
    } else if (type === "deleteSubject") {
      setLoading(true);
      setLoadingMsg("Deleting subject and cleaning subtopic collections...");
      try {
        const targetSub = subjects.find(s => s.id === targetId);
        if (hasFirebase && db) {
          const batch = writeBatch(db);
          batch.delete(doc(db, "users", uid, "subjects", targetId));
          
          // Cascading cleanups
          for (const topic of targetSub?.meta?.curriculum?.topics || []) {
            for (const st of topic.subtopics || []) {
              const key = lessonKey(targetId, st.id);
              batch.delete(doc(db, "users", uid, "lessons", key));
              batch.delete(doc(db, "users", uid, "questionBanks", key));
            }
          }
          await batch.commit();
        } else {
          const next = subjects.filter(s => s.id !== targetId);
          setSubjects(next);
          saveLocalCollections(next);
        }
        showToast("Subject deleted successfully.", "success");
      } catch (err) {
        showToast("Error during subject deletion.", "error");
      } finally {
        setLoading(false);
      }
    } else if (type === "deleteModule") {
      if (hasFirebase && db) {
        // Move associated subjects to Ungrouped
        await Promise.all(subjects.filter((subject) => subject.meta?.moduleId === targetId).map((subject) => updateDoc(doc(db, "users", uid, "subjects", subject.id), { "meta.moduleId": null })));
        await deleteDoc(doc(db, "users", uid, "modules", targetId));
      } else {
        const nextSubjects = subjects.map((subject) => subject.meta?.moduleId === targetId ? { ...subject, meta: { ...subject.meta, moduleId: null } } : subject);
        const nextModules = modules.filter((module) => module.id !== targetId);
        setSubjects(nextSubjects);
        setModules(nextModules);
        saveLocalCollections(nextSubjects, nextModules);
      }
    }
    handleCloseModal();
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
      <div className="app-shell" style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <StyleOverrides />
        <div className="skeleton-wrap" style={{ maxWidth: 400 }}>
          <div className="skeleton-line heading"></div>
          <div className="skeleton-line"></div>
          <div className="skeleton-line short"></div>
        </div>
      </div>
    );
  }

  const { pastHour, pastDay } = getGeminiCallCounts();

  return (
    <>
      <StyleOverrides />
      <div className="toast-wrap">
        {toasts.map((toast) => (
          <button key={toast.id} className={`toast ${toast.variant}`} onClick={() => removeToast(toast.id)}>{toast.message}</button>
        ))}
      </div>
      {loading && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "grid", placeItems: "center", color: "#fff", zIndex: 1500 }}>
          <div className="card" style={{ padding: 24, textAlign: "center" }}>
            <div className="skeleton-wrap" style={{ width: 300, marginBottom: 12 }}>
              <div className="skeleton-line"></div>
            </div>
            <div>{loadingMsg}</div>
          </div>
        </div>
      )}
      
      {/* Interactive Modal System */}
      <CustomModal isOpen={modalState.isOpen} onClose={handleCloseModal} title={modalState.title}>
        {(modalState.type === "deleteSubject" || modalState.type === "deleteModule") ? (
          <div>
            <p className="muted">Are you sure you want to delete this resource? This actions cannot be undone.</p>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn secondary" style={{ flex: 1 }} onClick={handleCloseModal}>Cancel</button>
              <button className="btn" style={{ flex: 1, background: "#ef4444" }} onClick={executeModalAction}>Confirm Delete</button>
            </div>
          </div>
        ) : (
          <div>
            <input 
              className="input" 
              value={modalState.inputValue} 
              onChange={(e) => setModalState(prev => ({ ...prev, inputValue: e.target.value }))}
              placeholder="Enter name..."
              style={{ width: "100%", marginBottom: 18 }}
              onKeyDown={(e) => { if (e.key === "Enter") executeModalAction(); }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn secondary" style={{ flex: 1 }} onClick={handleCloseModal}>Cancel</button>
              <button className="btn" style={{ flex: 1 }} onClick={executeModalAction}>Save</button>
            </div>
          </div>
        )}
      </CustomModal>

      {/* Tutorial Overlay */}
      {settings.onboarded && settings.tutorialSeen === false && (
        <TutorialOverlay onComplete={async () => {
          await persistSettings({ tutorialSeen: true });
        }} />
      )}

      {!settings.onboarded ? (
        <Onboarding settings={settings} setSettings={setSettings} showToast={showToast} onDone={persistSettings} />
      ) : screen === "dashboard" ? (
        <Dashboard
          subjects={subjects}
          modules={modules}
          onAddSubject={() => setScreen("add")}
          onOpenSubject={(subject) => { setSelectedSubject(subject); setScreen("subject"); }}
          onCreateModule={() => handleOpenModal("createModule", "Add New Module")}
          onDeleteModule={(id) => handleOpenModal("deleteModule", "Confirm Delete Module", id)}
          onRenameModule={(id, name) => handleOpenModal("renameModule", "Rename Module", id, name)}
          onRenameSubject={(id, name) => handleOpenModal("renameSubject", "Rename Subject", id, name)}
          onDeleteSubject={(id, name) => handleOpenModal("deleteSubject", `Delete Subject: ${name}`, id)}
          onMoveSubject={moveSubject}
          onSettings={() => setSettings((prev) => ({ ...prev, onboarded: false }))}
        />
      ) : screen === "add" ? (
        <AddSubject onBack={() => setScreen("dashboard")} onCreate={buildCurriculum} loading={loading} loadingMsg={loadingMsg} showToast={showToast} />
      ) : screen === "subject" && selectedSubject ? (
        <SubjectView subject={selectedSubject} lessonStatus={lessonStatus} onBack={() => setScreen("dashboard")} onStartSubtopic={(topic, subtopic) => generateLesson(selectedSubject, topic, subtopic)} onReviewWeak={reviewWeak} />
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
          subtopicBank={subtopicBank}
        />
      ) : null}

      {/* Usage Indicator and Fallbacks */}
      {!hasFirebase && settings.onboarded && (
        <div style={{ position: "fixed", left: 16, bottom: 16, maxWidth: 360, zIndex: 1000 }} className="toast">
          Firebase credentials are not detected. Local simulation is active.
        </div>
      )}

      {settings.onboarded && (
        <div style={{ position: "fixed", right: 16, bottom: 16, background: "var(--surface-1)", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, color: "var(--text)", zIndex: 1400 }} className="mono">
          AI Queries Today: {pastHour} (hour) / {pastDay} (day)
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
