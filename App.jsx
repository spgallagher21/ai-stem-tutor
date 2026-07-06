import React, { useState, useRef, useEffect, useMemo } from "react";

// --- Configuration ---
// v1beta is required for the most reliable 'system_instruction' support on Flash 1.5
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

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

// --- Robust Utilities ---

/** 
 * Scans AI output for JSON patterns. 
 * Prevents crashes when AI includes conversational filler.
 */
function robustParseJSON(rawStr) {
  try {
    // 1. Try direct parse
    return JSON.parse(rawStr);
  } catch (e) {
    // 2. Try to extract JSON block using Regex
    const jsonMatch = rawStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        throw new Error("AI returned malformed data. Please try that action again.");
      }
    }
    throw new Error("AI failed to provide a structured response.");
  }
}

async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(s => s.str).join(" ") + " \n ";
  }
  return text;
}

// --- Independent UI Components (Zero-Re-render Logic) ---

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
  return <div ref={containerRef} style={{ lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: text.replace(/\n/g, '<br/>') }} />;
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
        } catch (e) { console.error("Mermaid error:", e); }
      }
    };
    render();
  }, [chart, id]);
  return <div style={{ background: '#000', padding: '20px', borderRadius: '12px', border: `1px solid ${THEME.border}`, margin: '20px 0', display: 'flex', justifyContent: 'center', overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: svg }} />;
};

// --- Main Application ---

export default function App() {
  // --- Persistent State ---
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
  const [notesContent, setNotesContent] = useState(() => localStorage.getItem("stem-notes") || "");
  const [examContent, setExamContent] = useState(() => localStorage.getItem("stem-exams") || "");

  // --- Session State ---
  const [screen, setScreen] = useState(curriculum ? "curriculum" : "setup");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [activePath, setActivePath] = useState({ tIdx: 0, sIdx: 0 });
  const [phase, setPhase] = useState("notes"); // notes, question
  const [sessionData, setSessionData] = useState({ notes: "", diagram: "", question: null });
  const [studentAnswer, setStudentAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);

  // --- Auto-Save Effect ---
  useEffect(() => {
    localStorage.setItem("stem-api-key", apiKey);
    localStorage.setItem("stem-subject", subject);
    localStorage.setItem("stem-notes", notesContent);
    localStorage.setItem("stem-exams", examContent);
    if (curriculum) localStorage.setItem("stem-curriculum", JSON.stringify(curriculum));
    localStorage.setItem("stem-mastery", JSON.stringify(Array.from(masteredKeys)));
  }, [apiKey, subject, curriculum, masteredKeys, notesContent, examContent]);

  // --- Script Loader ---
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

  // --- Core API Caller ---
  const callAI = async (messages, sysInstruction) => {
    if (!apiKey) throw new Error("API Key is missing.");

    const response = await fetch(`${API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { 
          parts: [{ text: `You are a world-class STEM Tutor. 
            RULES:
            1. Convert messy PDF text into clean LaTeX ($..$ for inline, $$..$$ for blocks).
            2. Always include a Mermaid.js diagram for new concepts.
            3. Use physical analogies. Avoid jargon.
            4. STRICT: If asked for JSON, return ONLY the JSON object. No prose.
            ${sysInstruction}` }] 
        },
        contents: messages.map(m => ({ 
          role: m.role === "assistant" ? "model" : "user", 
          parts: [{ text: m.content }] 
        })),
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
      })
    });

    const data = await response.json();
    if (data.error) {
      if (data.error.status === "RESOURCE_EXHAUSTED") throw new Error("API Rate limit hit. Wait 30s.");
      throw new Error(data.error.message);
    }
    return data.candidates[0].content.parts[0].text;
  };

  // --- Handlers ---

  const handlePdfUpload = async (e, type) => {
    setLoading(true);
    setLoadingMsg(`Analyzing ${type} Content...`);
    let combined = "";
    for (let file of Array.from(e.target.files)) {
      try {
        const text = await extractTextFromPDF(file);
        combined += `\n[FILE: ${file.name}]\n${text}\n`;
      } catch (err) { alert(`Error in ${file.name}`); }
    }
    type === "Notes" ? setNotesContent(combined) : setExamContent(combined);
    setLoading(false);
  };

  const handleBuildCurriculum = async () => {
    setLoading(true); setLoadingMsg("Designing Curriculum...");
    try {
      const prompt = `Subject: ${subject}. Content: ${notesContent.substring(0, 15000)}. 
      Generate a 4-topic curriculum. 
      Return JSON ONLY: {"topics": [{"name": "Topic", "subtopics": [{"name": "Subtopic", "difficulty": 3, "estimatedMinutes": 20}]}]}`;
      const res = await callAI([{ role: "user", content: prompt }], "Return JSON.");
      setCurriculum(robustParseJSON(res));
      setScreen("curriculum");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const handleStartSubtopic = async (tIdx, sIdx) => {
    setLoading(true); setLoadingMsg("Generating Study Material...");
    const st = curriculum.topics[tIdx].subtopics[sIdx];
    try {
      const prompt = `Teach "${st.name}" using these notes: ${notesContent.substring(0, 5000)}. 
      Include physical analogies, LaTeX math, and one Mermaid diagram.`;
      const res = await callAI([{ role: "user", content: prompt }], "Use LaTeX/Mermaid.");
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
    setLoading(true); setLoadingMsg("Simulating Question...");
    const st = curriculum.topics[activePath.tIdx].subtopics[activePath.sIdx];
    const style = examContent ? `Style to mimic: ${examContent.substring(0, 4000)}` : "";
    try {
      const prompt = `${style}\nGenerate a ${isExam ? "hard exam" : "comprehension"} question for ${st.name}. 
      Return JSON ONLY: {"question":"...","modelAnswer":"...","hint":"..."}`;
      const res = await callAI([{ role: "user", content: prompt }], "Return JSON.");
      setSessionData(prev => ({ ...prev, question: robustParseJSON(res) }));
      setStudentAnswer(""); setFeedback(null); setPhase("question");
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const handleReset = () => {
    if (confirm("Reset everything? All PDFs and progress will be cleared.")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  // --- UI Layouts ---

  const inputStyle = { width: '100%', padding: '14px', borderRadius: '12px', border: `1px solid ${THEME.border}`, background: '#0f172a', color: THEME.text, marginBottom: '20px', fontSize: '15px', boxSizing: 'border-box' };
  const cardStyle = { background: THEME.card, border: `1px solid ${THEME.border}`, padding: '25px', borderRadius: '20px' };
  const btnStyle = { width: '100%', padding: '14px', borderRadius: '12px', background: THEME.primary, color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '16px' };

  if (screen === "setup") return (
    <div style={{ minHeight: '100vh', background: THEME.bg, color: THEME.text, padding: '40px 20px', fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: 500, margin: '0 auto', ...cardStyle }}>
        <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>STEM Tutor AI</h2>
        <p style={{ color: THEME.textMuted, fontSize: '14px', marginBottom: '30px' }}>Upload PDFs to generate your path.</p>
        
        <div style={{ background: '#1e1b4b', padding: '15px', borderRadius: '12px', marginBottom: '25px', border: '1px solid #312e81', fontSize: '12px' }}>
          <span style={{ color: THEME.primary, fontWeight: 'bold' }}>🔑 Setup API:</span> 
          <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" style={{ color: THEME.primary, marginLeft: '5px' }}>Get Key</a>
        </div>

        <input type="password" placeholder="Gemini API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} style={inputStyle} />
        <input placeholder="Subject (e.g. Fluids)" value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} />
        
        <label style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', display: 'block' }}>Lecture Notes (PDF)</label>
        <input type="file" multiple accept=".pdf" onChange={(e) => handlePdfUpload(e, "Notes")} style={{ ...inputStyle, padding: '10px' }} />

        <label style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', display: 'block' }}>Past Papers (PDF)</label>
        <input type="file" multiple accept=".pdf" onChange={(e) => handlePdfUpload(e, "Exams")} style={{ ...inputStyle, padding: '10px' }} />

        <button onClick={handleBuildCurriculum} disabled={loading || !subject} style={btnStyle}>
          {loading ? "Processing..." : "Generate Course"}
        </button>
      </div>
    </div>
  );

  if (screen === "curriculum") return (
    <div style={{ minHeight: '100vh', background: THEME.bg, color: THEME.text, padding: '60px 20px', fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
          <div>
            <h1 style={{ margin: 0 }}>{subject}</h1>
            <button onClick={handleReset} style={{ background: 'none', border: 'none', color: THEME.danger, fontSize: '12px', cursor: 'pointer', padding: 0, marginTop: '5px' }}>Reset Progress</button>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: THEME.primary }}>
              {Math.round((masteredKeys.size / curriculum.topics.reduce((a,t)=>a+t.subtopics.length,0)) * 100)}%
            </div>
            <div style={{ fontSize: '12px', color: THEME.textMuted }}>MASTERY</div>
          </div>
        </div>

        {curriculum.topics.map((topic, tIdx) => (
          <div key={tIdx} style={{ marginBottom: '40px' }}>
            <h3 style={{ fontSize: '13px', color: THEME.textMuted, textTransform: 'uppercase', marginBottom: '20px' }}>{topic.name}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' }}>
              {topic.subtopics.map((st, sIdx) => (
                <div key={sIdx} onClick={() => handleStartSubtopic(tIdx, sIdx)} style={{ 
                  ...cardStyle, padding: '20px', cursor: 'pointer', border: `1px solid ${masteredKeys.has(`${tIdx}-${sIdx}`) ? THEME.success : THEME.border}` 
                }}>
                  <div style={{ fontWeight: 'bold' }}>{st.name}</div>
                  {masteredKeys.has(`${tIdx}-${sIdx}`) && <div style={{ color: THEME.success, fontSize: '11px', marginTop: '10px' }}>✓ COMPLETE</div>}
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
        <button onClick={() => setScreen("curriculum")} style={{ background: 'none', border: 'none', color: THEME.textMuted, cursor: 'pointer', marginBottom: '20px' }}>← Back</button>
        <div style={cardStyle}>
          {phase === "notes" ? (
            <div>
              <h2 style={{ marginBottom: '25px', color: THEME.primary }}>{curriculum.topics[activePath.tIdx].subtopics[activePath.sIdx].name}</h2>
              {sessionData.diagram && <MermaidRenderer chart={sessionData.diagram} />}
              <MathRenderer text={sessionData.notes} />
              <button style={{ ...btnStyle, marginTop: '40px' }} onClick={() => handleFetchQuestion(false)}>Check Understanding</button>
            </div>
          ) : (
            <div>
              <h3 style={{ marginBottom: '30px' }}><MathRenderer text={sessionData.question.question} /></h3>
              <textarea value={studentAnswer} onChange={e => setStudentAnswer(e.target.value)} style={{ ...inputStyle, height: '140px' }} />
              {!feedback ? (
                <button style={btnStyle} onClick={async () => {
                  setLoading(true);
                  try {
                    const p = `Q: ${sessionData.question.question}\nStudent: ${studentAnswer}\nModel: ${sessionData.question.modelAnswer}`;
                    const res = await callAI([{ role: "user", content: p }], "Grade strictly. Return JSON: {\"correct\":boolean, \"feedback\":\"...\"}");
                    setFeedback(robustParseJSON(res));
                  } catch(e) { alert(e.message); }
                  setLoading(false);
                }}>Submit</button>
              ) : (
                <div style={{ marginTop: '20px', padding: '20px', borderRadius: '15px', background: feedback.correct ? '#064e3b' : '#450a0a' }}>
                  <div style={{ fontWeight: 'bold', color: feedback.correct ? THEME.success : '#f87171' }}>{feedback.correct ? "Correct!" : "Not Quite"}</div>
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
