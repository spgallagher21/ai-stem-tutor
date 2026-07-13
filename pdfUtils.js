import { PDFDocument } from "pdf-lib";

export const MAX_INLINE_DOCUMENT_BYTES = 15 * 1024 * 1024;

export function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function termsFor(queryText) {
  return (queryText || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

export async function waitForGlobal(name, { timeout = 15000, interval = 150 } = {}) {
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

export async function buildPageIndex(file) {
  await waitForGlobal("pdfjsLib");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push({ pageNum: i, text: content.items.map((s) => s.str).join(" ") });
  }
  return pages;
}

export function scoreRelevantPages(pageIndexes, queryText, maxPages = 10) {
  const terms = termsFor(queryText);
  if (!terms.length) return pageIndexes.slice(0, maxPages).map((p) => p.pageNum);
  return [...pageIndexes]
    .map((page) => {
      const lower = page.text.toLowerCase();
      const score = terms.reduce((sum, term) => sum + lower.split(term).length - 1, 0);
      return { pageNum: page.pageNum, score };
    })
    .sort((a, b) => b.score - a.score || a.pageNum - b.pageNum)
    .slice(0, maxPages)
    .sort((a, b) => a.pageNum - b.pageNum)
    .map((p) => p.pageNum);
}

export async function extractPages(sourcePdfBytes, pageNumbers) {
  const srcDoc = await PDFDocument.load(sourcePdfBytes);
  const newDoc = await PDFDocument.create();
  const safePages = [...new Set(pageNumbers)]
    .filter((pageNum) => pageNum >= 1 && pageNum <= srcDoc.getPageCount())
    .sort((a, b) => a - b);
  const copiedPages = await newDoc.copyPages(srcDoc, safePages.map((n) => n - 1));
  copiedPages.forEach((page) => newDoc.addPage(page));
  return newDoc.save();
}

export async function renderPdfPageImage(sourcePdfBytes, pageNumber, { scale = 0.9, quality = 0.68 } = {}) {
  await waitForGlobal("pdfjsLib");
  const bytes = sourcePdfBytes instanceof Uint8Array ? sourcePdfBytes.slice() : new Uint8Array(sourcePdfBytes).slice();
  const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
  const safePage = Math.min(Math.max(1, pageNumber), pdf.numPages);
  const page = await pdf.getPage(safePage);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/jpeg", quality);
}

export function inlinePdfDocumentPart(bytes) {
  return {
    inlineData: {
      mimeType: "application/pdf",
      data: arrayBufferToBase64(bytes),
    },
  };
}
