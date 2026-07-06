import React, { useState, useRef, useEffect, useMemo } from "react";

// --- Configuration ---
// Switched to v1beta to support the 'system_instruction' field properly
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const LEVELS = ["1st Year Undergrad", "Advanced Undergrad", "Masters", "PhD Candidate"];

const THEME = {
  bg: "#0f172a",         
  card: "#1e293b",       
  border: "#334155",     
  text: "#f8fafc",       
  textMuted: "#94a3b8",  
  primary: "#818cf8",    
  success: "#10b981",    
  danger: "#ef4444"      
};

// --- Helper: PDF Text Extraction ---
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Mathematical text extraction: preserve spacing for symbols
    text += content.items.map(s => s.str).join(" ") + " \n ";
  }
  return text;
}

// --- Independent UI Components (Outside to prevent re-render focus issues) ---

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
  return <div ref={containerRef} style={{ lineHeight: 1.8, color: THEME.text }} dangerouslySetInnerHTML={{ __html: text.replace(/\n/g, '<br/>') }} />;
};

const MermaidRenderer = ({ chart }) => {
  const [svg, setSvg] = useState("");
  const id = useMemo(() => `mer-` + Math.random().toString(36).substr(2, 9), []);
  useEffect(() => {
    const render = async () => {
      if (window.mermaid && chart) {
        try {
          window.mermaid.initialize({ theme: 'dark', startOnLoad: false });
          const { svg: renderedSvg } = await window.mermaid.render(id, chart);
          setSvg(renderedSvg);
        } catch (e) { console.error("Mermaid Render Error:", e); }
      }
    };
    render();
  }, [chart, id]);
  return <div style={{ background: '#000', padding: '20px', borderRadius: '12px', border: `1px solid ${THEME.border}`, margin: '20px 0', display: 'flex', justifyContent: 'center', overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: svg }} />;
};

// --- Main App ---

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("stem-api-key") || "");
  const [screen, setScreen] = useState("setup");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState(LEVELS[0]);
  const [notesContent, setNotesContent] = useState("");
  const [examContent, setExamContent] = useState("");
  
  const [curriculum, setCurriculum] = useState(null);
  const [masteredKeys, setMasteredKeys] = useState(new Set());
  const [activePath, setActivePath] = useState({ tIdx: 0, sIdx: 0 });
  const [phase, setPhase] = useState("notes");
  const [sessionData, setSessionData] = useState({ notes: "", diagram: "", question: null });
  const [studentAnswer, setStudentAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);

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

    const timer = setInterval(() => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        clearInterval(timer);
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const callAI = async (messages, sys) => {
    const res = await fetch(`${API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: "You are a world-class STEM Tutor. RULES: 1. Convert messy PDF text into clean LaTeX math ($..$ and $$..$$). 2. Use Mermaid flowcharts. 3. Use real-world physical analogies. 4. Avoid jargon. " + sys }] },
        contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.15 }
      })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    return d.candidates[0].content.parts[0].text;
  };

  const handlePdfUpload = async (e, type) => {
    setLoading(true);
    setLoadingMsg(`Processing ${type} PDFs...`);
    let combined = "";
    for (let file of e.target.files) {
      try {
        const text = await extractTextFromPDF(file);
        combined += `\n[SOURCE FILE: ${file.name}]\n${text}\n`;
      } catch (err) { console.error(err); }
    }
    if (type === "Notes") setNotesContent(combined);
    else setExamContent(combined);
    setLoading(false);
  };

  const buildCurriculum = async () => {
    if (!apiKey || !subject) return;
    setLoading(true); setLoadingMsg("Designing your curriculum path...");
    try {
      localStorage.setItem("stem-api-key", apiKey);
      const prompt = `Subject: ${subject}. Level: ${level}. Student Notes provided: ${notesContent.substring(0, 10000)}. 
      Return JSON only: {"topics": [{"name": "Topic Name", "subtopics": [{"name": "Subtopic Name", "difficulty": 3, "estimatedMinutes": 20, "outcomes": ["..."]}]}]}`;
      const res = await callAI([{ role: "user", content: prompt }], "Output JSON only.");
      const jsonStr = res.match(/\{[\s\S]*\}/)[0];
      setCurriculum(JSON.parse(jsonStr));
      setScreen("curriculum");
    } catch (e) { alert("Error building course: " + e.message); }
    setLoading(false);
  };

  const inputStyle = { width: '100%', padding: '14px', borderRadius: '12px', border: `1px solid ${THEME.border}`, background: '#0f172a', color: THEME.text, marginBottom: '20px', fontSize: '15px', boxSizing: 'border-box' };
  const cardStyle = { background: THEME.card, border: `1px solid ${THEME.border}`, padding: '25px', borderRadius: '20px' };
  const btnStyle = { width: '100%', padding: '14px', borderRadius: '12px', background: THEME.primary, color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '16px' };

  if (screen === "setup") return (
    <div style={{ minHeight: '100vh', background: THEME.bg, color: THEME.text, padding: '40px 20px', fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: 500, margin: '0 auto', ...cardStyle }}>
        <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>STEM Tutor AI</h2>
        <p style={{ color: THEME.textMuted, fontSize: '14px', marginBottom: '30px' }}>Your personalized academic study partner.</p>
        
        <div style={{ background: '#1e1b4b', padding: '15px', borderRadius: '12px', marginBottom: '25px', border: '1px solid #312e81' }}>
          <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: THEME.primary }}>🔑 API Key Setup:</h4>
          <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: THEME.textMuted, lineHeight: '1.6' }}>
            <li>Visit <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" style={{ color: THEME.primary }}>Google AI Studio</a>.</li>
            <li>Click <strong>"Get API Key"</strong>.</li>
            <li>Paste your key below. (Standard usage is free).</li>
          </ol>
        </div>

        <input type="password" placeholder="Gemini API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} style={inputStyle} />
        <input placeholder="Subject / Module Title" value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} />
        
        <label style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', display: 'block' }}>Upload Study Notes (PDF)</label>
        <input type="file" multiple accept=".pdf" onChange={(e) => handlePdfUpload(e, "Notes")} style={{ ...inputStyle, padding: '10px' }} />

        <label style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', display: 'block' }}>Upload Past Exam Papers (PDF)</label>
        <input type="file" multiple accept=".pdf" onChange={(e) => handlePdfUpload(e, "Exams")} style={{ ...inputStyle, padding: '10px' }} />

        <button onClick={buildCurriculum} disabled={loading || !subject} style={btnStyle}>
          {loading ? "Designing..." : "Create Course"}
        </button>
      </div>
    </div>
  );

  if (screen === "curriculum") return (
    <div style={{ minHeight: '100vh', background: THEME.bg, color: THEME.text, padding: '60px 20px', fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
          <h1>{subject}</h1>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: THEME.primary }}>
              {Math.round((masteredKeys.size / curriculum.topics.reduce((a,t)=>a+t.subtopics.length,0)) * 100)}%
            </div>
            <div style={{ fontSize: '12px', color: THEME.textMuted }}>MASTERY</div>
          </div>
        </div>

        {curriculum.topics.map((topic, tIdx) => (
          <div key={tIdx} style={{ marginBottom: '40px' }}>
            <h3 style={{ fontSize: '13px', textTransform: 'uppercase', color: THEME.textMuted, marginBottom: '20px', letterSpacing: '1.5px' }}>{topic.name}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {topic.subtopics.map((st, sIdx) => (
                <div key={sIdx} onClick={async () => {
                  setLoading(true);
                  const prompt = `Topic: ${st.name}. Study context: ${notesContent.substring(0, 6000)}. 
                  Explain concisely. Use physical analogies. Include 1 Mermaid diagram. Use LaTeX.`;
                  try {
                    const res = await callAI([{ role: 'user', content: prompt }], "Use LaTeX and Mermaid.");
                    const diag = res.match(/```mermaid([\s\S]*?)```/);
                    setSessionData({ 
                      notes: res.replace(/```mermaid[\s\S]*?```/g, "").replace(/```[\s\S]*?```/g, ""), 
                      diagram: diag ? diag[1].trim() : null 
                    });
                    setActivePath({ tIdx, sIdx }); setPhase("notes"); setScreen("learn");
                  } catch(e) { alert(e.message); }
                  setLoading(false);
                }} style={{ 
                  ...cardStyle, padding: '20px', cursor: 'pointer', 
                  borderColor: masteredKeys.has(`${tIdx}-${sIdx}`) ? THEME.success : THEME.border 
                }}>
                  <div style={{ fontWeight: 'bold' }}>{st.name}</div>
                  <div style={{ fontSize: '12px', color: THEME.textMuted, marginTop: '5px' }}>{st.estimatedMinutes} mins • Difficulty {st.difficulty}</div>
                  {masteredKeys.has(`${tIdx}-${sIdx}`) && <div style={{ color: THEME.success, fontSize: '11px', fontWeight: 'bold', marginTop: '10px' }}>✓ COMPLETE</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (screen === "learn") return (
    <div style={{ minHeight: '100vh', background: THEME.bg, color: THEME.text, padding: '40px 20px', fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <button onClick={() => setScreen("curriculum")} style={{ background: 'none', border: 'none', color: THEME.textMuted, cursor: 'pointer', marginBottom: '20px' }}>← Back to Curriculum</button>
        <div style={cardStyle}>
          {phase === "notes" ? (
            <div>
              <h2 style={{ marginBottom: '25px', color: THEME.primary }}>{curriculum.topics[activePath.tIdx].subtopics[activePath.sIdx].name}</h2>
              {sessionData.diagram && <MermaidRenderer chart={sessionData.diagram} />}
              <MathRenderer text={sessionData.notes} />
              <button style={{ ...btnStyle, marginTop: '40px' }} onClick={async () => {
                setLoading(true);
                const style = examContent ? `MIMIC EXAM STYLE: ${examContent.substring(0, 4000)}` : "";
                const prompt = `${style}\nGenerate a question for ${curriculum.topics[activePath.tIdx].subtopics[activePath.sIdx].name}. Return JSON only: {"question":"...","modelAnswer":"...","hint":"..."}`;
                try {
                  const res = await callAI([{ role: 'user', content: prompt }], "Return JSON only.");
                  const jsonStr = res.match(/\{[\s\S]*\}/)[0];
                  setSessionData(prev => ({ ...prev, question: JSON.parse(jsonStr) }));
                  setPhase("question");
                } catch(e) { alert(e.message); }
                setLoading(false);
              }}>Start Quiz</button>
            </div>
          ) : (
            <div>
              <h3 style={{ marginBottom: '30px' }}><MathRenderer text={sessionData.question.question} /></h3>
              <textarea value={studentAnswer} onChange={e => setStudentAnswer(e.target.value)} placeholder="Type your answer here..." style={{ ...inputStyle, height: '140px', resize: 'vertical' }} />
              {!feedback ? (
                <button style={btnStyle} onClick={async () => {
                  setLoading(true);
                  const p = `Q: ${sessionData.question.question}\nStudent: ${studentAnswer}\nModel: ${sessionData.question.modelAnswer}`;
                  try {
                    const res = await callAI([{ role: "user", content: p }], "Grade strictly. Return JSON: {\"correct\":boolean, \"feedback\":\"...\"}");
                    setFeedback(JSON.parse(res.match(/\{[\s\S]*\}/)[0]));
                  } catch(e) { alert(e.message); }
                  setLoading(false);
                }}>Submit Answer</button>
              ) : (
                <div style={{ marginTop: '30px', padding: '25px', borderRadius: '15px', background: feedback.correct ? '#064e3b' : '#450a0a', border: `1px solid ${feedback.correct ? THEME.success : THEME.danger}` }}>
                  <div style={{ fontWeight: 'bold', fontSize: '18px', color: feedback.correct ? '#10b981' : '#f87171', marginBottom: '10px' }}>{feedback.correct ? "Correct!" : "Not Quite"}</div>
                  <p>{feedback.feedback}</p>
                  <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(0,0,0,0.2)', borderRadius: '10px' }}>
                    <div style={{ fontSize: '11px', color: THEME.textMuted, marginBottom: '5px' }}>REFERENCE ANSWER:</div>
                    <MathRenderer text={sessionData.question.modelAnswer} />
                  </div>
                  <button style={{ ...btnStyle, marginTop: '20px', background: '#fff', color: '#000' }} onClick={() => {
                    if (feedback.correct) {
                      setMasteredKeys(new Set(masteredKeys).add(`${activePath.tIdx}-${activePath.sIdx}`));
                      setScreen("curriculum");
                    } else {
                      setFeedback(null);
                      setPhase("notes"); 
                    }
                  }}>{feedback.correct ? "Continue" : "Back to Notes"}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {loading && <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div style={{ width: '40px', height: '40px', border: `3px solid ${THEME.border}`, borderTopColor: THEME.primary, borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '20px' }} />
        <div style={{ fontWeight: 'bold' }}>{loadingMsg}</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>}
    </div>
  );

  return null;
}
