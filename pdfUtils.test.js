import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mergePdfSelections } from "./pdfUtils";

async function pdfWithPages(count) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) pdf.addPage();
  return pdf.save();
}

describe("multi-file PDF context", () => {
  it("keeps selected pages from every uploaded PDF", async () => {
    const result = await mergePdfSelections([
      { name: "earlier.pdf", bytes: await pdfWithPages(3), pages: [1, 3] },
      { name: "newer.pdf", bytes: await pdfWithPages(2), pages: [2] },
    ]);
    const merged = await PDFDocument.load(result.bytes);
    expect(merged.getPageCount()).toBe(5); // two source dividers plus three selected pages
    expect(result.pageMap.filter((page) => !page.divider).map((page) => page.fileName)).toEqual(["earlier.pdf", "earlier.pdf", "newer.pdf"]);
  });
});
