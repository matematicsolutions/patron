/**
 * Storage dokumentow PATRON. Dwa backendy (PATRON_STORAGE):
 *
 *   "fs" (default desktop) — lokalny filesystem pod %APPDATA%/PATRON/sprawy/
 *      (lub PATRON_STORAGE_DIR). Zero chmury, RODO-safe single-user.
 *      getSignedUrl zwraca wewnetrzny link /download/<HMAC-token> (downloadTokens).
 *
 *   "r2" (multi-tenant SaaS) — Cloudflare R2 (S3-compatible, @aws-sdk/client-s3).
 *      Env: R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *      R2_BUCKET_NAME (default "patron").
 *
 * Domyslnie "fs", chyba ze skonfigurowano R2 albo PATRON_STORAGE wymusza tryb.
 * Sygnatury eksportow sa stabilne - 30 call-site nie wie ktory backend dziala.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import os from "os";
import path from "path";
import { buildDownloadUrl } from "./downloadTokens";

const r2Configured = Boolean(
  process.env.R2_ENDPOINT_URL &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY,
);

const STORAGE_MODE = (
  process.env.PATRON_STORAGE || (r2Configured ? "r2" : "fs")
).toLowerCase();

const BUCKET = process.env.R2_BUCKET_NAME ?? "patron";

// Tryb fs jest zawsze "wlaczony" (FS lokalny dostepny); tryb r2 wymaga env.
export const storageEnabled = STORAGE_MODE === "fs" ? true : r2Configured;

let cachedClient: S3Client | undefined;

function getClient(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT_URL!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return cachedClient;
}

// ---------------------------------------------------------------------------
// FS backend helpers
// ---------------------------------------------------------------------------

function fsRoot(): string {
  if (process.env.PATRON_STORAGE_DIR) return process.env.PATRON_STORAGE_DIR;
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : path.join(os.homedir(), ".patron");
  return path.join(base, "PATRON", "sprawy");
}

/**
 * Mapuje klucz storage (np. "documents/<u>/<d>/source.pdf") na bezpieczna
 * sciezke pod fsRoot. Chroni przed path traversal (klucz spoza roota -> blad).
 */
function fsPathForKey(key: string): string {
  const root = path.resolve(fsRoot());
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`[storage] niedozwolony klucz (path traversal): ${key}`);
  }
  return full;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadFile(
  key: string,
  content: ArrayBuffer,
  contentType: string,
): Promise<void> {
  if (STORAGE_MODE === "fs") {
    const full = fsPathForKey(key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, Buffer.from(content));
    return;
  }
  if (!r2Configured) {
    throw new Error(
      "R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set",
    );
  }
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: Buffer.from(content),
      ContentType: contentType,
    }),
  );
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
  if (STORAGE_MODE === "fs") {
    try {
      const buf = await fs.promises.readFile(fsPathForKey(key));
      return buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
    } catch {
      return null;
    }
  }
  if (!r2Configured) return null;
  try {
    const client = getClient();
    const response = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    if (!response.Body) return null;
    const bytes = await response.Body.transformToByteArray();
    return bytes.buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Usuwa plik spod klucza. Zwraca `true`, gdy plik zostal usuniety, `false`, gdy
 * go juz nie bylo (ENOENT - idempotentnie). KAZDY inny blad RZUCA.
 *
 * Do 2026-10 tryb fs polykal kazdy blad unlink jako "ENOENT" (audyt D-03): plik
 * zablokowany przez inny proces (EBUSY/EPERM na Windows - antywirus, indeksator,
 * kopia zapasowa) zostawal na dysku, a "zapomnij sprawe" raportowala go jako
 * usuniety i kasowala rekord, ktory byl jedyna droga do niego. Wolajacy MUSI
 * teraz zdecydowac, co zrobic z porazka.
 *
 * Tryb r2: S3 DeleteObject nie mowi, czy obiekt istnial - zwraca `true`.
 */
export async function deleteFile(key: string): Promise<boolean> {
  if (STORAGE_MODE === "fs") {
    try {
      await fs.promises.unlink(fsPathForKey(key));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return false;
      throw e;
    }
  }
  if (!r2Configured) return false;
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  return true;
}

export interface PrefixDeleteResult {
  /** Liczba usunietych obiektow (w trybie fs: wpisow katalogu pasujacych do prefiksu). */
  deleted: number;
  /** Klucze, ktorych nie udalo sie usunac, z powodem. */
  failures: { key: string; error: string }[];
}

/**
 * Usuwa wszystkie obiekty, ktorych klucz zaczyna sie od `prefix` (semantyka
 * prefiksu S3). W trybie fs: wpisy katalogu `dirname(prefix)`, ktorych nazwa
 * zaczyna sie od `basename(prefix)` (plik albo caly podkatalog).
 *
 * Po co: pliki zapisywane W TLE (podglad PDF, R-TI-04) moga powstac, zanim ich
 * sciezka trafi do bazy - kasowanie wylacznie po sciezkach z document_versions
 * ich nie widzi. Prefiks lapie je niezaleznie od stanu bazy.
 *
 * Nie rzuca na pojedynczym obiekcie - porazki wraca w `failures`. Rzuca tylko na
 * niedozwolonym prefiksie (pusty, traversal) albo bledzie listowania.
 */
export async function deleteFilesByPrefix(
  prefix: string,
): Promise<PrefixDeleteResult> {
  const out: PrefixDeleteResult = { deleted: 0, failures: [] };
  const segments = prefix.split("/").filter(Boolean);
  // Bezpiecznik: prefiks kasujacy cale drzewo (np. "converted-pdfs/") to blad
  // wolajacego, nie zyczenie - wymagamy co najmniej <obszar>/<user>/<nazwa>.
  if (segments.length < 3 || prefix.endsWith("/")) {
    throw new Error(`[storage] prefiks zbyt szeroki: ${prefix}`);
  }
  if (STORAGE_MODE === "fs") {
    const full = fsPathForKey(prefix);
    const dir = path.dirname(full);
    const base = path.basename(full);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return out;
      throw e;
    }
    for (const entry of entries) {
      if (!entry.name.startsWith(base)) continue;
      const target = path.join(dir, entry.name);
      const key = [...segments.slice(0, -1), entry.name].join("/");
      try {
        if (entry.isDirectory()) {
          await fs.promises.rm(target, { recursive: true });
        } else {
          await fs.promises.unlink(target);
        }
        out.deleted++;
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === "ENOENT") continue;
        out.failures.push({ key, error: errorCode(e) });
      }
    }
    return out;
  }
  if (!r2Configured) return out;
  const client = getClient();
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of page.Contents ?? []) {
      if (!obj.Key) continue;
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }),
        );
        out.deleted++;
      } catch (e) {
        out.failures.push({ key: obj.Key, error: errorCode(e) });
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Krotki opis bledu do raportu: kod systemowy (EBUSY/EPERM) albo komunikat. */
export function errorCode(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string" && code) return code;
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Signed URL (tryb fs: wewnetrzny HMAC-link; tryb r2: presigned S3 URL)
// ---------------------------------------------------------------------------

export async function getSignedUrl(
  key: string,
  expiresIn = 3600,
  downloadFilename?: string,
): Promise<string | null> {
  if (STORAGE_MODE === "fs") {
    // Link wewnetrzny /download/<token> - route streamuje z FS przez downloadFile.
    // HMAC-podpisany, bez wygasania (CORS/presign niepotrzebne lokalnie).
    return buildDownloadUrl(key, downloadFilename ?? path.basename(key));
  }
  if (!r2Configured) return null;
  try {
    const client = getClient();
    // Override the response Content-Disposition so the browser uses this
    // filename on download, instead of the last path segment of the R2 key
    // (which includes the document UUID). The `download` attribute on <a>
    // is ignored for cross-origin URLs, so we have to set it server-side.
    const responseContentDisposition = downloadFilename
      ? buildContentDisposition("attachment", downloadFilename)
      : undefined;
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: responseContentDisposition,
    });
    return await awsGetSignedUrl(client, command, { expiresIn });
  } catch {
    return null;
  }
}

export function normalizeDownloadFilename(name: string): string {
  const trimmed = name.trim();
  const base = trimmed || "download";
  return base.replace(/[\x00-\x1F\x7F]/g, "_").replace(/[\\/]/g, "_");
}

export function sanitizeDispositionFilename(name: string): string {
  return normalizeDownloadFilename(name)
    .replace(/["\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_");
}

export function encodeRFC5987(str: string): string {
  return encodeURIComponent(str).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export function buildContentDisposition(
  kind: "inline" | "attachment",
  filename: string,
): string {
  const normalized = normalizeDownloadFilename(filename);
  return `${kind}; filename="${sanitizeDispositionFilename(normalized)}"; filename*=UTF-8''${encodeRFC5987(normalized)}`;
}

// ---------------------------------------------------------------------------
// Storage key helpers
// ---------------------------------------------------------------------------

export function storageKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/source${storageExtension(filename, ".bin")}`;
}

export function pdfStorageKey(
  userId: string,
  docId: string,
  stem: string,
): string {
  return `documents/${userId}/${docId}/${stem}.pdf`;
}

export function generatedDocKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `generated/${userId}/${docId}/generated${storageExtension(filename, ".docx")}`;
}

export function versionStorageKey(
  userId: string,
  docId: string,
  versionSlug: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/versions/${versionSlug}${storageExtension(filename, ".bin")}`;
}

function storageExtension(filename: string, fallback: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return fallback;
  const ext = filename.slice(lastDot).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : fallback;
}
