import React, { useState, useRef, useEffect, useMemo } from "react";

// --- Configuration & Constants ---
const LEVELS = ["1st Year Undergraduate", "Advanced Undergraduate", "Masters", "PhD Candidate"];
const GEMINI_MODEL = "gemini-2.0-flash";

const COLORS = {
  primary: "#6366f1",
  primaryLight: "#eef2ff",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  bg: "#f8fafc",
  card: "#ffffff",
  text: "#0f172a",
  textMuted: "#64748b",
  border: "#e2e8f0"
};

const STEM_TUTOR_SYSTEM_PROMPT = `
You are a cross-disciplinary STEM Master Tutor. 
SCOPE: Mathematics, Physics, Chemistry, Biology, Computer Science, and Engineering.

RULES:
1. NO JARGON: If a technical term is necessary, explain it using a simple analogy first.
2. PHYSICAL EXAMPLES: Every concept must be tied to a physical object or real-world scenario.
3. VISUALS: You MUST provide a Mermaid.js code block for every subtopic to visualize the process.
4. MATH: Use LaTeX for all scientific notation (inline: $...$, block: $$...$$).
5. BITE-SIZED: Keep notes focused. One specific sub-topic at a time.
6. STYLE: If past papers are provided, mimic their difficulty, phrasing, and technical rigor exactly.
`;

// --- Utility: Robust JSON Extraction ---
function extractJSON(text) {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error("JSON not found");
    return JSON.parse(text.substring(start, end + 1));
  } catch (e) {
    console.error("AI Response Parsing Error:", text);
    throw new Error("The AI provided an invalid data format. Please try again.");
  }
}

// --- Component: Math Rendering (KaTeX) ---
function MathRenderer({ text }) {
  const containerRef = useRef();
  useEffect(() => {
    if (window.renderMathInElement && containerRef.current) {
      window.renderMathInElement(containerRef.current, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true }
        ],
        throwOnError: false
      });
    }
  }, [text]);

  return <div ref={containerRef} dangerouslySetInnerHTML={{ __html: text.replace(/\n/g, '<br/>') }} style={{ lineHeight: 1.8 }} />;
}

// --- Component: Mermaid Diagram Rendering ---
function MermaidRenderer({ chart }) {
  const [svg, setSvg] = useState("");
  const id = useMemo(() => `mer-` + Math.random().toString(36).substr(2, 9), []);

  useEffect(() => {
    const renderChart = async () => {
      if (window.mermaid && chart) {
        try {
          const { svg: renderedSvg } = await window.mermaid.render(id, chart);
          setSvg(renderedSvg);
        } catch (e) { console.error("Mermaid Render Error", e); }
      }
    };
    renderChart();
  }, [chart, id]);

  return (
    <div style={{ 
      background: '#fff', padding: '24px', borderRadius: '16px', 
      border: `1px solid ${COLORS.border}`, margin: '24px 0', 
      display: 'flex', justifyContent: 'center', overflowX: 'auto' 
    }} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

// --- Main App Component ---
export default function STEM_Tutor_App() {
  // Setup State
  const [apiKey, setApiKey] = useState("");
  const [screen, setScreen] = useState("setup");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  // Input State
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState(LEVELS[0]);
  const [notesText, setNotesText] = useState("");
  const [pastPaperText, setPastPaperText] = useState("");

  // Course Logic State
  const [curriculum, setCurriculum] = useState(null);
  const [masteredKeys, setMasteredKeys] = useState(new Set());
  const [activePath, setActivePath] = useState({ tIdx: 0, sIdx: 0 });
  const [phase, setPhase] = useState("notes"); // notes, comprehension, exam
  const [content, setContent] = useState({ text: "", diagram: "" });
  const [currentQ, setCurrentQ] = useState(null);
  const [studentAnswer, setStudentAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);

  // Load Dependencies
  useEffect(() => {
    const scripts = [
      "https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js",
      "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
      "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
    ];
    const links = ["https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"];

    links.forEach(href => {
      const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
      document.head.appendChild(l);
    });

    scripts.forEach(src => {
      const s = document.createElement("script"); s.src = src; s.async = false;
      document.head.appendChild(s);
    });
  }, []);

  // AI Communication
  const callAI = async (messages, sysInstruction) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: STEM_TUTOR_SYSTEM_PROMPT + sysInstruction }] },
        contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.3, maxOutputTokens: 2500 }
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates[0].content.parts[0].text;
  };

  // Weighted Progress Calculation
  const { progressPct } = useMemo(() => {
    if (!curriculum) return { progressPct: 0 };
    let total = 0; let earned = 0;
    curriculum.topics.forEach((t, tIdx) => {
      t.subtopics.forEach((st, sIdx) => {
        const weight = (st.difficulty || 3) * (st.estimatedMinutes || 20);
        total += weight;
        if (masteredKeys.has(`${tIdx}-${sIdx}`)) earned += weight;
      });
    });
    return { progressPct: Math.round((earned / total) * 100) || 0 };
  }, [curriculum, masteredKeys]);

  // Actions
  const buildCurriculum = async () => {
    setLoading(true); setLoadingMsg("Synthesizing your STEM learning path...");
    const prompt = `Subject: ${subject}. Level: ${level}. Notes: ${notesText.substring(0, 4000)}. 
    Create a 4-topic curriculum. Return JSON: {"topics": [{"name": "Topic Name", "subtopics": [{"name": "Subtopic Name", "difficulty": 1-5, "estimatedMinutes": 20, "outcomes": ["..."]}]}]}`;
    try {
      const res = await callAI([{ role: "user", content: prompt }], "Return JSON only.");
      setCurriculum(extractJSON(res));
      setScreen("curriculum");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const startSubtopic = async (tIdx, sIdx) => {
    setActivePath({ tIdx, sIdx });
    setPhase("notes");
    setLoading(true); setLoadingMsg("Generating visual guide and bite-sized notes...");
    const st = curriculum.topics[tIdx].subtopics[sIdx];
    try {
      const prompt = `Teach subtopic: ${st.name} in ${subject}. Outcomes: ${st.outcomes.join(", ")}. Use physical examples. Include a Mermaid diagram.`;
      const res = await callAI([{ role: "user", content: prompt }], "Use LaTeX and Mermaid.");
      const diagramMatch = res.match(/```mermaid([\s\S]*?)```/);
      setContent({
        text: res.replace(/```mermaid[\s\S]*?```/g, "").replace(/```[\s\S]*?```/g, ""),
        diagram: diagramMatch ? diagramMatch[1].trim() : null
      });
      setScreen("learn");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const fetchQuestion = async (isHard) => {
    setLoading(true); setLoadingMsg(isHard ? "Generating exam-level challenge..." : "Checking comprehension...");
    const st = curriculum.topics[activePath.tIdx].subtopics[activePath.sIdx];
    const styleContext = pastPaperText ? `MIMIC THIS STYLE: ${pastPaperText.substring(0, 1500)}` : "Standard academic.";
    const prompt = `${styleContext}\n\nGenerate a ${isHard ? "challenging exam" : "simple comprehension"} question for ${st.name}. Return JSON: {"question": "...", "modelAnswer": "...", "hint": "..."}`;
    try {
      const res = await callAI([{ role: "user", content: prompt }], "Return JSON only.");
      setCurrentQ(extractJSON(res));
      setStudentAnswer(""); setFeedback(null);
      setPhase(isHard ? "exam" : "comprehension");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  // UI Components
  const Card = ({ children, onClick, style }) => (
    <div onClick={onClick} style={{ 
      background: COLORS.card, padding: '24px', borderRadius: '20px', 
      border: `1px solid ${COLORS.border}`, boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      cursor: onClick ? 'pointer' : 'default', transition: '0.2s', ...style 
    }}>{children}</div>
  );

  if (screen === "setup") return (
    <div style={fullScreenCenter}>
      <Card style={{ maxWidth: '500px', width: '100%' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '8px' }}>STEM Tutor AI</h1>
        <p style={{ color: COLORS.textMuted, marginBottom: '24px' }}>Upload notes or past papers for a personalized experience.</p>
        <div style={{ display: 'grid', gap: '16px' }}>
          <input type="password" placeholder="Gemini API Key" style={inputStyle} value={apiKey} onChange={e => setApiKey(e.target.value)} />
          <input placeholder="Subject (e.g. Organic Chemistry)" style={inputStyle} value={subject} onChange={e => setSubject(e.target.value)} />
          <select style={inputStyle} value={level} onChange={e => setLevel(e.target.value)}>{LEVELS.map(l => <option key={l}>{l}</option>)}</select>
          <textarea placeholder="Paste Course Notes (Optional)..." style={{...inputStyle, height: '80px'}} value={notesText} onChange={e => setNotesText(e.target.value)} />
          <textarea placeholder="Paste Past Exam Questions (to mimic style)..." style={{...inputStyle, height: '80px'}} value={pastPaperText} onChange={e => setPastPaperText(e.target.value)} />
          <button style={btnStyle} onClick={buildCurriculum} disabled={!apiKey || !subject || loading}>{loading ? "Building..." : "Begin Learning"}</button>
        </div>
      </Card>
    </div>
  );

  if (screen === "curriculum") return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', display: 'flex' }}>
      <aside style={sidebarStyle}>
        <div style={{ fontWeight: '800', fontSize: '18px', color: COLORS.primary, marginBottom: '32px' }}>STEM PATHWAY</div>
        <div style={{ fontSize: '12px', fontWeight: '600', color: COLORS.textMuted, marginBottom: '8px' }}>WEIGHTED MASTERY</div>
        <div style={{ height: '10px', background: COLORS.border, borderRadius: '5px', overflow: 'hidden' }}>
          <div style={{ width: `${progressPct}%`, height: '100%', background: COLORS.primary, transition: '0.8s ease' }} />
        </div>
        <div style={{ fontSize: '28px', fontWeight: '800', marginTop: '12px' }}>{progressPct}%</div>
      </aside>
      <main style={{ marginLeft: '300px', padding: '60px', width: '100%' }}>
        <h2 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '40px' }}>{subject} Curriculum</h2>
        {curriculum.topics.map((topic, tIdx) => (
          <div key={tIdx} style={{ marginBottom: '40px' }}>
            <h3 style={{ fontSize: '14px', textTransform: 'uppercase', color: COLORS.textMuted, marginBottom: '16px' }}>{topic.name}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {topic.subtopics.map((st, sIdx) => (
                <Card key={sIdx} onClick={() => startSubtopic(tIdx, sIdx)} style={{ borderColor: masteredKeys.has(`${tIdx}-${sIdx}`) ? COLORS.success : COLORS.border }}>
                  <div style={{ fontWeight: '700', marginBottom: '4px' }}>{st.name}</div>
                  <div style={{ fontSize: '12px', color: COLORS.textMuted }}>{st.estimatedMinutes}m • Difficulty {st.difficulty}/5</div>
                  {masteredKeys.has(`${tIdx}-${sIdx}`) && <div style={{ marginTop: '12px', color: COLORS.success, fontSize: '12px', fontWeight: '800' }}>✓ MASTERED</div>}
                </Card>
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );

  if (screen === "learn") return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', padding: '60px 20px' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <button onClick={() => setScreen("curriculum")} style={{ marginBottom: '24px', border: 'none', background: 'none', color: COLORS.textMuted, cursor: 'pointer' }}>← Curriculum</button>
        <Card style={{ padding: '48px' }}>
          {phase === "notes" ? (
            <div>
              <h2 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '24px' }}>{curriculum.topics[activePath.tIdx].subtopics[activePath.sIdx].name}</h2>
              {content.diagram && <MermaidRenderer chart={content.diagram} />}
              <MathRenderer text={content.text} />
              <button style={{ ...btnStyle, marginTop: '40px' }} onClick={() => fetchQuestion(false)}>Test Understanding</button>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: '32px' }}>
                <span style={{ background: phase === 'exam' ? COLORS.primary : COLORS.primaryLight, color: phase === 'exam' ? '#fff' : COLORS.primary, padding: '4px 12px', borderRadius: '99px', fontSize: '12px', fontWeight: '800' }}>
                  {phase === 'exam' ? 'EXAM LEVEL' : 'COMPREHENSION'}
                </span>
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '24px' }}><MathRenderer text={currentQ.question} /></h3>
              {!feedback ? (
                <>
                  <p style={{ color: COLORS.textMuted, fontStyle: 'italic', marginBottom: '12px' }}>Hint: {currentQ.hint}</p>
                  <textarea style={{ ...inputStyle, height: '140px' }} value={studentAnswer} onChange={e => setStudentAnswer(e.target.value)} placeholder="Type your answer using first principles..." />
                  <button style={{ ...btnStyle, marginTop: '20px' }} onClick={async () => {
                    setLoading(true);
                    const res = await callAI([{ role: 'user', content: `Question: ${currentQ.question}\nStudent: ${studentAnswer}\nModel: ${currentQ.modelAnswer}` }], "Evaluate answer strictly. Return JSON: {\"correct\": boolean, \"score\": 0-100, \"feedback\": \"...\", \"missedConcept\": \"...\"}");
                    setFeedback(extractJSON(res));
                    setLoading(false);
                  }}>Submit Answer</button>
                </>
              ) : (
                <div>
                  <div style={{ padding: '24px', borderRadius: '16px', background: feedback.correct ? '#f0fdf4' : '#fef2f2', border: `1px solid ${feedback.correct ? COLORS.success : COLORS.danger}`, marginBottom: '24px' }}>
                    <div style={{ fontWeight: '800', color: feedback.correct ? COLORS.success : COLORS.danger, marginBottom: '8px' }}>{feedback.correct ? "✓ CORRECT" : "✗ REVIEW NEEDED"} ({feedback.score}%)</div>
                    <p style={{ margin: 0 }}>{feedback.feedback}</p>
                  </div>
                  <div style={{ marginBottom: '32px', padding: '20px', background: COLORS.bg, borderRadius: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: COLORS.textMuted, marginBottom: '8px' }}>MODEL ANSWER</div>
                    <MathRenderer text={currentQ.modelAnswer} />
                  </div>
                  <button style={btnStyle} onClick={() => {
                    if (feedback.correct && phase === "exam") {
                      setMasteredKeys(new Set(masteredKeys).add(`${activePath.tIdx}-${activePath.sIdx}`));
                      setScreen("curriculum");
                    } else if (feedback.correct) fetchQuestion(true);
                    else fetchQuestion(phase === "exam");
                  }}>{feedback.correct ? (phase === 'exam' ? "Complete Subtopic" : "Move to Exam Level") : "Try Again"}</button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
      {loading && <div style={loaderOverlay}>{loadingMsg}</div>}
    </div>
  );

  return null;
}

// --- Styles ---
const inputStyle = { width: '100%', padding: '14px', borderRadius: '12px', border: `1px solid ${COLORS.border}`, outline: 'none', boxSizing: 'border-box', fontSize: '15px' };
const btnStyle = { width: '100%', padding: '16px', borderRadius: '12px', background: COLORS.primary, color: '#fff', border: 'none', fontWeight: '700', cursor: 'pointer', fontSize: '16px' };
const fullScreenCenter = { minHeight: '100vh', background: COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' };
const sidebarStyle = { width: '300px', borderRight: `1px solid ${COLORS.border}`, padding: '40px 30px', position: 'fixed', height: '100vh', background: '#fff' };
const loaderOverlay = { position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', zIndex: 100, backdropFilter: 'blur(4px)' };
