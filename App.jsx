import React, { useState, useRef, useEffect, useMemo } from "react";

// --- Configuration ---
// STABLE v1 URL - Most reliable endpoint globally
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
    // Finds the first { and last } to extract JSON from AI chatter
    const jsonMatch = rawStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } 
      catch (e2) { throw new Error("The AI provided a complex response. Please try clicking the button again."); }
    }
    throw new Error("I couldn't process that. Please try re-phrasing or clicking again.");
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

// --- Components (Defined OUTSIDE to fix the typing/focus bug) ---

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
        } catch (e) { console.error("Visual Error:", e); }
      }
    };
    render();
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
  const [examContent, setExamCo
