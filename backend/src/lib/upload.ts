import type { RequestHandler } from "express";
import multer from "multer";

export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_MB = Math.round(
  MAX_UPLOAD_SIZE_BYTES / (1024 * 1024),
);

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 1,
  },
});

const MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  zip: [0x50, 0x4b, 0x03, 0x04], // PK.. (docx/OOXML)
  ole2: [0xd0, 0xcf, 0x11, 0xe0], // legacy .doc (OLE2)
};

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  return sig.every((b, i) => buf[i] === b);
}

/**
 * Walidacja magic bytes (audyt 2026-05-29 H7). Samo rozszerzenie nie jest
 * gatekeeperem - plik PE/ELF z rozszerzeniem .docx trafilby do mammoth/pdfjs.
 * Twardy blok binariow wykonywalnych + wymog zgodnosci rozszerzenie<->magic dla
 * typow ryzykownych (pdf/docx/doc). Pozostale (txt) przechodza. Zwraca komunikat
 * bledu albo null gdy ok.
 */
export function validateUploadMagic(
  buf: Buffer,
  originalName: string,
): string | null {
  if (startsWith(buf, [0x4d, 0x5a])) return "Plik wykonywalny (PE/MZ) niedozwolony.";
  if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46]))
    return "Plik wykonywalny (ELF) niedozwolony.";
  const ext = originalName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" && !startsWith(buf, MAGIC.pdf))
    return "Zawartosc nie jest plikiem PDF.";
  if (ext === "docx" && !startsWith(buf, MAGIC.zip))
    return "Zawartosc nie jest plikiem DOCX.";
  if (ext === "doc" && !startsWith(buf, MAGIC.ole2))
    return "Zawartosc nie jest plikiem DOC.";
  return null;
}

export function singleFileUpload(fieldName: string): RequestHandler {
  return (req, res, next) => {
    memoryUpload.single(fieldName)(req, res, (err) => {
      if (!err) {
        const file = req.file;
        if (file?.buffer) {
          const magicErr = validateUploadMagic(file.buffer, file.originalname);
          if (magicErr) return void res.status(415).json({ detail: magicErr });
        }
        return next();
      }

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return void res.status(413).json({
            detail: `File too large. Maximum size is ${MAX_UPLOAD_SIZE_MB} MB.`,
          });
        }
        return void res.status(400).json({
          detail: `Upload failed: ${err.message}`,
        });
      }

      return next(err);
    });
  };
}
