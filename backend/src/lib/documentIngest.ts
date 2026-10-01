// Kanoniczny ingest dokumentu - wspolny dla single-document (routes/documents.ts),
// dokumentow projektowych (routes/projects.ts) ORAZ importu z folderu lokalnego
// (Folder Sprawy - ADR-0056).
//
// Warstwy:
//   ingestDocument(params)  - headless rdzen: skan -> persist -> RAG-index.
//                             Zwraca {httpStatus, body, documentId}. Bez req/res.
//   handleDocumentUpload()  - cienki wrapper HTTP (multer req -> ingestDocument).
//   ingestFolder()          - import wszystkich wspieranych plikow z katalogu.
//
// Historycznie istnialy dwie kopie logiki uploadu, ktore rozjechaly sie: sciezka
// projektowa NIE robila skanu input-security (ADR-0019/0020). Jedno zrodlo prawdy
// (ADR-0055) eliminuje te klase regresji; ADR-0056 dokłada headless ingest +
// import z folderu (zero HTTP, backend czyta dysk lokalnie w trybie desktop).

import fs from "fs";
import path from "path";
import { uploadFile, storageKey } from "./storage";
import {
  docxToPdf,
  convertedPdfKey,
  isLibreOfficeAvailable,
} from "./convert";
import { extractDocxBodyText } from "./docxTrackedChanges";
import { extractPdfText } from "./chat/pdf";
import { indexDocument } from "./retrieval/indexer";
import { appendAuditEvent } from "./audit";
import {
  analyzeInput,
  resolveIngestOutcome,
  toAuditPayload,
  inputSecurityEnforce,
  INPUT_SECURITY_AUDIT_EVENT,
} from "./input-security";
import { createServerSupabase } from "./supabase";
import { convertToMarkdown } from "./convert/toMarkdown";
import { runOcr, isOcrConfigured } from "./convert/ocrRunner";

// ADR-0074: typy bazowe zawsze; obrazy/skany akceptowane tylko gdy OCR (Chandra)
// jest skonfigurowany - build bez OCR zachowuje sie jak dotad (czyste odrzucenie).
const BASE_TYPES = new Set(["pdf", "docx"]);
const IMAGE_TYPES = new Set(["jpg", "jpeg", "png", "tiff", "tif", "bmp", "webp"]);
// Stary, BINARNY `.doc` (format OLE) wymaga LibreOffice - bez niego nie umiemy go
// ani przeczytac, ani pokazac: `extractDocxBodyText` to parser ZIP-a (OOXML), wiec
// ekstrakcja pada, tekst jest pusty, dokument nie wchodzi do indeksu, a przegladarka
// DocxView tez go nie wyrenderuje. Do 2026-09-09 konczylo sie to CICHO - plik
// ladowal w bazie ze statusem "ready" i po prostu znikal z zycia mecenasa.
// Ten sam wzorzec co obrazy pod OCR: brak silnika = czyste, nazwane odrzucenie.
const LIBREOFFICE_TYPES = new Set(["doc"]);

/**
 * Konwersja DOCX/DOC -> PDF poza sciezka zadania.
 *
 * Nie rzuca: wolajacy juz odpowiedzial klientowi, wiec jedyne, co mozna tu
 * zrobic z bledem, to go zapisac. `pdf_storage_path` zostaje wtedy puste i obie
 * powierzchnie podgladu ida wariantem zapasowym.
 */
async function renderPdfInBackground(args: {
  content: Buffer;
  userId: string;
  docId: string;
  versionId: string;
  filename: string;
  db: IngestParams["db"];
}): Promise<void> {
  const { content, userId, docId, versionId, filename, db } = args;
  if (!isLibreOfficeAvailable()) {
    // Nie probujemy i nie udajemy, ze probowalismy. Dla .docx to stan normalny
    // (DocxView renderuje bez PDF-a); .doc w ogole tu nie dojdzie, bo odpada
    // wczesniej na isAllowedType.
    console.info(
      `[ingest] podglad PDF dla ${filename} pominiety: brak LibreOffice ` +
        "(opcjonalny wymog zewnetrzny - docs/INSTALACJA.md)",
    );
    return;
  }
  try {
    const pdfBuf = await docxToPdf(content);
    const pdfKey = convertedPdfKey(userId, docId);
    await uploadFile(
      pdfKey,
      pdfBuf.buffer.slice(
        pdfBuf.byteOffset,
        pdfBuf.byteOffset + pdfBuf.byteLength,
      ) as ArrayBuffer,
      "application/pdf",
    );
    await db
      .from("document_versions")
      .update({ pdf_storage_path: pdfKey })
      .eq("id", versionId);
  } catch (err) {
    console.error(`[ingest] DOCX→PDF conversion failed for ${filename}:`, err);
  }
}

/** Zdolnosci srodowiska, od ktorych zalezy zbior przyjmowanych typow. */
export interface ZdolnosciKonwersji {
  libreoffice: boolean;
  ocr: boolean;
}

/**
 * Czy przyjmujemy ten typ pliku - CZYSTA funkcja zdolnosci srodowiska.
 *
 * Wyjeta z `isAllowedType`, bo tamta pyta system plikow i zmienne srodowiskowe,
 * wiec jej wynik zalezy od tego, co akurat jest zainstalowane na maszynie
 * testujacej. Konwencja jak w `routes/security.test.ts`: logika decyzyjna osobno,
 * odpytanie srodowiska osobno.
 */
export function typDozwolony(
  suffix: string,
  zdolnosci: ZdolnosciKonwersji,
): boolean {
  if (BASE_TYPES.has(suffix)) return true;
  if (LIBREOFFICE_TYPES.has(suffix)) return zdolnosci.libreoffice;
  if (IMAGE_TYPES.has(suffix)) return zdolnosci.ocr;
  return false;
}

/** Lista typow do komunikatu 400 - ta sama wiedza co `typDozwolony`, jeden dom. */
export function opisDozwolonychTypow(zdolnosci: ZdolnosciKonwersji): string {
  const czesci = ["pdf", "docx"];
  if (zdolnosci.libreoffice) czesci.push("doc");
  if (zdolnosci.ocr) czesci.push("jpg, png, tiff (skany/zdjecia przez OCR)");
  return czesci.join(", ");
}

/**
 * Podpowiedz, KTOREGO skladnika brakuje. Bez niej mecenas widzi "nieobslugiwany
 * typ" przy pliku, ktory obslugujemy po doinstalowaniu jednego programu, i nie
 * ma jak sie domyslic ktorego.
 */
export function podpowiedzBrakujacegoSkladnika(
  suffix: string,
  zdolnosci: ZdolnosciKonwersji,
): string {
  if (LIBREOFFICE_TYPES.has(suffix) && !zdolnosci.libreoffice) {
    return (
      " Format .doc wymaga programu LibreOffice (bezplatny, libreoffice.org)." +
      " Zapisz plik jako .docx albo zainstaluj LibreOffice i uruchom Patrona ponownie."
    );
  }
  if (IMAGE_TYPES.has(suffix) && !zdolnosci.ocr) {
    return " Skany i zdjecia wymagaja skonfigurowanego silnika OCR.";
  }
  return "";
}

function zdolnosci(): ZdolnosciKonwersji {
  return { libreoffice: isLibreOfficeAvailable(), ocr: isOcrConfigured() };
}

function isAllowedType(suffix: string): boolean {
  return typDozwolony(suffix, zdolnosci());
}

function contentTypeFor(suffix: string): string {
  if (suffix === "pdf") return "application/pdf";
  if (suffix === "docx" || suffix === "doc")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const img: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    tiff: "image/tiff",
    tif: "image/tiff",
    bmp: "image/bmp",
    webp: "image/webp",
  };
  return img[suffix] ?? "application/octet-stream";
}

export interface IngestParams {
  content: Buffer;
  filename: string;
  userId: string;
  projectId: string | null;
  db: ReturnType<typeof createServerSupabase>;
}

export interface IngestResponse {
  httpStatus: number;
  body: unknown;
  /** Ustawione gdy dokument zostal utrwalony (allowed/quarantined/human_review). */
  documentId?: string;
}

function suffixOf(filename: string): string {
  return filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
}

/**
 * Headless rdzen ingestu. Skan input-security (ADR-0019/0020) -> utrwalenie ->
 * wersja V1 -> RAG-index (ADR-0054, gate allowIndex). Deterministyczny, lokalny.
 * Nie dotyka req/res - zwraca status + body do wyslania przez wywolujacego.
 */
export async function ingestDocument(
  params: IngestParams,
): Promise<IngestResponse> {
  const { content, filename, userId, projectId, db } = params;
  const suffix = suffixOf(filename);
  if (!isAllowedType(suffix)) {
    const z = zdolnosci();
    const allowed = opisDozwolonychTypow(z);
    const podpowiedz = podpowiedzBrakujacegoSkladnika(suffix, z);
    return {
      httpStatus: 400,
      body: {
        detail: `Unsupported file type: ${suffix}. Allowed: ${allowed}.${podpowiedz}`,
      },
    };
  }

  const { data: doc, error: insertErr } = await db
    .from("documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      filename,
      file_type: suffix,
      size_bytes: content.byteLength,
      status: "processing",
    })
    .select("*")
    .single();
  if (insertErr || !doc) {
    return {
      httpStatus: 500,
      body: { detail: "Failed to create document record" },
    };
  }

  const docId = doc.id as string;
  try {
    const key = storageKey(userId, docId, filename);
    const contentType = contentTypeFor(suffix);

    const rawBuf = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;

    // ADR-0019/0020: skan bezpieczenstwa wejscia PRZED utrwaleniem bajtow i
    // RAG-indeksacja. Deterministyczny, lokalny, zero-LLM. Wynik -> kolumny
    // documents.security_* + audit_log (zdarzenie input_security_scan).
    // blocked => bajty NIE trafiaja do storage (return przed uploadFile).
    // ADR-0074: konwersja wejscia -> Markdown przez silnik konwersji. Zachowawcze
    // dla pdf/docx (te same extractPdfText/extractDocxBodyText), a skany-PDF bez
    // warstwy tekstu i obrazy ida przez OCR (Chandra, lokalnie). Best-effort:
    // blad konwersji/OCR nie wywala ingestu (dokument utrwalony, detektory binarne
    // dzialaja na buforze niezaleznie).
    let scanText = "";
    try {
      const conv = await convertToMarkdown(
        { buffer: content, filename },
        {
          extractPdfText,
          extractDocxText: extractDocxBodyText,
          ocr: runOcr,
        },
      );
      scanText = conv.markdown;
    } catch (e) {
      console.warn(
        `[ingest] konwersja->MD nieudana dla ${filename}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
    const scan = analyzeInput({
      text: scanText,
      fileName: filename,
      declaredType: contentType,
      buffer: new Uint8Array(rawBuf),
    });
    const outcome = resolveIngestOutcome(scan, inputSecurityEnforce());
    await appendAuditEvent(db, {
      event_type: INPUT_SECURITY_AUDIT_EVENT,
      actor_user_id: userId,
      document_id: docId,
      payload: toAuditPayload(scan),
    });
    if (!outcome.persist) {
      await db
        .from("documents")
        .update({
          status: outcome.documentStatus,
          security_status: outcome.securityStatus,
          security_report_id: scan.reportId,
        })
        .eq("id", docId);
      return {
        httpStatus: outcome.httpStatus,
        body: {
          detail:
            "Dokument odrzucony: wykryto zagrozenie bezpieczenstwa wejscia.",
          security: {
            action: scan.action,
            threat_level: scan.threatLevel,
            report_id: scan.reportId,
          },
        },
      };
    }

    await uploadFile(key, rawBuf, contentType);

    const tree = await extractStructureTree(rawBuf, suffix, filename);
    const pageCount = suffix === "pdf" ? await countPdfPages(rawBuf) : null;

    // Rendition PDF do podgladu. Dla PDF-a jest nim on sam - za darmo, od reki.
    //
    // Dla DOCX/DOC konwersja idzie W TLE (ADR-0150 nie dotyczy; pomiar 2026-09-09).
    // Powod: `docxToPdf` odpala LibreOffice i kosztuje 25-40 s NA DOKUMENT, bez
    // rozgrzewania sie. Stala na sciezce zadania, wiec import folderu z 50 pismami
    // trwal ponad 20 minut - a tuz obok `indexDocument` bylo juz zdjete z tej
    // sciezki z komentarzem "embedding trwa kilka sekund, nie blokujemy
    // odpowiedzi". Czterdziestosekundowy etap blokowal, kilkusekundowy nie.
    //
    // Nic nie czeka na ten plik synchronicznie: `DocPanel` wybiera przegladarke
    // po NAZWIE pliku i dla .docx zawsze uzywa DocxView, a `TRSidePanel` ma
    // dzialajacy wariant zapasowy, gdy `pdf_storage_path` jest puste. Dokument
    // jest juz utrwalony i "ready" - rendition dochodzi pozniej albo wcale.
    const pdfStoragePath: string | null = suffix === "pdf" ? key : null;

    // storage_path / pdf_storage_path live on document_versions now — create
    // the V1 "upload" row and point documents.current_version_id at it.
    const { data: versionRow, error: verErr } = await db
      .from("document_versions")
      .insert({
        document_id: docId,
        storage_path: key,
        pdf_storage_path: pdfStoragePath,
        source: "upload",
        version_number: 1,
        display_name: filename,
      })
      .select("id")
      .single();
    if (verErr || !versionRow) {
      throw new Error(
        `Failed to record upload version: ${verErr?.message ?? "unknown"}`,
      );
    }

    await db
      .from("documents")
      .update({
        current_version_id: versionRow.id,
        size_bytes: content.byteLength,
        page_count: pageCount,
        structure_tree: tree ?? null,
        status: outcome.documentStatus,
        security_status: outcome.securityStatus,
        security_report_id: scan.reportId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", docId);

    // Rendition PDF w tle - patrz komentarz przy `pdfStoragePath` wyzej.
    // Best-effort dokladnie jak indeksacja nizej: gdy sie nie uda (brak
    // LibreOffice, uszkodzony plik), `pdf_storage_path` zostaje puste, a obie
    // powierzchnie podgladu maja wariant zapasowy.
    if (suffix === "docx" || suffix === "doc") {
      void renderPdfInBackground({
        content,
        userId,
        docId,
        versionId: versionRow.id as string,
        filename,
        db,
      });
    }

    // ADR-0054: indeksacja do hybrid retrieval + graf cytowan. Tylko gdy skan
    // bezpieczenstwa dopuscil (outcome.allowIndex) - quarantined/human_review
    // NIE trafiaja do indeksu. Best-effort w tle: embedding trwa kilka sekund,
    // nie blokujemy odpowiedzi (dokument jest juz 'ready' i utrwalony).
    if (outcome.allowIndex && scanText.trim()) {
      void indexDocument(docId, scanText).catch((err) => {
        console.error(`[ingest] RAG index failed for ${docId}:`, err);
      });
    }

    const { data: updated } = await db
      .from("documents")
      .select("*")
      .eq("id", docId)
      .single();
    // Surface storage paths to the caller for backward compatibility.
    const responseDoc = updated
      ? {
          ...updated,
          storage_path: key,
          pdf_storage_path: pdfStoragePath,
          security: {
            action: scan.action,
            threat_level: scan.threatLevel,
            report_id: scan.reportId,
          },
        }
      : updated;
    // 202 dla human_review (utrwalony, czeka na decyzje Operatora/Inspektora),
    // 201 dla allowed/quarantined. allowIndex=false => RAG ma pominac.
    return { httpStatus: outcome.httpStatus, body: responseDoc, documentId: docId };
  } catch (e) {
    await db.from("documents").update({ status: "error" }).eq("id", docId);
    return {
      httpStatus: 500,
      body: { detail: `Document processing failed: ${String(e)}` },
    };
  }
}

/**
 * Wrapper HTTP nad ingestDocument. Wyciaga plik z multera i mapuje wynik na res.
 */
export async function handleDocumentUpload(
  req: import("express").Request,
  res: import("express").Response,
  userId: string,
  projectId: string | null,
  db: ReturnType<typeof createServerSupabase>,
) {
  const file = req.file;
  if (!file) return void res.status(400).json({ detail: "file is required" });
  const result = await ingestDocument({
    content: file.buffer,
    filename: file.originalname,
    userId,
    projectId,
    db,
  });
  return void res.status(result.httpStatus).json(result.body);
}

export interface FolderIngestEntry {
  file: string;
  httpStatus: number;
  documentId?: string;
}

/** Zbiera wspierane pliki z katalogu REKURENCYJNIE (podkatalogi tez). Zwraca
 *  pary {absolutna sciezka, sciezka wzgledna do korzenia} - sciezka wzgledna idzie
 *  do pola `file` (audyt/UI pokazuje z ktorego podfolderu, np. "Cz. 1/IMG_2462.JPG").
 *  Akta papierowe sa czesto cyfryzowane w podfolderach (Cz. 1/2/3) - pomijanie
 *  podkatalogow czynilo import bezuzytecznym dla realnych spraw (pilot Rumpole). */
async function collectSupportedFiles(
  rootPath: string,
): Promise<{ abs: string; rel: string }[]> {
  const out: { abs: string; rel: string }[] = [];
  const walk = async (dir: string, relBase: string): Promise<void> => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relBase ? path.posix.join(relBase, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile() && isAllowedType(suffixOf(entry.name))) {
        out.push({ abs, rel });
      }
    }
  };
  await walk(rootPath, "");
  return out;
}

/**
 * Importuje wszystkie wspierane pliki (pdf/docx/doc + skany jpg/png/tiff gdy OCR
 * skonfigurowany) z katalogu lokalnego REKURENCYJNIE przez ingestDocument.
 * Fundament Folder Sprawy (ADR-0056): backend dziala lokalnie w trybie desktop,
 * wiec czyta dysk bezposrednio - bez HTTP/multipart. Niewspierane rozszerzenia sa
 * pomijane; podkatalogi sa PRZESZUKIWANE (sciezka wzgledna w polu `file`). Kazdy
 * plik przechodzi pelny skan + RAG-index jak zwykly upload.
 */
export async function ingestFolder(
  folderPath: string,
  userId: string,
  projectId: string | null,
  db: ReturnType<typeof createServerSupabase>,
): Promise<FolderIngestEntry[]> {
  const files = await collectSupportedFiles(folderPath);
  const results: FolderIngestEntry[] = [];
  for (const { abs, rel } of files) {
    const content = await fs.promises.readFile(abs);
    const r = await ingestDocument({
      content,
      filename: path.basename(abs),
      userId,
      projectId,
      db,
    });
    results.push({
      file: rel,
      httpStatus: r.httpStatus,
      documentId: r.documentId,
    });
  }
  return results;
}

async function countPdfPages(buf: ArrayBuffer): Promise<number | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
    const pdf = await (
      pdfjsLib as unknown as {
        getDocument: (opts: unknown) => {
          promise: Promise<{ numPages: number }>;
        };
      }
    ).getDocument({ data: new Uint8Array(buf) }).promise;
    return pdf.numPages;
  } catch {
    return null;
  }
}

async function extractStructureTree(
  content: ArrayBuffer,
  fileType: string,
  _filename: string,
): Promise<unknown[] | null> {
  try {
    if (fileType === "pdf") {
      const pdfjsLib = await import(
        "pdfjs-dist/legacy/build/pdf.mjs" as string
      );
      const pdf = await (
        pdfjsLib as unknown as {
          getDocument: (opts: unknown) => {
            promise: Promise<{
              numPages: number;
              getOutline: () => Promise<{ title?: string }[]>;
            }>;
          };
        }
      ).getDocument({ data: new Uint8Array(content) }).promise;
      if (pdf.numPages <= 5) return null;
      const outline = await pdf.getOutline();
      if (outline?.length)
        return outline.map((item, i) => ({
          id: `h1-${i}`,
          title: item.title ?? `Item ${i + 1}`,
          level: 1,
          page_number: null,
          children: [],
        }));
      return Array.from({ length: pdf.numPages }, (_, i) => ({
        id: `page-${i + 1}`,
        title: `Page ${i + 1}`,
        level: 1,
        page_number: i + 1,
        children: [],
      }));
    } else {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(content),
      });
      const lines = result.value.split("\n").filter((l) => l.trim());
      const nodes = lines
        .slice(0, 30)
        .map((line, i) => ({
          id: `h1-${i}`,
          title: line.slice(0, 100),
          level: 1,
          page_number: null,
          children: [],
        }));
      return nodes.length ? nodes : null;
    }
  } catch {
    return null;
  }
}
