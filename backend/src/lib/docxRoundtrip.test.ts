// Testy Word import roundtrip (ADR-0060). detectPatronInstruction (pure),
// parseTrackedChanges (przez applyTrackedEdits - domkniecie petli zapis->odczyt),
// parseComments (docx z wstrzyknieta comments.xml).

import { Document, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { applyTrackedEdits } from "./docxTrackedChanges";
import {
  detectPatronInstruction,
  parseComments,
  parseDocxRoundtrip,
  parseTrackedChanges,
} from "./docxRoundtrip";

async function makeDocx(text: string): Promise<Buffer> {
  const d = new Document({ sections: [{ children: [new Paragraph(text)] }] });
  return Packer.toBuffer(d);
}

async function injectComment(
  docx: Buffer,
  commentText: string,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:comment w:id="1" w:author="Beata" w:date="2026-05-28T10:00:00Z">` +
    `<w:p><w:r><w:t>${commentText}</w:t></w:r></w:p>` +
    `</w:comment></w:comments>`;
  zip.file("word/comments.xml", xml);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("detectPatronInstruction (pure)", () => {
  it("wykrywa [PATRON: ...] i zwraca tresc", () => {
    expect(detectPatronInstruction("[PATRON: rozwin ten argument]")).toBe(
      "rozwin ten argument",
    );
  });
  it("case-insensitive + trim", () => {
    expect(detectPatronInstruction("  [patron:  dodaj podstawe  ] ")).toBe(
      "dodaj podstawe",
    );
  });
  it("zwykly komentarz -> null", () => {
    expect(detectPatronInstruction("Przemysl to jeszcze raz.")).toBeNull();
  });
});

describe("parseTrackedChanges (petla applyTrackedEdits -> parse)", () => {
  it("odczytuje ins + del z autorem po zastosowaniu edycji", async () => {
    const base = await makeDocx("Powodka zada zaplaty kwoty 5000 zl tytulem odszkodowania.");
    const edited = await applyTrackedEdits(
      base,
      [
        {
          find: "5000",
          replace: "8000",
          context_before: "kwoty ",
          context_after: " zl",
        },
      ],
      { author: "Beata" },
    );
    expect(edited.changes.length).toBe(1);

    const changes = await parseTrackedChanges(edited.bytes);
    const ins = changes.find((c) => c.kind === "ins");
    const del = changes.find((c) => c.kind === "del");
    // collapseDiff minimalizuje 5000->8000 do wspolnego "000": del "5", ins "8".
    expect(ins?.text).toBe("8");
    expect(del?.text).toBe("5");
    expect(ins?.author).toBe("Beata");
    expect(ins?.w_id).toBeTruthy();
  });

  it("brak tracked changes -> pusta lista", async () => {
    const plain = await makeDocx("Zwykly tekst bez zmian.");
    expect((await parseTrackedChanges(plain)).length).toBe(0);
  });
});

describe("parseComments + parseDocxRoundtrip", () => {
  it("parsuje komentarz i wykrywa instrukcje PATRON", async () => {
    const base = await makeDocx("Tresc pisma.");
    const withComment = await injectComment(
      base,
      "[PATRON: dodaj podstawe prawna art. 415 KC]",
    );
    const comments = await parseComments(withComment);
    expect(comments.length).toBe(1);
    expect(comments[0].author).toBe("Beata");
    expect(comments[0].instruction).toBe(
      "dodaj podstawe prawna art. 415 KC",
    );
  });

  it("parseDocxRoundtrip zbiera instructions", async () => {
    const base = await makeDocx("Tresc.");
    const withComment = await injectComment(base, "[PATRON: skroc wstep]");
    const r = await parseDocxRoundtrip(withComment);
    expect(r.instructions).toContain("skroc wstep");
    expect(r.comments.length).toBe(1);
  });

  it("docx bez comments.xml -> brak komentarzy", async () => {
    const plain = await makeDocx("Bez komentarzy.");
    expect((await parseComments(plain)).length).toBe(0);
  });
});
