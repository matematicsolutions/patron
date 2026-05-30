/**
 * DOCX comment emission (ADR-0077).
 *
 * Inspiracja: ocena #83 anylegal-ai/anylegal-oss (MIT + Additional Terms) -
 * WZORZEC "comments" z ich listy edit_document, NIE kod. Implementacja
 * clean-room na wlasnej maszynerii kotwiczenia (docxTrackedChanges.ts).
 * Patrz THIRD_PARTY_INSPIRATIONS.md.
 *
 * `applyDocxComments` attaches Word review comments (margin annotations) to
 * anchored spans of a .docx. It is the WRITE side that mirrors
 * `parseComments` in docxRoundtrip.ts (the READ side): a comment emitted here
 * round-trips back through that parser, and through Word's review pane.
 *
 * Why a separate primitive from tracked changes: a legal reviewer flags far
 * more than they rewrite. "Rozwaz czy ten zapis nie jest abuzywny", "brak
 * klauzuli RODO", "sprawdz sygnature" are observations ABOUT a passage, not
 * edits TO it. `applyTrackedEdits` can only express review as w:ins/w:del
 * (a rewrite). This lets the Recenzent / Adwokat diabla surface a finding
 * without touching the text.
 *
 * Anchoring reuses the exact paragraph flattening + whitespace-normalized
 * matcher from docxTrackedChanges.ts, so a comment lands on the same span a
 * model would name for an edit, with the same multi-strategy context
 * fallback (full context -> half -> find-only-if-globally-unique).
 *
 * OOXML plumbing emitted so Word actually opens the comments:
 *   1. word/comments.xml          - the comment bodies (created or extended).
 *   2. word/document.xml          - w:commentRangeStart / End + reference run
 *                                   bracketing the anchored span.
 *   3. [Content_Types].xml        - Override for the comments part.
 *   4. word/_rels/document.xml.rels - relationship document.xml -> comments.xml.
 *
 * Conservative guard (v1): a comment whose anchored span overlaps an existing
 * tracked change (w:ins/w:del) or other non-run inline is rejected with a
 * clear error rather than silently corrupting that markup. The dominant
 * review flow comments on clean spans; emitting comments and redlines over
 * the SAME span is a reservation (ADR-0077).
 */

import JSZip from "jszip";
import {
    elName,
    elChildren,
    setChildren,
    makeEl,
    makeText,
    buildRun,
    flattenParagraph,
    normalizeWs,
    findUniqueAnchor,
    mapNormRangeToOriginal,
    createParser,
    createBuilder,
    findBody,
    getZipEntry,
    setZipEntry,
    ensureXmlDeclaration,
    type Flattened,
} from "./docxTrackedChanges";

type XNode = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CommentInput {
    /** Verbatim text the comment is anchored to (the highlighted span). */
    find: string;
    /** Text immediately before `find`, to disambiguate the anchor. */
    context_before: string;
    /** Text immediately after `find`, to disambiguate the anchor. */
    context_after: string;
    /** The comment body shown in the Word review pane. */
    text: string;
}

export interface AppliedComment {
    /** w:id assigned to the comment (shared by range markers + body). */
    id: string;
    anchoredText: string;
    text: string;
    contextBefore: string;
    contextAfter: string;
}

export interface CommentError {
    index: number;
    reason: string;
}

export interface ApplyDocxCommentsResult {
    bytes: Buffer;
    comments: AppliedComment[];
    errors: CommentError[];
}

const COMMENTS_CT =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const COMMENTS_REL_TYPE =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS =
    "http://schemas.openxmlformats.org/package/2006/relationships";

// ---------------------------------------------------------------------------
// Paragraph collection (mirrors applyTrackedEdits' body traversal)
// ---------------------------------------------------------------------------

interface ParagraphRef {
    paraNode: XNode;
    paraChildren: XNode[];
    flat: Flattened;
}

function collectParagraphs(nodes: XNode[], out: ParagraphRef[]): void {
    for (const n of nodes) {
        const name = elName(n);
        if (!name) continue;
        if (name === "w:p") {
            const kids = elChildren(n);
            out.push({ paraNode: n, paraChildren: kids, flat: flattenParagraph(kids) });
        } else if (
            name === "w:tbl" ||
            name === "w:tr" ||
            name === "w:tc" ||
            name === "w:sdt" ||
            name === "w:sdtContent"
        ) {
            collectParagraphs(elChildren(n), out);
        }
    }
}

// ---------------------------------------------------------------------------
// Anchor location (same multi-strategy fallback as tracked edits)
// ---------------------------------------------------------------------------

interface Located {
    paraIdx: number;
    start: number; // original paragraph-text offset (inclusive)
    end: number; // original paragraph-text offset (exclusive)
}

/**
 * Locate `find` (+ optional context) in exactly one paragraph. Tries the
 * strictest context first and relaxes, requiring a globally unique hit at
 * each stage. Returns the original-text [start, end) range or a reason.
 *
 * NOTE: this duplicates the ~25-line strategy loop inlined in
 * applyTrackedEdits. ADR-0077 reserves lifting both onto a shared
 * docxOoxml.locateUniqueAnchor.
 */
function locate(
    paraNorms: { norm: string; origIdx: number[] }[],
    paragraphs: ParagraphRef[],
    find: string,
    ctxBefore: string,
    ctxAfter: string,
): Located | { error: string } {
    const findNorm = normalizeWs(find).norm;
    const cbNorm = normalizeWs(ctxBefore).norm;
    const caNorm = normalizeWs(ctxAfter).norm;

    type Hit = { paraIdx: number; normStart: number; normEnd: number };

    const tryStrategy = (
        cb: string,
        ca: string,
    ): { kind: "ok"; hits: Hit[] } | { kind: "ambiguous" } => {
        const hits: Hit[] = [];
        let ambiguous = false;
        for (let pi = 0; pi < paragraphs.length; pi++) {
            const r = findUniqueAnchor(paraNorms[pi].norm, findNorm, cb, ca);
            if ("error" in r) {
                if (r.error === "ambiguous") ambiguous = true;
                continue;
            }
            hits.push({ paraIdx: pi, normStart: r.start, normEnd: r.end });
        }
        if (ambiguous || hits.length > 1) return { kind: "ambiguous" };
        return { kind: "ok", hits };
    };

    const attempts = [
        { cb: cbNorm, ca: caNorm },
        { cb: cbNorm, ca: "" },
        { cb: "", ca: caNorm },
        { cb: "", ca: "" },
    ];
    let sawAmbiguous = false;
    let selected: Hit | null = null;
    for (const { cb, ca } of attempts) {
        const r = tryStrategy(cb, ca);
        if (r.kind === "ambiguous") {
            sawAmbiguous = true;
            continue;
        }
        if (r.hits.length === 1) {
            selected = r.hits[0];
            break;
        }
    }

    if (!selected) {
        return {
            error: sawAmbiguous
                ? `Ambiguous anchor for find="${truncate(find, 80)}". Add longer context_before / context_after.`
                : `Could not locate find="${truncate(find, 80)}". Copy the span verbatim (punctuation & whitespace included).`,
        };
    }

    const paraNorm = paraNorms[selected.paraIdx];
    const origLen = paragraphs[selected.paraIdx].flat.paraText.length;
    const { start, end } = mapNormRangeToOriginal(
        paraNorm as { norm: string; origIdx: number[] },
        origLen,
        selected.normStart,
        selected.normEnd,
    );
    return { paraIdx: selected.paraIdx, start, end };
}

// ---------------------------------------------------------------------------
// Paragraph reconstruction: insert comment range markers
// ---------------------------------------------------------------------------

interface ParaComment {
    start: number; // original paraText offset (inclusive)
    end: number; // original paraText offset (exclusive)
    wId: string;
}

function referenceRun(wId: string): XNode {
    return makeEl("w:r", [
        makeEl("w:rPr", [makeEl("w:rStyle", [], { "w:val": "CommentReference" })]),
        makeEl("w:commentReference", [], { "w:id": wId }),
    ]);
}

/**
 * Insert commentRangeStart / commentRangeEnd (+ reference run) for the given
 * comments into a paragraph. Returns the new children array, or null if the
 * touched span overlaps non-run markup (existing tracked changes etc.) — the
 * caller turns null into a per-comment error.
 *
 * All comments handed here belong to the same paragraph and are applied in a
 * single rebuild, so overlapping anchors are fine (range markers are points).
 */
function insertCommentRanges(
    flat: Flattened,
    paraChildren: XNode[],
    comments: ParaComment[],
): XNode[] | null {
    // Run-index span the markers touch (boundary runs included so a marker at
    // the very edge still has a run to sit beside).
    let firstRunIdx = flat.runs.length;
    let lastRunIdx = -1;
    const consider = (pos: number) => {
        const p = pos >= flat.paraText.length ? flat.paraText.length - 1 : pos < 0 ? 0 : pos;
        if (p < 0 || flat.paraText.length === 0) return;
        const r = flat.charRun[p];
        if (r < firstRunIdx) firstRunIdx = r;
        if (r > lastRunIdx) lastRunIdx = r;
    };
    for (const c of comments) {
        if (c.end > c.start) {
            for (let pos = c.start; pos < c.end; pos++) consider(pos);
        } else {
            consider(c.start);
        }
    }
    if (firstRunIdx > lastRunIdx) return null; // empty paragraph — nothing to anchor

    const startChildIdx = flat.runs[firstRunIdx].childIndex;
    const endChildIdx = flat.runs[lastRunIdx].childIndex;

    // Guard: only plain w:r children may sit in the rebuilt span. Anything
    // else (w:ins, w:del, w:hyperlink, pre-existing commentRange, bookmark)
    // would be dropped or corrupted by the rebuild — reject instead.
    for (let i = startChildIdx; i <= endChildIdx; i++) {
        if (elName(paraChildren[i]) !== "w:r") return null;
    }

    const firstRun = flat.runs[firstRunIdx];
    const lastRun = flat.runs[lastRunIdx];
    const spanStart = firstRun.textNodes.length > 0 ? firstRun.textNodes[0].paraStart : 0;
    const spanEnd =
        lastRun.textNodes.length > 0
            ? lastRun.textNodes[lastRun.textNodes.length - 1].paraEnd
            : spanStart;

    // Insertion events keyed by paraText offset. Ends (+ ref runs) emit before
    // starts at the same boundary so adjacent comments nest cleanly.
    const startsAt = new Map<number, string[]>();
    const endsAt = new Map<number, string[]>();
    for (const c of comments) {
        (startsAt.get(c.start) ?? startsAt.set(c.start, []).get(c.start)!).push(c.wId);
        (endsAt.get(c.end) ?? endsAt.set(c.end, []).get(c.end)!).push(c.wId);
    }

    const newRunGroup: XNode[] = [];
    let cursor = spanStart;

    const emitNormal = (a: number, b: number) => {
        if (a >= b) return;
        let i = a;
        while (i < b) {
            const runIdx = flat.charRun[i];
            const tnIdx = flat.charTextNode[i];
            let j = i + 1;
            while (j < b && flat.charRun[j] === runIdx && flat.charTextNode[j] === tnIdx) j++;
            const slot = flat.runs[runIdx];
            newRunGroup.push(buildRun(slot.rPr, flat.paraText.slice(i, j), "w:t"));
            i = j;
        }
    };

    const boundaries = new Set<number>([...startsAt.keys(), ...endsAt.keys()]);
    const sorted = [...boundaries].filter((o) => o >= spanStart && o <= spanEnd).sort((a, b) => a - b);
    for (const off of sorted) {
        emitNormal(cursor, off);
        cursor = off;
        for (const wId of endsAt.get(off) ?? []) {
            newRunGroup.push(makeEl("w:commentRangeEnd", [], { "w:id": wId }));
            newRunGroup.push(referenceRun(wId));
        }
        for (const wId of startsAt.get(off) ?? []) {
            newRunGroup.push(makeEl("w:commentRangeStart", [], { "w:id": wId }));
        }
    }
    emitNormal(cursor, spanEnd);

    // Splice: replace the touched w:r children with newRunGroup, keep the rest.
    const dropped = new Set<number>();
    for (let r = firstRunIdx; r <= lastRunIdx; r++) dropped.add(flat.runs[r].childIndex);
    const out: XNode[] = [];
    for (let i = 0; i < paraChildren.length; i++) {
        if (i === startChildIdx) for (const n of newRunGroup) out.push(n);
        if (dropped.has(i)) continue;
        out.push(paraChildren[i]);
    }
    return out;
}

// ---------------------------------------------------------------------------
// comments.xml / [Content_Types].xml / rels plumbing
// ---------------------------------------------------------------------------

function xmlEscapeText(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function xmlEscapeAttr(s: string): string {
    return xmlEscapeText(s).replace(/"/g, "&quot;");
}

/** Build the inner <w:p> runs of a comment body, mapping \n to soft breaks. */
function commentBodyRuns(text: string): string {
    const segments = text.split("\n");
    let runs = "";
    for (let i = 0; i < segments.length; i++) {
        let inner = "";
        if (i > 0) inner += "<w:br/>";
        if (segments[i].length > 0) {
            inner += `<w:t xml:space="preserve">${xmlEscapeText(segments[i])}</w:t>`;
        }
        if (inner) runs += `<w:r>${inner}</w:r>`;
    }
    if (!runs) runs = `<w:r><w:t xml:space="preserve"></w:t></w:r>`;
    return runs;
}

function commentElement(c: {
    id: string;
    author: string;
    date: string;
    initials: string;
    text: string;
}): string {
    return (
        `<w:comment w:id="${xmlEscapeAttr(c.id)}" w:author="${xmlEscapeAttr(c.author)}"` +
        ` w:date="${xmlEscapeAttr(c.date)}" w:initials="${xmlEscapeAttr(c.initials)}">` +
        `<w:p>${commentBodyRuns(c.text)}</w:p>` +
        `</w:comment>`
    );
}

/** Highest existing w:id="N" in a comments.xml string, or -1 if none. */
function maxCommentId(commentsXml: string): number {
    let max = -1;
    const re = /w:id="(\d+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(commentsXml)) !== null) {
        const v = parseInt(m[1], 10);
        if (Number.isFinite(v) && v > max) max = v;
    }
    return max;
}

function emptyCommentsXml(): string {
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:comments xmlns:w="${W_NS}"></w:comments>`
    );
}

function appendComments(commentsXml: string, elements: string[]): string {
    const joined = elements.join("");
    if (commentsXml.includes("</w:comments>")) {
        return commentsXml.replace("</w:comments>", `${joined}</w:comments>`);
    }
    // Self-closed or malformed root — fall back to a fresh container.
    return emptyCommentsXml().replace("</w:comments>", `${joined}</w:comments>`);
}

function ensureContentTypeOverride(ctXml: string): string {
    if (ctXml.includes(COMMENTS_CT)) return ctXml;
    const override = `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>`;
    if (ctXml.includes("</Types>")) {
        return ctXml.replace("</Types>", `${override}</Types>`);
    }
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="${CT_NS}">${override}</Types>`
    );
}

function ensureCommentsRelationship(relsXml: string | null): string {
    const base =
        relsXml ??
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<Relationships xmlns="${REL_NS}"></Relationships>`;
    if (base.includes(COMMENTS_REL_TYPE)) return base;
    let maxRid = 0;
    const re = /Id="rId(\d+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(base)) !== null) {
        const v = parseInt(m[1], 10);
        if (Number.isFinite(v) && v > maxRid) maxRid = v;
    }
    const rid = `rId${maxRid + 1}`;
    const rel = `<Relationship Id="${rid}" Type="${COMMENTS_REL_TYPE}" Target="comments.xml"/>`;
    if (base.includes("</Relationships>")) {
        return base.replace("</Relationships>", `${rel}</Relationships>`);
    }
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="${REL_NS}">${rel}</Relationships>`
    );
}

// ---------------------------------------------------------------------------
// Main: applyDocxComments
// ---------------------------------------------------------------------------

export async function applyDocxComments(
    bytes: Buffer,
    comments: CommentInput[],
    opts?: { author?: string; initials?: string },
): Promise<ApplyDocxCommentsResult> {
    const author = opts?.author ?? "PATRON";
    const initials = opts?.initials ?? "PAT";
    const now = new Date().toISOString();

    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = getZipEntry(zip, "word/document.xml");
    if (!docXmlFile) throw new Error("document.xml missing from docx");
    const docXmlRaw = await docXmlFile.async("string");

    const parser = createParser();
    const tree = parser.parse(docXmlRaw) as XNode[];
    const bodyChildren = findBody(tree);
    if (!bodyChildren) throw new Error("w:body missing from document.xml");

    const paragraphs: ParagraphRef[] = [];
    collectParagraphs(bodyChildren, paragraphs);
    const paraNorms = paragraphs.map((p) => normalizeWs(p.flat.paraText));

    // Next comment id starts above any existing comment.
    const existingCommentsFile = getZipEntry(zip, "word/comments.xml");
    const existingCommentsXml = existingCommentsFile
        ? await existingCommentsFile.async("string")
        : null;
    let nextId = (existingCommentsXml ? maxCommentId(existingCommentsXml) : -1) + 1;

    const applied: AppliedComment[] = [];
    const errors: CommentError[] = [];
    const perParagraph = new Map<number, ParaComment[]>();
    const newCommentElements: string[] = [];

    for (let idx = 0; idx < comments.length; idx++) {
        const c = comments[idx];
        const find = c.find ?? "";
        const text = c.text ?? "";
        if (!find) {
            errors.push({ index: idx, reason: "Comment requires a non-empty find anchor." });
            continue;
        }
        if (!text.trim()) {
            errors.push({ index: idx, reason: "Comment body is empty." });
            continue;
        }
        const loc = locate(
            paraNorms,
            paragraphs,
            find,
            c.context_before ?? "",
            c.context_after ?? "",
        );
        if ("error" in loc) {
            errors.push({ index: idx, reason: loc.error });
            continue;
        }
        if (loc.end <= loc.start) {
            errors.push({ index: idx, reason: "Comment anchor resolved to an empty span." });
            continue;
        }

        const wId = String(nextId);
        const para = perParagraph.get(loc.paraIdx) ?? [];
        para.push({ start: loc.start, end: loc.end, wId });
        perParagraph.set(loc.paraIdx, para);

        nextId++;
        newCommentElements.push(
            commentElement({ id: wId, author, date: now, initials, text: text.trim() }),
        );
        applied.push({
            id: wId,
            anchoredText: paragraphs[loc.paraIdx].flat.paraText.slice(loc.start, loc.end),
            text: text.trim(),
            contextBefore: c.context_before ?? "",
            contextAfter: c.context_after ?? "",
        });
    }

    // Apply range markers per paragraph. A paragraph whose span overlaps
    // existing markup yields null -> roll back those comments to errors.
    for (const [paraIdx, paraComments] of perParagraph) {
        const p = paragraphs[paraIdx];
        const newKids = insertCommentRanges(p.flat, p.paraChildren, paraComments);
        if (newKids === null) {
            for (const pc of paraComments) {
                const ai = applied.findIndex((a) => a.id === pc.wId);
                if (ai >= 0) applied.splice(ai, 1);
                const ei = newCommentElements.findIndex((e) => e.includes(`w:id="${pc.wId}"`));
                if (ei >= 0) newCommentElements.splice(ei, 1);
                errors.push({
                    index: -1,
                    reason: `Comment anchor "${truncate(
                        p.flat.paraText.slice(pc.start, pc.end),
                        60,
                    )}" overlaps existing tracked changes or inline markup; comment skipped.`,
                });
            }
            continue;
        }
        setChildren(p.paraNode, newKids);
    }

    if (applied.length === 0) {
        // Nothing landed — return original bytes unchanged.
        return { bytes, comments: [], errors };
    }

    // Write document.xml back.
    const builder = createBuilder();
    setZipEntry(zip, "word/document.xml", ensureXmlDeclaration(builder.build(tree)));

    // comments.xml (create or extend).
    const baseComments = existingCommentsXml ?? emptyCommentsXml();
    setZipEntry(zip, "word/comments.xml", appendComments(baseComments, newCommentElements));

    // [Content_Types].xml override.
    const ctFile = zip.file("[Content_Types].xml");
    if (ctFile) {
        const ctXml = await ctFile.async("string");
        zip.file("[Content_Types].xml", ensureContentTypeOverride(ctXml));
    } else {
        zip.file("[Content_Types].xml", ensureContentTypeOverride(""));
    }

    // word/_rels/document.xml.rels relationship.
    const relsFile = getZipEntry(zip, "word/_rels/document.xml.rels");
    const relsXml = relsFile ? await relsFile.async("string") : null;
    setZipEntry(
        zip,
        "word/_rels/document.xml.rels",
        ensureCommentsRelationship(relsXml),
    );

    const outBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return { bytes: outBuf, comments: applied, errors };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
}
