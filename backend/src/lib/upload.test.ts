import { describe, it, expect } from "vitest";
import { validateUploadMagic } from "./upload";

const buf = (...bytes: number[]) => Buffer.from(bytes);

describe("validateUploadMagic (audyt H7)", () => {
  it("przepuszcza poprawny PDF", () => {
    expect(
      validateUploadMagic(buf(0x25, 0x50, 0x44, 0x46, 0x2d), "akta.pdf"),
    ).toBeNull();
  });

  it("przepuszcza poprawny DOCX (PK zip)", () => {
    expect(
      validateUploadMagic(buf(0x50, 0x4b, 0x03, 0x04), "umowa.docx"),
    ).toBeNull();
  });

  it("przepuszcza legacy DOC (OLE2)", () => {
    expect(
      validateUploadMagic(buf(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1), "pismo.doc"),
    ).toBeNull();
  });

  it("przepuszcza txt bez magic bytes", () => {
    expect(
      validateUploadMagic(Buffer.from("zwykly tekst", "utf8"), "notatka.txt"),
    ).toBeNull();
  });

  it("blokuje PE/MZ udajacy docx", () => {
    expect(
      validateUploadMagic(buf(0x4d, 0x5a, 0x90, 0x00), "malware.docx"),
    ).toMatch(/wykonywalny/);
  });

  it("blokuje ELF niezaleznie od rozszerzenia", () => {
    expect(validateUploadMagic(buf(0x7f, 0x45, 0x4c, 0x46), "x.pdf")).toMatch(
      /wykonywalny/,
    );
  });

  it("blokuje .pdf bez naglowka %PDF", () => {
    expect(
      validateUploadMagic(Buffer.from("not a pdf at all", "utf8"), "fake.pdf"),
    ).toMatch(/PDF/);
  });

  it("blokuje .docx bez naglowka zip", () => {
    expect(validateUploadMagic(buf(0x00, 0x01, 0x02, 0x03), "fake.docx")).toMatch(
      /DOCX/,
    );
  });
});
