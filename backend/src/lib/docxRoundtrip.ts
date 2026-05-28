// Word import roundtrip (ADR-0060) - strona ODCZYTU edytowanego DOCX wracajacego
// z Worda. Komplementarne do docxTrackedChanges.ts (strona ZAPISU/eksportu).
//
// Beata edytuje pismo w Wordzie (tracked changes + komentarze), wrzuca z powrotem
// -> PATRON parsuje co zmienila (uczenie stylu przez Bibliotekarza) i wykrywa
// komentarze-jako-instrukcje [PATRON: ...] do wykonania.

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

type XNode = Record<string, unknown>;
const ATTR_KEY = ":@";
const TEXT_KEY = "#text";

function elName(n: unknown): string | null {
  if (!n || typeof n !== "object") return null;
  for (const k of Object.keys(n as XNode)) {
    if (k === ATTR_KEY || k === TEXT_KEY) continue;
    return k;
  }
  return null;
}

function elChildren(n: unknown): XNode[] {
  const name = elName(n);
  if (!name) return [];
  const v = (n as XNode)[name];
  return Array.isArray(v) ? (v as XNode[]) : [];
}

function elAttrs(n: unknown): Record<string, string> {
  if (!n || typeof n !== "object") return {};
  return ((n as XNode)[ATTR_KEY] as Record<string, string>) ?? {};
}

/** Rekurencyjnie zbiera tekst z w:t / w:delText pod wezlem. */
function collectText(n: unknown): string {
  const name = elName(n);
  let out = "";
  if (name === "w:t" || name === "w:delText") {
    for (const c of elChildren(n)) {
      if (typeof (c as XNode)[TEXT_KEY] === "string") {
        out += String((c as XNode)[TEXT_KEY]);
      }
    }
    return out;
  }
  for (const c of elChildren(n)) out += collectText(c);
  return out;
}

function createParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: false,
    processEntities: true,
    // Tekst zostaje stringiem - inaczej numeryczne w:t ("5000") staja sie
    // liczbami i wypadaja z ekstrakcji tekstu.
    parseTagValue: false,
  });
}

function getEntry(zip: JSZip, pathSlash: string) {
  return zip.file(pathSlash) ?? zip.file(pathSlash.replace(/\//g, "\\"));
}

export interface TrackedChange {
  kind: "ins" | "del";
  author: string | null;
  date: string | null;
  text: string;
  w_id: string | null;
}

export interface DocxComment {
  id: string | null;
  author: string | null;
  date: string | null;
  text: string;
  /** Jezeli komentarz to instrukcja [PATRON: ...], tu jest jej tresc. */
  instruction: string | null;
}

export interface RoundtripResult {
  trackedChanges: TrackedChange[];
  comments: DocxComment[];
  /** Instrukcje [PATRON: ...] wyciagniete z komentarzy (subset comments). */
  instructions: string[];
}

const PATRON_INSTRUCTION_RE = /^\s*\[\s*PATRON\s*:\s*([\s\S]+?)\s*\]\s*$/i;

/** Pure: wykrywa komentarz-instrukcje [PATRON: tresc]. Zwraca tresc lub null. */
export function detectPatronInstruction(commentText: string): string | null {
  const m = (commentText ?? "").match(PATRON_INSTRUCTION_RE);
  return m ? m[1].trim() : null;
}

/** Parsuje tracked changes (w:ins/w:del) z word/document.xml. */
export async function parseTrackedChanges(
  bytes: Buffer,
): Promise<TrackedChange[]> {
  const zip = await JSZip.loadAsync(bytes);
  const file = getEntry(zip, "word/document.xml");
  if (!file) return [];
  const tree = createParser().parse(await file.async("string")) as XNode[];
  const out: TrackedChange[] = [];
  const visit = (n: unknown) => {
    const name = elName(n);
    if (!name) return;
    if (name === "w:ins" || name === "w:del") {
      const a = elAttrs(n);
      out.push({
        kind: name === "w:ins" ? "ins" : "del",
        author: a["@_w:author"] ?? null,
        date: a["@_w:date"] ?? null,
        text: collectText(n),
        w_id: a["@_w:id"] ?? null,
      });
    }
    for (const c of elChildren(n)) visit(c);
  };
  for (const top of tree) visit(top);
  return out;
}

/** Parsuje komentarze (word/comments.xml) + wykrywa instrukcje [PATRON: ...]. */
export async function parseComments(bytes: Buffer): Promise<DocxComment[]> {
  const zip = await JSZip.loadAsync(bytes);
  const file = getEntry(zip, "word/comments.xml");
  if (!file) return [];
  const tree = createParser().parse(await file.async("string")) as XNode[];
  const out: DocxComment[] = [];
  const visit = (n: unknown) => {
    const name = elName(n);
    if (!name) return;
    if (name === "w:comment") {
      const a = elAttrs(n);
      const text = collectText(n).trim();
      out.push({
        id: a["@_w:id"] ?? null,
        author: a["@_w:author"] ?? null,
        date: a["@_w:date"] ?? null,
        text,
        instruction: detectPatronInstruction(text),
      });
      return;
    }
    for (const c of elChildren(n)) visit(c);
  };
  for (const top of tree) visit(top);
  return out;
}

/**
 * Pelny odczyt edytowanego DOCX: tracked changes + komentarze + instrukcje
 * [PATRON: ...]. Zywa sciezka: Bibliotekarz uczy sie stylu z trackedChanges,
 * model wykonuje instructions.
 */
export async function parseDocxRoundtrip(
  bytes: Buffer,
): Promise<RoundtripResult> {
  const [trackedChanges, comments] = await Promise.all([
    parseTrackedChanges(bytes),
    parseComments(bytes),
  ]);
  const instructions = comments
    .map((c) => c.instruction)
    .filter((i): i is string => !!i);
  return { trackedChanges, comments, instructions };
}
