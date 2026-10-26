import React, { useEffect, useRef, useState } from "react";
import { getArtifact, saveArtifact } from "./studyStore";

export function locateQuote(text, item) {
  if (text.slice(item.start, item.start + item.quote.length) === item.quote) return item.start;
  const first = text.indexOf(item.quote);
  return first >= 0 && text.indexOf(item.quote, first + 1) < 0 ? first : -1;
}

function quoteRange(root, start, length) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0, node, range = document.createRange();
  while ((node = walker.nextNode())) {
    const end = offset + node.textContent.length;
    if (start >= offset && start < end) range.setStart(node, start - offset);
    if (start + length > offset && start + length <= end) { range.setEnd(node, start + length - offset); return range; }
    offset = end;
  }
  return null;
}

export default function NoteAnnotations({ uid, lessonId, onDiscuss, children, revision }) {
  const root = useRef(null);
  const [items, setItems] = useState([]);
  const [selection, setSelection] = useState(null);
  const [comment, setComment] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const highlightKey = useRef(`notes-${crypto.randomUUID()}`);
  useEffect(() => {
    let cancelled = false;
    getArtifact(uid, "noteAnnotations", lessonId).then((saved) => { if (!cancelled) { setItems(saved || []); setReady(true); } }).catch(() => { if (!cancelled) setError("Saved annotations could not be loaded. Reload before making changes."); });
    return () => { cancelled = true; };
  }, [uid, lessonId]);
  useEffect(() => {
    if (!globalThis.CSS?.highlights || !globalThis.Highlight || !root.current) return;
    const target = root.current.querySelector(".note-paper");
    if (!target) return;
    const ranges = items.flatMap((item) => {
      const start = locateQuote(target.textContent, item);
      const range = start >= 0 ? quoteRange(target, start, item.quote.length) : null;
      return range ? [range] : [];
    });
    CSS.highlights.set(highlightKey.current, new Highlight(...ranges));
    return () => CSS.highlights.delete(highlightKey.current);
  }, [items, revision]);
  const capture = () => {
    const selected = window.getSelection();
    const target = root.current?.querySelector(".note-paper");
    if (!selected?.rangeCount || selected.isCollapsed || !target) return;
    const range = selected.getRangeAt(0);
    if (!target.contains(range.startContainer) || !target.contains(range.endContainer)) return;
    const quote = range.toString();
    if (!quote.trim() || quote.length > 3000) return;
    const before = range.cloneRange(); before.selectNodeContents(target); before.setEnd(range.startContainer, range.startOffset);
    setSelection({ quote, start: before.toString().length }); setComment("");
  };
  const persist = async (next) => {
    setBusy(true); setError("");
    try { await saveArtifact(uid, "noteAnnotations", lessonId, next); setItems(next); setSelection(null); setComment(""); }
    catch { setError("Annotation could not be saved. Please try again."); }
    finally { setBusy(false); }
  };
  return <div ref={root} onPointerUp={capture} onKeyUp={capture}>
    <style>{`::highlight(${highlightKey.current}) { background: #ffe679; color: #202020; }`}</style>
    <div className="annotation-tools"><span>Select note text to highlight it or add a comment.</span>{error && <p role="alert">{error}</p>}
      {!globalThis.CSS?.highlights && <small>Your browser does not support inline highlighting. Saved passages and comments are still available below.</small>}
      {selection && <div><blockquote>{selection.quote}</blockquote><label>Comment or question<textarea className="input" maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} /></label>
        <button className="btn" disabled={!ready || busy} onClick={() => persist([...items, { ...selection, id: crypto.randomUUID(), comment: comment.trim(), createdAt: Date.now() }])}>{comment.trim() ? "Save highlight and comment" : "Highlight"}</button>
        <button className="btn secondary" onClick={() => setSelection(null)}>Cancel</button></div>}
    </div>
    {children}
    {items.length > 0 && <section className="annotation-tools" aria-label="Highlights and comments"><h3>Highlights & comments</h3><small>Saved on this device. If notes change, unmatched highlights stay here as quoted passages.</small>
      {items.map((item) => <details key={item.id} className="annotation-bubble"><summary>💬 {item.comment || item.quote.slice(0, 100)}</summary><blockquote>{item.quote}</blockquote>{item.comment && <p>{item.comment}</p>}<button className="btn secondary" onClick={() => onDiscuss(item)}>Ask my notes · discussion</button><button className="btn ghost" disabled={busy} onClick={() => persist(items.filter((entry) => entry.id !== item.id))}>Delete</button></details>)}
    </section>}
  </div>;
}
