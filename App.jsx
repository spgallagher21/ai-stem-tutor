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
      setScreen
