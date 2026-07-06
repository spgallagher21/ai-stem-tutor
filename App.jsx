import React, { useState, useRef, useEffect, useMemo } from "react";

// --- Configuration ---
const API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

const THEME = {
  bg: "#0f172a",         
  card: "#1e293b",       
  border: "#334155",     
  text: "#f8fafc",       
  textMuted: "#94a3b8",  
  primary: "#818cf8",    
  success: "#10b981",    
  danger: "#ef4444",
  accent: "#4f46e5"
};

// --- Utilities ---

function robustParseJSON(rawStr) {
  try {
    return JSON.parse(rawStr);
  } catch (e) {
    const jsonMatch = rawStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } 
      catch (e2) { throw new Error("AI JSON Error"); }
    }
    throw new Error("Invalid AI Response Structure");
  }
}

async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  // Using window. prefix to pass build checks
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(s => s.str).join(" ") + " \n ";
  }
  return text;
}

// --- Independent UI Components ---

const MathRenderer = ({ text }) => {
  const containerRef = useRef();
  useEffect(() => {
    // Using window. prefix to pass build checks
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
    const renderChart = async () => {
      // Using window. prefix to pass build checks
      if (window.mermaid && chart) {
        try {
          window.mermaid.initialize({ theme: 'dark', startOnLoad: false });
          const { svg: renderedSvg } = await window.mermaid.render(id, chart);
          setSvg(renderedSvg);
        } catch (e) { console.error(e); }
      }
    };
    renderChart();
  }, [chart, id]);
  return <div style={{ background: '#000', padding: '20px', borderRadius: '12px', border: `1px solid ${THEME.border}`, margin: '20px 0', display: 'flex', justifyContent: 'center', overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: svg }} />;
};

// --- Main App ---

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("stem-api-key") || "");
  const [subject, setSubject] = useState(() => localStorage.getItem("stem-subject") || "");
  const [curriculum, setCurriculum] = useState(() => {
    const saved = localStorage.getItem("stem-curriculum");
    return saved ? JSON.parse(saved) : null;
  });
  const [masteredKeys, setMasteredKeys] = useState(() => {
    const saved = localStorage.getItem("stem-mastery");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [notesContent, setNotesContent] = useState("");
  const [examContent, setExamContent] = useState("");

  const [screen, setScreen] = useState(curriculum ? "curriculum" : "setup");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [activePath, setActivePath] = useState({ tIdx: 0, sIdx: 0 });
  const [phase, setPhase] = useState("notes");
  const [sessionData, setSessionData] = useState({ notes: "", diagram: "", question: null });
  const [studentAnswer, setStudentAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    localStorage.setItem("stem-api-key", apiKey);
    localStorage.setItem("stem-subject", subject);
    if (curriculum) localStorage.setItem("stem-curriculum", JSON.stringify(curriculum));
    localStorage.setItem("stem-mastery", JSON.stringify(Array.from(masteredKeys)));
  }, [apiKey, subject, curriculum, masteredKeys]);

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

  const callAI = async (messages, tutorInstruction) => {
    const promptPrefix = `ACT AS A STEM TUTOR. RULES: 1. Use LaTeX ($). 2. Use Mermaid. 3. Physical analogies. 4. ${tutorInstruction}\n\nUSER: `;
    const contents = messages.map((m, i) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: i === 0 ? promptPrefix + m.content : m.content }]
    }));

    const res = await fetch(`${API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, generationConfig: { temperature: 0.2 } })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    return d.candidates[0].content.parts[0].text;
  };

  const handleFileUpload = async (e, type) => {
    setLoading(true);
    setLoadingMsg(`Analyzing ${type}...`);
    let combined = "";
    for (let file of Array.from(e.target.files)) {
      const text = await extractTextFromPDF(file);
      combined += `\n[FILE: ${file.name}]\n${text}\n`;
    }
    type === "Notes" ? setNotesContent(combined) : setExamContent(combined);
    setLoading(false);
  };

  const buildCurriculum = async () => {
    setLoading(true); setLoadingMsg("Building Path...");
    try {
      const res = await callAI([{ role: "user", content: `Subject: ${subject}. Notes: ${notesContent.substring(0, 10000)}. Return JSON ONLY: {"topics": [{"name": "Topic", "subtopics": [{"name": "Subtopic", "difficulty": 3, "estimatedMinutes": 20}]}]}` }], "Return JSON.");
      setCurriculum(robustParseJSON(res));
      setScreen("curriculum");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const handleStartSubtopic = async (tIdx, sIdx) => {
    setLoading(true); setLoadingMsg("Loading Lesson...");
    const st = curriculum.topics[tIdx].subtopics[sIdx];
    try {
      const res = await callAI([{ role: "user", content: `Explain "${st.name}" using: ${notesContent.substring(0, 5000)}` }], "Use LaTeX and Mermaid.");
      const diagMatch = res.match(/```mermaid([\s\S]*?)```/);
      setSessionData({
        notes: res.replace(/```mermaid[\s\S]*?```/g, "").replace(/```[\s\S]*?```/g, ""),
        diagram: diagMatch ? diagMatch[1].trim() : null,
        question: null
      });
      setActivePath({ tIdx, sIdx }); setPhase("notes"); setScreen("learn");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const handleFetchQuestion = async (isExam) => {
    setLoading(true); setLoadingMsg("Creating Practice...");
    const st = curriculum.topics[activePath.tIdx].subtopics[activePath.sIdx];
    const style = examContent ? `Mimic style: ${examContent.substring(0, 4000)}` : "";
    try {
      const res = await callAI([{ role: "user", content: `${style}\nGenerate ${isExam ? "exam" : "check"} question for ${st.name}. JSON: {"question":"...","modelAnswer":"...","hint":"..."}` }], "Return JSON.");
      setSessionData(prev => ({ ...prev, question: robustParseJSON(res) }));
      setStudentAnswer(""); setFeedback(null); setPhase("question");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const inputStyle = { width: '100%', padding: '14px', borderRadius: '12px', border: `1px solid ${THEME.border}`, background: THEME.bg, color: THEME.text, marginBottom: '20px', boxSizing: 'border-box' };
  const cardStyle = { background: THEME.card, border: `1px solid ${THEME.border}`, padding: '25px', borderRadius: '20px' };
  const btnStyle = { width: '100%', padding: '14px', borderRadius: '12px', background: THEME.primary, color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' };

  if (screen === "setup") return (
    <div style={{ minHeight: '100vh', background: THEME.bg, color: THEME.text, padding: '40px 20px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 500, margin: '0 auto', ...cardStyle }}>
        <h2 style={{ marginBottom: '10px' }}>STEM Tutor AI</h2>
        <input type="password" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} style={inputStyle} />
        <input placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} />
        <label style={{ fontSize: '12px', color: THEME.textMuted }}>Upload Notes (PDF)</label>
        <input type="file" multiple accept=".pdf" onChange={(e) => handlePdfUpload(e, "Notes")} style={{ ...inputStyle, padding: '10px' }} />
        <label style={{ fontSize: '12px', color: THEME.textMuted }}>Upload Past Papers (PDF)</label>
        <input type="file" multiple accept=".pdf" onChange={(e) => handlePdfUpload(e, "Exams")} style={{ ...inputStyle, padding: '10px' }} />
        <button onClick={buildCurriculum} disabled={loading || !subject} style={btnStyle}>Create Course</button>
      </div>
    </div>
  );

  if (screen === "curriculum") return (
    <div style={{ minHeight: '100vh', background: THEME.bg, color: THEME.text, padding: '60px 20px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
          <h1>{subject}</h1>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: THEME.primary }}>{Math.round((masteredKeys.size / curriculum.topics.reduce((a,t)=>a+t.subtopics.length,0)) * 100)}%</div>
        </div>
        {curriculum.topics.map((topic, tIdx) => (
          <div key={tIdx} style={{ marginBottom: '40px' }}>
            <h3 style={{ fontSize: '13px', color: THEME.textMuted, textTransform: 'uppercase' }}>{topic.name}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' }}>
              {topic.subtopics.map((st, sIdx) => (
                <div key={sIdx} onClick={() => handleStartSubtopic(tIdx, sIdx)} style={{ ...cardStyle, padding: '20px', cursor: 'pointer', border: `1px solid ${masteredKeys.has(`${tIdx}-${sIdx}`) ? THEME.success : THEME.border}` }}>
                  {st.name}
                </div>
              ))}
            </div>
          </div>
        ))}
        <button onClick={() => { localStorage.clear(); window.location.reload(); }} style={{ background: 'none', border: 'none', color: THEME.danger, cursor: 'pointer', marginTop: '20px' }}>Reset</button>
      </div>
    </div>
  );

  if (screen === "learn") return (
    <div style={{ minHeight: '100vh', background: THEME.bg, color: THEME.text, padding: '40px 20px' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <button onClick={() => setScreen("curriculum")} style={{ background: 'none', border: 'none', color: THEME.textMuted, cursor: 'pointer', marginBottom: '20px' }}>← Back</button>
        <div style={cardStyle}>
          {phase === "notes" ? (
            <div>
              <h2 style={{ color: THEME.primary }}>{curriculum.topics[activePath.tIdx].subtopics[activePath.sIdx].name}</h2>
              {sessionData.diagram && <MermaidRenderer chart={sessionData.diagram} />}
              <MathRenderer text={sessionData.notes} />
              <button style={{ ...btnStyle, marginTop: '30px' }} onClick={() => handleFetchQuestion(false)}>Test Understanding</button>
            </div>
          ) : (
            <div>
              <h3><MathRenderer text={sessionData.question.question} /></h3>
              <textarea value={studentAnswer} onChange={e => setStudentAnswer(e.target.value)} style={{ ...inputStyle, height: '140px' }} placeholder="Your answer..." />
              {!feedback ? (
                <button style={btnStyle} onClick={async () => {
                  setLoading(true);
                  const res = await callAI([{ role: "user", content: `Q: ${sessionData.question.question}\nA: ${studentAnswer}\nCorrect: ${sessionData.question.modelAnswer}` }], "Grade strictly. JSON: {\"correct\":boolean, \"feedback\":\"...\"}");
                  setFeedback(robustParseJSON(res));
                  setLoading(false);
                }}>Submit</button>
              ) : (
                <div style={{ marginTop: '20px', padding: '20px', borderRadius: '15px', background: feedback.correct ? '#064e3b' : '#450a0a' }}>
                  <p>{feedback.feedback}</p>
                  <button style={{ ...btnStyle, marginTop: '15px', background: '#fff', color: '#000' }} onClick={() => {
                    if (feedback.correct) {
                      setMasteredKeys(new Set(masteredKeys).add(`${activePath.tIdx}-${activePath.sIdx}`));
                      setScreen("curriculum");
                    } else { setFeedback(null); setPhase("notes"); }
                  }}>Continue</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {loading && <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>{loadingMsg}</div>}
    </div>
  );

  return null;
}
