// Kanoniczny handler uploadu dokumentu - wspolny dla single-document
// (routes/documents.ts) i dokumentow projektowych (routes/projects.ts).
//
// Historycznie istnialy dwie kopie tej logiki, ktore rozjechaly sie:
// sciezka projektowa NIE uruchamiala skanu input-security (ADR-0019/0020),
// przez co dokumenty wgrane do projektu omijaly detekcje prompt-injection /
// steganografii / homoglifow i nie mialy wpisu audytowego skanu. Pojedyncze
// zrodlo prawdy eliminuje te klase regresji (ADR rozszerzajacy ADR-0020 na
// sciezke projektowa).

import { uploadFile, storageKey } from "./storage";
import { docxToPdf, convertedPdfKey } from "./convert";
import { extractDocxBodyText } from "./docxTrackedChanges";
import { extractPdfText } from "./chat/pdf";
import { indexDocument } from "./retrieval/indexer";
import { appendAuditEvent } from "./audit";
import {
  analyzeInput,
  resolveIngestOutcome,
  toAuditPayload,
  INPUT_SECURITY_AUDIT_EVENT,
} from "./input-security";
import { createServerSupabase } from "./supabase";

const ALLOWED_TYPES = new Set(["pdf", "docx", "doc"]);

export async function handleDocumentUpload(
  req: import("express").Request,
  res: import("express").Response,
  userId: string,
  projectId: string | null,
  db: ReturnType<typeof createServerSupabase>,
) {
  const file = req.file;
  if (!file) return void res.status(400).json({ detail: "file is required" });

  const filename = file.originalname;
  const suffix = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
  if (!ALLOWED_TYPES.has(suffix))
    return void res
      .status(400)
      .json({
        detail: `Unsupported file type: ${suffix}. Allowed: pdf, docx, doc`,
      });

  const content = file.buffer;
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
  if (insertErr || !doc)
    return void res
      .status(500)
      .json({ detail: "Failed to create document record" });

  try {
    const docId = doc.id as string;
    const key = storageKey(userId, docId, filename);
    const contentType =
      suffix === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const rawBuf = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;

    // ADR-0019/0020: skan bezpieczenstwa wejscia PRZED utrwaleniem bajtow i
    // RAG-indeksacja. Deterministyczny, lokalny, zero-LLM. Wynik -> kolumny
    // documents.security_* + audit_log (zdarzenie input_security_scan).
    // blocked => bajty NIE trafiaja do storage (return przed uploadFile).
    let scanText = "";
    try {
      scanText =
        suffix === "pdf"
          ? await extractPdfText(rawBuf)
          : await extractDocxBodyText(content);
    } catch {
      // Ekstrakcja tekstu do skanu jest best-effort (np. skan bez warstwy
      // tekstowej); detektory binarne dzialaja na buforze niezaleznie.
    }
    const scan = analyzeInput({
      text: scanText,
      fileName: filename,
      declaredType: contentType,
      buffer: new Uint8Array(rawBuf),
    });
    const outcome = resolveIngestOutcome(scan);
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
      return void res.status(outcome.httpStatus).json({
        detail: "Dokument odrzucony: wykryto zagrozenie bezpieczenstwa wejscia.",
        security: {
          action: scan.action,
          threat_level: scan.threatLevel,
          report_id: scan.reportId,
        },
      });
    }

    await uploadFile(key, rawBuf, contentType);

    const tree = await extractStructureTree(rawBuf, suffix, filename);
    const pageCount = suffix === "pdf" ? await countPdfPages(rawBuf) : null;

    // Convert DOCX/DOC → PDF for display. PDFs are their own rendition.
    let pdfStoragePath: string | null = null;
    if (suffix === "docx" || suffix === "doc") {
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
        pdfStoragePath = pdfKey;
      } catch (err) {
        console.error(
          `[upload] DOCX→PDF conversion failed for ${filename}:`,
          err,
        );
      }
    } else if (suffix === "pdf") {
      pdfStoragePath = key;
    }

    // storage_path / pdf_storage_path live on document_versions now —
    // create the V1 "upload" row and point documents.current_version_id
    // at it.
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

    // ADR-0054: indeksacja do hybrid retrieval + graf cytowan. Tylko gdy skan
    // bezpieczenstwa dopuscil (outcome.allowIndex) - quarantined/human_review
    // NIE trafiaja do indeksu. Best-effort w tle: embedding trwa kilka sekund,
    // nie blokujemy odpowiedzi uploadu (dokument jest juz 'ready' i utrwalony).
    if (outcome.allowIndex && scanText.trim()) {
      void indexDocument(docId, scanText).catch((err) => {
        console.error(`[upload] RAG index failed for ${docId}:`, err);
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
    return void res.status(outcome.httpStatus).json(responseDoc);
  } catch (e) {
    await db.from("documents").update({ status: "error" }).eq("id", doc.id);
    return void res
      .status(500)
      .json({ detail: `Document processing failed: ${String(e)}` });
  }
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
