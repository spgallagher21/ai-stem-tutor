import React, { useState, useRef, useEffect, useMemo } from "react";

// --- Configuration ---
// We switched to 1.5-flash because it has a more stable free-tier quota
const GEMINI_MODEL = "gemini-1.5-flash"; 
const LEVELS = ["1st Year Undergrad", "Advanced Undergrad", "Masters", "PhD Candidate"];

const COLORS = {
  primary: "#6366f1",
  success: "#10b981",
  danger: "#ef4444",
  bg: "#f8fafc",
  card: "#ffffff",
  text: "#0f172a",
  textMuted: "#64748b",
  border: "#e2e8f0"
};

// --- Helper: Extract Text from PDF ---
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(s => s.str).join(" ") + "\n";
  }
  return text;
}

// --- Outside Components (Fixes the Focus/Typing Bug) ---
const MathRenderer = ({ text }) => {
  const containerRef = useRef();
  useEffect(() => {
    if (window.renderMathInElement && containerRef.current) {
      window.renderMathInElement(containerRef.current, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false }
        ],
        throwOnError: false
      });
    }
  }, [text]);
  return <div ref={containerRef} dangerouslySetInnerHTML={{ __html: text.replace(/\n/g, '<br/>') }} />;
};

const MermaidRenderer = ({ chart }) => {
  const [svg, setSvg] = useState("");
  const id = useMemo(() => `mer-` + Math.random().toString(36).substr(2, 9), []);
  useEffect(() => {
    const render = async () => {
      if (window.mermaid && chart) {
        try {
          const { svg: renderedSvg } = await window.mermaid.render(id, chart);
          setSvg(renderedSvg);
        } catch (e) { console.error(e); }
      }
    };
    render();
  }, [chart, id]);
  return <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: `1px solid ${COLORS.border}`, margin: '20px 0', display: 'flex', justifyContent: 'center' }} dangerouslySetInnerHTML={{ __html: svg }} />;
};

// --- Main App ---
export default function STEM_Tutor_App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("stem-api-key") || "");
  const [screen, setScreen] = useState("setup");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState(LEVELS[0]);
  const [pdfTexts, setPdfTexts] = useState(""); // Combined text from all PDFs
  const [pastPaperText, setPastPaperText] = useState("");
  
  const [curriculum, setCurriculum] = useState(null);
  const [masteredKeys, setMasteredKeys] = useState(new Set());
  const [activePath, setActivePath] = useState({ tIdx: 0, sIdx: 0 });
  const [phase, setPhase] = useState("notes");
  const [sessionData, setSessionData] = useState({ notes: "", diagram: "", question: null });
  const [studentAnswer, setStudentAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);

  // Load PDF.js and others
  useEffect(() => {
    const scripts = [
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      "https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js",
      "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
      "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
    ];
    scripts.forEach(src => {
      const s = document.createElement("script"); s.src = src; s.async = false; document.head.appendChild(s);
    });
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
    document.head.appendChild(link);

    // Initialize PDF.js worker
    setTimeout(() => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }
    }, 1000);
  }, []);

  const callAI = async (messages, sys) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: "You are a STEM Tutor. Use LaTeX for math. Use Mermaid for diagrams. Avoid jargon. " + sys }] },
        contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.2 }
      })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    return d.candidates[0].content.parts[0].text;
  };

  const handleFileUpload = async (e) => {
    setLoading(true);
    setLoadingMsg("Reading your PDF files...");
    let combined = "";
    for (let file of e.target.files) {
      try {
        const text = await extractTextFromPDF(file);
        combined += `\n--- SOURCE: ${file.name} ---\n${text}`;
      } catch (err) { console.error(err); }
    }
    setPdfTexts(combined);
    setLoading(false);
  };

  const buildCurriculum = async () => {
    setLoading(true); setLoadingMsg("Designing Curriculum...");
    try {
      localStorage.setItem("stem-api-key", apiKey);
      const prompt = `Subject: ${subject}. Level: ${level}. Context: ${pdfTexts.substring(0, 15000)}. 
      Return JSON only: {"topics": [{"name": "Topic", "subtopics": [{"name": "Subtopic", "difficulty": 3, "estimatedMinutes": 20, "outcomes": ["..."]}]}]}`;
      const res = await callAI([{ role: "user", content: prompt }], "Output JSON only.");
      const json = JSON.parse(res.replace(/```json|```/g, ""));
      setCurriculum(json);
      setScreen("curriculum");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  // UI Styles
  const inputStyle = { width: '100%', padding: '12px', borderRadius: '8px', border: `1px solid ${COLORS.border}`, marginBottom: '15px' };
  const btnStyle = { width: '100%', padding: '12px', borderRadius: '8px', background: COLORS.primary, color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' };

  if (screen === "setup") return (
    <div style={{ maxWidth: 500, margin: '100px auto', padding: 20, background: '#fff', borderRadius: 20, boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
      <h2 style={{ marginBottom: 20 }}>STEM Tutor Setup</h2>
      <input type="password" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} style={inputStyle} />
      <input placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} />
      
      <label style={{ fontSize: 13, color: COLORS.textMuted, display: 'block', marginBottom: 5 }}>Upload Lecture PDFs</label>
      <input type="file" multiple accept=".pdf" onChange={handleFileUpload} style={inputStyle} />
      
      <textarea placeholder="Paste Past Papers (Optional)" value={pastPaperText} onChange={e => setPastPaperText(e.target.value)} style={{ ...inputStyle, height: 80 }} />
      <button onClick={buildCurriculum} style={btnStyle} disabled={loading || !subject}>{loading ? "Processing..." : "Start Learning"}</button>
    </div>
  );

  if (screen === "curriculum") return (
    <div style={{ padding: 40, maxWidth: 900, margin: '0 auto' }}>
      <h1>{subject} Path</h1>
      {curriculum.topics.map((topic, tIdx) => (
        <div key={tIdx} style={{ marginBottom: 30 }}>
          <h3 style={{ color: COLORS.textMuted }}>{topic.name}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
            {topic.subtopics.map((st, sIdx) => (
              <div key={sIdx} onClick={async () => {
                setLoading(true);
                const p = `Teach ${st.name} from ${subject}. Context: ${pdfTexts.substring(0, 5000)}. Use Mermaid for one diagram.`;
                const res = await callAI([{role:'user', content:p}], "Use LaTeX and Mermaid.");
                const diag = res.match(/```mermaid([\s\S]*?)```/);
                setSessionData({ notes: res.replace(/```mermaid[\s\S]*?```/g, ""), diagram: diag ? diag[1] : null });
                setActivePath({tIdx, sIdx}); setPhase("notes"); setScreen("learn");
                setLoading(false);
              }} style={{ padding: 20, background: '#fff', borderRadius: 12, border: `1px solid ${COLORS.border}`, cursor: 'pointer' }}>
                {st.name}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  if (screen === "learn") return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 20 }}>
      <button onClick={() => setScreen("curriculum")}>← Back</button>
      <div style={{ background: '#fff', padding: 40, borderRadius: 20, marginTop: 20 }}>
        {phase === "notes" ? (
          <>
            {sessionData.diagram && <MermaidRenderer chart={sessionData.diagram} />}
            <MathRenderer text={sessionData.notes} />
            <button style={{ ...btnStyle, marginTop: 20 }} onClick={async () => {
                setLoading(true);
                const p = `Generate a question for ${curriculum.topics[activePath.tIdx].subtopics[activePath.sIdx].name}. Return JSON: {"question":"...","modelAnswer":"...","hint":"..."}`;
                const res = await callAI([{role:'user', content:p}], "Return JSON only.");
                setSessionData(prev => ({...prev, question: JSON.parse(res.replace(/```json|```/g, ""))}));
                setPhase("question"); setLoading(false);
            }}>Take Practice Test</button>
          </>
        ) : (
          <div>
            <h3><MathRenderer text={sessionData.question.question} /></h3>
            <textarea value={studentAnswer} onChange={e => setStudentAnswer(e.target.value)} style={{...inputStyle, height: 100}} />
            <button style={btnStyle} onClick={async () => {
                setLoading(true);
                const res = await callAI([{role:'user', content: `Q: ${sessionData.question.question}\nA: ${studentAnswer}\nCorrect Answer: ${sessionData.question.modelAnswer}`}], "Grade strictly. Return JSON: {\"correct\":boolean, \"feedback\":\"...\"}");
                setFeedback(JSON.parse(res.replace(/```json|```/g, "")));
                setLoading(false);
            }}>Submit</button>
            {feedback && (
                <div style={{marginTop:20, padding:20, background: feedback.correct ? '#f0fdf4' : '#fef2f2', borderRadius:10}}>
                    {feedback.correct ? "✓ Correct!" : "✗ Try Again"}
                    <p>{feedback.feedback}</p>
                    <button onClick={() => setScreen("curriculum")}>Continue</button>
                </div>
            )}
          </div>
        )}
      </div>
      {loading && <div style={{ position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{loadingMsg}</div>}
    </div>
  );

  return null;
}
