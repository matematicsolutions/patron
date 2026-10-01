import fs from "fs";
import path from "path";
import JSZip from "jszip";

let _convert:
  | ((buf: Buffer, ext: string, filter: undefined) => Promise<Buffer>)
  | null = null;

async function getConvert() {
  if (!_convert) {
    const libre = await import("libreoffice-convert");
    const convert = libre.default.convert.bind(libre.default) as (
      buf: Buffer,
      ext: string,
      filter: undefined,
      callback?: (err: Error | null, result: Buffer) => void,
    ) => Promise<Buffer> | void;
    _convert = (buf, ext, filter) =>
      new Promise<Buffer>((resolve, reject) => {
        try {
          const maybePromise = convert(buf, ext, filter, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
          if (maybePromise && typeof maybePromise.then === "function") {
            maybePromise.then(resolve, reject);
          }
        } catch (err) {
          reject(err);
        }
      });
  }
  return _convert;
}

/**
 * Some older Windows/Word archives store .docx entries with backslash
 * separators (e.g. `word\document.xml`). Mammoth and LibreOffice both look
 * up entries by exact string and miss those files, producing empty output
 * or conversion failures. Rewrite any such entries to the canonical
 * forward-slash form before handing the buffer off.
 */
export async function normalizeDocxZipPaths(buffer: Buffer): Promise<Buffer> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return buffer;
  }
  const renames: [string, string][] = [];
  zip.forEach((relativePath) => {
    if (relativePath.includes("\\")) {
      renames.push([relativePath, relativePath.replace(/\\/g, "/")]);
    }
  });
  if (renames.length === 0) return buffer;
  for (const [oldPath, newPath] of renames) {
    const entry = zip.file(oldPath);
    if (!entry) continue;
    const content = await entry.async("nodebuffer");
    zip.remove(oldPath);
    zip.file(newPath, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * Sciezki, pod ktorymi `libreoffice-convert` szuka binarki - LUSTRO jego
 * wlasnej listy (`node_modules/libreoffice-convert/index.js`, zadanie `soffice`).
 *
 * Kopia istnieje, bo biblioteka nie eksportuje ani listy, ani funkcji "czy jest".
 * Jedyna alternatywa - probna konwersja - kosztuje 25-40 s (zmierzone 2026-09-09),
 * wiec nie nadaje sie na sprawdzenie dostepnosci. Rozjazd z lista biblioteki
 * lapie `convert.libreoffice.test.ts`, ktory czyta jej zrodlo z node_modules:
 * lustro bez bramki nie trzyma (AGENTS.md).
 */
export function sofficeCandidates(
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "darwin") {
    return ["/Applications/LibreOffice.app/Contents/MacOS/soffice"];
  }
  if (platform === "win32") {
    return [
      path.join(process.env["PROGRAMFILES(X86)"] || "", "LIBREO~1/program/soffice.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "", "LibreOffice/program/soffice.exe"),
      path.join(process.env.PROGRAMFILES_X86 || "", "LibreOffice/program/soffice.exe"),
      path.join(process.env.PROGRAMFILES || "", "LibreOffice/program/soffice.exe"),
      process.env.LIBRE_OFFICE_EXE || "",
      "C:/Program Files/LibreOffice/program/soffice.exe",
      // Pusty wpis powstaje, gdy brakuje zmiennej srodowiskowej; `path.join("", x)`
      // daje przy tym sciezke WZGLEDNA. Ani jedno, ani drugie nie moze trafic
      // przypadkiem w istniejacy plik i udac, ze LibreOffice jest.
    ].filter((p) => p !== "" && path.isAbsolute(p));
  }
  return [
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
    "/snap/bin/libreoffice",
    "/opt/libreoffice/program/soffice",
    "/opt/libreoffice7.6/program/soffice",
  ];
}

/**
 * Czy LibreOffice jest dostepny na TEJ maszynie.
 *
 * DWA SRODOWISKA, dwie odpowiedzi. Tryb serwerowy: `backend/Dockerfile` instaluje
 * `libreoffice-core libreoffice-writer`, wiec jest zawsze. Desktop: NIE jedzie
 * w instalatorze (`desktop/scripts/prepare-resources.cjs` stage'uje OCR, Pythona
 * i model embeddingow, ale nie jego) - tam jest opcjonalnym wymogiem zewnetrznym
 * z `docs/INSTALACJA.md`. Dlatego pytamy maszyne, a nie zakladamy. Bez niego stary,
 * binarny `.doc` jest dla nas NIECZYTELNY: `extractDocxBodyText` to parser ZIP-a
 * (OOXML), a `.doc` to format OLE - ekstrakcja pada, tekst jest pusty, dokument
 * nie trafia do indeksu i nie da sie go wyswietlic. Bez tej funkcji konczylo sie
 * to cicho: plik ladowal w bazie jako "ready" i znikal z zycia uzytkownika.
 *
 * Wynik nie jest cache'owany: Operator moze doinstalowac LibreOffice bez
 * restartu aplikacji, a `existsSync` kosztuje mikrosekundy.
 */
export function isLibreOfficeAvailable(): boolean {
  return sofficeCandidates().some((p) => fs.existsSync(p));
}

/**
 * Convert a DOCX/DOC buffer to PDF using LibreOffice.
 * Throws if LibreOffice is not installed or conversion fails.
 *
 * KOSZT: 25-40 s na dokument, bez rozgrzewania sie (zmierzone 2026-09-09 na
 * trzech kolejnych wywolaniach: 40,1 / 35,9 / 25,2 s). `libreoffice-convert`
 * odpala osobny proces `soffice` na kazde wywolanie. NIE wolaj tego na sciezce
 * zadania - patrz `documentIngest.ts`, gdzie konwersja idzie w tle.
 */
export async function docxToPdf(buffer: Buffer): Promise<Buffer> {
  const convert = await getConvert();
  const normalized = await normalizeDocxZipPaths(buffer);
  return convert(normalized, ".pdf", undefined);
}

export function convertedPdfKey(userId: string, docId: string): string {
  return `converted-pdfs/${userId}/${docId}.pdf`;
}
