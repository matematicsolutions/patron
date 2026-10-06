/**
 * DOCX tracked-changes helpers.
 *
 * `applyTrackedEdits` rewrites a .docx so that the requested substitutions
 * appear as `<w:ins>` / `<w:del>` tracked changes rather than direct text
 * replacements. `resolveTrackedChange` accepts or rejects one change by
 * its `w:id`, producing a new .docx with only that change collapsed.
 *
 * Only text inside `<w:p><w:r><w:t>` is considered. Headers, footers,
 * comments, footnotes are left alone. Pre-existing tracked changes in the
 * paragraph are presented to the matcher in *accepted view*: w:ins runs are
 * treated as normal text, w:del wrappers are invisible. When a new edit's
 * range lands on runs inside a pre-existing w:ins, the wrapper is dropped
 * (accepting that insertion; all of its runs are kept) before the new change
 * is emitted.
 *
 * Invariant (audit D-09): an edit never removes anything it does not wrap in
 * a w:del. Non-text content (w:tab, w:br, w:footnoteReference, w:fldChar,
 * w:drawing, bookmarks, hyperlinks, pre-existing w:del ...) is tracked as
 * zero-width positional elements and re-emitted in place; a deletion that
 * would have to swallow one that a w:del cannot carry safely is refused
 * with an explicit per-edit error instead.
 */

import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import fastDiff from "fast-diff";

// ---------------------------------------------------------------------------
// JSZip path helpers
// ---------------------------------------------------------------------------
//
// Some older Windows/Word archives store entries with backslash path
// separators (e.g. `word\document.xml`) even though the zip spec requires
// forward slashes. JSZip looks up entries by exact string, so
// `zip.file("word/document.xml")` misses those files. These helpers accept
// the canonical forward-slash form and transparently fall back to the
// backslash variant for both reads and writes.

function getZipEntry(zip: JSZip, pathSlash: string) {
    const direct = zip.file(pathSlash);
    if (direct) return direct;
    return zip.file(pathSlash.replace(/\//g, "\\"));
}

function setZipEntry(
    zip: JSZip,
    pathSlash: string,
    content: string | Buffer,
): void {
    const backslash = pathSlash.replace(/\//g, "\\");
    // If the archive already stores the entry under backslashes, keep it
    // there so we don't emit both variants side by side.
    if (!zip.file(pathSlash) && zip.file(backslash)) {
        zip.file(backslash, content);
        return;
    }
    zip.file(pathSlash, content);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EditInput {
    find: string;
    replace: string;
    context_before: string;
    context_after: string;
    reason?: string;
}

export interface AppliedChange {
    id: string;
    delId?: string;
    insId?: string;
    deletedText: string;
    insertedText: string;
    contextBefore: string;
    contextAfter: string;
    reason?: string;
}

export interface EditError {
    index: number;
    reason: string;
}

export interface ApplyTrackedEditsResult {
    bytes: Buffer;
    changes: AppliedChange[];
    errors: EditError[];
}

// ---------------------------------------------------------------------------
// Preserve-order tree helpers
// ---------------------------------------------------------------------------

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

function isTextNode(n: unknown): n is { [TEXT_KEY]: string } {
    if (!n || typeof n !== "object") return false;
    const obj = n as XNode;
    return TEXT_KEY in obj && elName(n) === null;
}

function elChildren(n: unknown): XNode[] {
    const name = elName(n);
    if (!name) return [];
    const v = (n as XNode)[name];
    return Array.isArray(v) ? (v as XNode[]) : [];
}

function setChildren(n: XNode, children: XNode[]): void {
    const name = elName(n);
    if (!name) return;
    n[name] = children;
}

function elAttrs(n: unknown): Record<string, string> {
    if (!n || typeof n !== "object") return {};
    const a = (n as XNode)[ATTR_KEY];
    return (a as Record<string, string>) ?? {};
}

function makeEl(
    name: string,
    children: XNode[] = [],
    attrs?: Record<string, string>,
): XNode {
    const el: XNode = { [name]: children };
    if (attrs) {
        const attrObj: Record<string, string> = {};
        for (const [k, v] of Object.entries(attrs)) {
            attrObj[`@_${k}`] = v;
        }
        el[ATTR_KEY] = attrObj;
    }
    return el;
}

function makeText(s: string): XNode {
    return { [TEXT_KEY]: s };
}

function getTextContent(wtEl: XNode): string {
    // A w:t node has only a single text child (or nothing).
    const kids = elChildren(wtEl);
    let out = "";
    for (const k of kids) {
        if (isTextNode(k)) out += String(k[TEXT_KEY] ?? "");
    }
    return out;
}

// Build a w:r element that wraps a piece of text. Newlines in the text are
// emitted as <w:br/> soft line breaks (interleaved with w:t/w:delText
// segments) so models can request multi-line replacements without the
// literal "\n" showing up as visible text.
function buildRun(rPr: XNode | null, text: string, tagName: "w:t" | "w:delText"): XNode {
    const children: XNode[] = [];
    if (rPr) children.push(cloneNode(rPr));
    const segments = text.split("\n");
    for (let i = 0; i < segments.length; i++) {
        if (i > 0) children.push(makeEl("w:br", []));
        const seg = segments[i];
        if (seg.length > 0) {
            children.push(
                makeEl(tagName, [makeText(seg)], { "xml:space": "preserve" }),
            );
        }
    }
    return makeEl("w:r", children);
}

function cloneNode<T>(n: T): T {
    return JSON.parse(JSON.stringify(n)) as T;
}

// ---------------------------------------------------------------------------
// Paragraph flattening
// ---------------------------------------------------------------------------

//
// The matcher works on `paraText`: the concatenation of every w:t in the
// paragraph's runs (accepted view). Everything else a run or a paragraph can
// hold - w:tab, w:br, w:footnoteReference, w:fldChar, w:drawing, bookmarks,
// hyperlinks, pre-existing w:del ... - contributes NO characters, but it is
// recorded as a zero-width POSITIONAL element: `pos` is the paraText offset
// it sits at (between char pos-1 and char pos). Reconstruction (see
// `spanTokens`) walks the touched span in document order and re-emits every
// one of those elements at its position, so an edit never drops something it
// did not wrap in a w:del (audit D-09).

/**
 * Run-level children that may travel inside a tracked deletion: Word itself
 * emits them inside deleted runs, and rejecting the change restores them.
 * Any other run child (w:footnoteReference, w:fldChar, w:instrText,
 * w:drawing, w:commentReference, ...) blocks a deletion that would span it.
 */
const DELETABLE_RUN_ELEMENTS = new Set<string>([
    "w:tab",
    "w:br",
    "w:cr",
    "w:noBreakHyphen",
    "w:softHyphen",
    "w:sym",
    "w:ptab",
    "w:lastRenderedPageBreak",
]);

/**
 * Paragraph-level zero-width range markup that may sit inside a w:del
 * (EG_RangeMarkupElements, proofErr, perm*). Every other paragraph child
 * (w:hyperlink, w:fldSimple, w:sdt, w:smartTag, a pre-existing w:del, ...)
 * blocks a deletion that would span it.
 */
const DELETABLE_PARA_ELEMENTS = new Set<string>([
    "w:bookmarkStart",
    "w:bookmarkEnd",
    "w:commentRangeStart",
    "w:commentRangeEnd",
    "w:proofErr",
    "w:permStart",
    "w:permEnd",
    "w:moveFromRangeStart",
    "w:moveFromRangeEnd",
    "w:moveToRangeStart",
    "w:moveToRangeEnd",
    "w:customXmlInsRangeStart",
    "w:customXmlInsRangeEnd",
    "w:customXmlDelRangeStart",
    "w:customXmlDelRangeEnd",
    "w:customXmlMoveFromRangeStart",
    "w:customXmlMoveFromRangeEnd",
    "w:customXmlMoveToRangeStart",
    "w:customXmlMoveToRangeEnd",
]);

type RunItem =
    | { kind: "text"; tnIdx: number }
    | { kind: "atom"; node: XNode; pos: number };

interface RunSlot {
    childIndex: number;         // index in paragraph.children
    rEl: XNode;                 // the source w:r (reference)
    rPr: XNode | null;          // reference (not cloned)
    /** Per-w:t info, in run order. */
    textNodes: { wtEl: XNode; text: string; paraStart: number; paraEnd: number }[];
    /**
     * Every run child except w:rPr, in source order: w:t as `text` items,
     * anything else (w:tab, w:br, w:footnoteReference, w:fldChar, ...) as a
     * positional `atom`. Reconstruction replays this list, so no child of a
     * touched run is lost.
     */
    items: RunItem[];
}

/** A non-text element of the paragraph, with the paraText offset it sits at. */
interface PositionedElement {
    pos: number;
    name: string;
    level: "run" | "para";
    /** May it be carried inside a tracked deletion (w:del)? */
    deletable: boolean;
}

interface Flattened {
    paraText: string;
    // For each char index in paraText: which run slot + which textNode + offset within text
    charRun: Int32Array;      // runIdx
    charTextNode: Int32Array; // index into slot.textNodes
    charOffset: Int32Array;   // offset within that textNode.text
    runs: RunSlot[];          // order corresponds to their paragraph position
    /** paraText offset at which each top-level paragraph child starts. */
    childStart: number[];
    /** Non-text elements (run- and paragraph-level), in document order. */
    elements: PositionedElement[];
}

function flattenParagraph(paraChildren: XNode[]): Flattened {
    const runs: RunSlot[] = [];
    let paraText = "";
    const charRunArr: number[] = [];
    const charTextNodeArr: number[] = [];
    const charOffsetArr: number[] = [];
    const childStart: number[] = [];
    const elements: PositionedElement[] = [];

    const processRun = (rEl: XNode, topChildIdx: number) => {
        const rKids = elChildren(rEl);
        let rPr: XNode | null = null;
        const textNodes: RunSlot["textNodes"] = [];
        const items: RunItem[] = [];
        const runIdx = runs.length;
        for (const rk of rKids) {
            const name = elName(rk);
            if (!name) continue; // inter-element whitespace inside w:r
            if (name === "w:rPr") {
                rPr = rk;
            } else if (name === "w:t") {
                const txt = getTextContent(rk);
                const start = paraText.length;
                textNodes.push({
                    wtEl: rk,
                    text: txt,
                    paraStart: start,
                    paraEnd: start + txt.length,
                });
                const tnIdx = textNodes.length - 1;
                items.push({ kind: "text", tnIdx });
                paraText += txt;
                for (let i = 0; i < txt.length; i++) {
                    charRunArr.push(runIdx);
                    charTextNodeArr.push(tnIdx);
                    charOffsetArr.push(i);
                }
            } else {
                // w:tab, w:br, w:footnoteReference, w:fldChar, w:drawing ...
                const pos = paraText.length;
                items.push({ kind: "atom", node: rk, pos });
                elements.push({
                    pos,
                    name,
                    level: "run",
                    deletable: DELETABLE_RUN_ELEMENTS.has(name),
                });
            }
        }
        runs.push({ childIndex: topChildIdx, rEl, rPr, textNodes, items });
    };

    const paraElement = (node: XNode) => {
        const name = elName(node);
        if (!name) return;
        elements.push({
            pos: paraText.length,
            name,
            level: "para",
            deletable: DELETABLE_PARA_ELEMENTS.has(name),
        });
    };

    for (let ci = 0; ci < paraChildren.length; ci++) {
        childStart.push(paraText.length);
        const child = paraChildren[ci];
        const name = elName(child);
        if (name === "w:r") {
            processRun(child, ci);
        } else if (name === "w:ins") {
            // Accepted view: include inner runs as if bare. childIndex points
            // at the w:ins wrapper so reconstruction rewrites the wrapper
            // whole (accepting that insertion) when a new edit touches it.
            for (const inner of elChildren(child)) {
                if (elName(inner) === "w:r") processRun(inner, ci);
                else paraElement(inner);
            }
        } else if (name && name !== "w:pPr") {
            // w:del (accepted view: its text is invisible), bookmarks,
            // hyperlinks, fldSimple, sdt ... - zero-width positional elements.
            paraElement(child);
        }
    }

    return {
        paraText,
        charRun: Int32Array.from(charRunArr),
        charTextNode: Int32Array.from(charTextNodeArr),
        charOffset: Int32Array.from(charOffsetArr),
        runs,
        childStart,
        elements,
    };
}

/**
 * The first non-deletable element strictly inside (start, end) - one that a
 * tracked deletion of [start, end) would have to swallow. Elements sitting
 * exactly on a boundary stay outside the deletion and are kept in place.
 */
function blockingElementInRange(
    flat: Flattened,
    start: number,
    end: number,
): PositionedElement | null {
    if (end - start < 2) return null;
    for (const el of flat.elements) {
        if (el.pos > start && el.pos < end && !el.deletable) return el;
    }
    return null;
}

/** One piece of a paragraph span, in document order (see `spanTokens`). */
type SpanToken =
    | { kind: "text"; runIdx: number; start: number; end: number }
    | { kind: "runAtom"; runIdx: number; node: XNode; pos: number }
    | { kind: "paraNode"; node: XNode; pos: number };

/**
 * Tokenize paragraph children [startChildIdx, endChildIdx] in document
 * order. Text is split at every offset in `cuts`, so a text token never
 * straddles a cut. Non-text run children come out as `runAtom`, every other
 * paragraph child (and non-run children of a w:ins wrapper) as `paraNode`.
 * Re-emitting all tokens loses nothing but the w:r / w:ins wrappers
 * themselves (w:rPr is re-attached per run by `makeRunAppender`), empty w:t
 * and inter-element whitespace inside runs.
 */
function spanTokens(
    flat: Flattened,
    paraChildren: XNode[],
    startChildIdx: number,
    endChildIdx: number,
    cuts: number[],
): SpanToken[] {
    const runIdxByNode = new Map<XNode, number>();
    flat.runs.forEach((r, i) => runIdxByNode.set(r.rEl, i));
    const sortedCuts = [...new Set(cuts)].sort((a, b) => a - b);
    const tokens: SpanToken[] = [];
    let cur = flat.childStart[startChildIdx] ?? 0;

    const pushRun = (rEl: XNode) => {
        const runIdx = runIdxByNode.get(rEl);
        if (runIdx === undefined) return;
        const slot = flat.runs[runIdx];
        for (const it of slot.items) {
            if (it.kind === "atom") {
                tokens.push({ kind: "runAtom", runIdx, node: it.node, pos: it.pos });
                cur = it.pos;
                continue;
            }
            const tn = slot.textNodes[it.tnIdx];
            let a = tn.paraStart;
            for (const c of sortedCuts) {
                if (c <= a) continue;
                if (c >= tn.paraEnd) break;
                tokens.push({ kind: "text", runIdx, start: a, end: c });
                a = c;
            }
            if (a < tn.paraEnd) tokens.push({ kind: "text", runIdx, start: a, end: tn.paraEnd });
            cur = tn.paraEnd;
        }
    };

    for (let ci = startChildIdx; ci <= endChildIdx; ci++) {
        const child = paraChildren[ci];
        const name = elName(child);
        if (name === "w:r") {
            pushRun(child);
        } else if (name === "w:ins") {
            for (const inner of elChildren(child)) {
                if (elName(inner) === "w:r") pushRun(inner);
                else tokens.push({ kind: "paraNode", node: inner, pos: cur });
            }
        } else {
            tokens.push({ kind: "paraNode", node: child, pos: cur });
        }
    }
    return tokens;
}

/** w:t / w:delText children for a piece of text ("\n" -> w:br, as buildRun). */
function textRunChildren(text: string, tagName: "w:t" | "w:delText"): XNode[] {
    const out: XNode[] = [];
    const segments = text.split("\n");
    for (let i = 0; i < segments.length; i++) {
        if (i > 0) out.push(makeEl("w:br", []));
        if (segments[i].length > 0) {
            out.push(makeEl(tagName, [makeText(segments[i])], { "xml:space": "preserve" }));
        }
    }
    return out;
}

/**
 * Returns `append(target, runIdx, child)`: adds `child` to the run at the end
 * of `target` when this appender opened that run for the same source run,
 * otherwise opens a new w:r carrying the source run's w:rPr. Pushing anything
 * else (w:ins, w:del, a marker) onto `target` closes the open run.
 */
function makeRunAppender(flat: Flattened) {
    const origin = new WeakMap<XNode, number>();
    return (target: XNode[], runIdx: number, child: XNode): void => {
        const last = target[target.length - 1];
        if (last && origin.get(last) === runIdx) {
            (last["w:r"] as XNode[]).push(child);
            return;
        }
        const rPr = flat.runs[runIdx]?.rPr ?? null;
        const run = makeEl("w:r", rPr ? [cloneNode(rPr), child] : [child]);
        origin.set(run, runIdx);
        target.push(run);
    };
}

// ---------------------------------------------------------------------------
// Planning edits on a paragraph
// ---------------------------------------------------------------------------

/**
 * A single logical change. Spans a contiguous [start, end) character range in
 * the paragraph text (may be empty for a pure insert) and may carry an
 * inserted string appended at `start`.
 */
interface PlannedChange {
    editIndex: number;            // source edit index
    deleteStart: number;          // paragraph text offset (inclusive)
    deleteEnd: number;            // paragraph text offset (exclusive); may equal start
    deletedText: string;          // substring of paraText in [start, end)
    insertedText: string;         // may be empty
    contextBefore: string;
    contextAfter: string;
    reason?: string;
    changeId: string;             // logical id (not the w:id)
    delWId?: string;              // w:id of w:del wrapper (if deletedText non-empty)
    insWId?: string;              // w:id of w:ins wrapper (if insertedText non-empty)
    /**
     * Pure insertion only: the anchor text sits to the LEFT of the insertion
     * point (e.g. find="§ 1" -> replace="§ 1a"), so the w:ins goes right
     * after char deleteStart-1, before any zero-width element (w:tab, ...)
     * at that offset. Otherwise it goes right before char deleteStart.
     */
    insertLeft: boolean;
}

/**
 * Collapse a `fast-diff` result into a minimal `{deletedText, insertedText}`
 * tuple anchored at a single start position. `fast-diff` produces
 * sequences like EQ-DEL-EQ-INS. For tracked-change UI we want one
 * "replace this substring with that substring" card per edit, so we
 * merge everything into the outer span.
 */
function collapseDiff(find: string, replace: string): { deleted: string; inserted: string; leadingEq: number; trailingEq: number } {
    // Find leading/trailing common substrings so the tracked range is minimal
    let leading = 0;
    const minLen = Math.min(find.length, replace.length);
    while (leading < minLen && find[leading] === replace[leading]) leading++;
    let trailing = 0;
    while (
        trailing < minLen - leading &&
        find[find.length - 1 - trailing] === replace[replace.length - 1 - trailing]
    ) {
        trailing++;
    }
    const deleted = find.slice(leading, find.length - trailing);
    const inserted = replace.slice(leading, replace.length - trailing);
    return { deleted, inserted, leadingEq: leading, trailingEq: trailing };
}

// ---------------------------------------------------------------------------
// Paragraph reconstruction
// ---------------------------------------------------------------------------

/**
 * Given a paragraph's children and a sorted, non-overlapping list of
 * `PlannedChange`s that fall within it, return a new children array with
 * tracked changes inserted.
 *
 * Every paragraph child between the first and the last touched run is
 * re-emitted in document order (via `spanTokens`): untouched text and every
 * non-text element (w:tab, w:br, w:footnoteReference, bookmarks, a
 * pre-existing w:del ...) at its original position. Only text inside a
 * planned deletion changes - it moves into a w:del as w:delText, together
 * with any deletable zero-width element strictly inside it (planning has
 * already refused deletions that would swallow anything else). Untouched
 * runs of a pre-existing w:ins in the span are kept as plain runs (that
 * insertion is accepted), never dropped.
 */
function reconstructParagraph(
    paraChildren: XNode[],
    flat: Flattened,
    plan: PlannedChange[],
    now: string,
    author: string,
): XNode[] {
    if (plan.length === 0) return paraChildren;
    const textLen = flat.paraText.length;
    if (textLen === 0) return paraChildren;

    // Run index of the char at `pos`, clamped into the paragraph text.
    const runAt = (pos: number): number =>
        flat.charRun[Math.max(0, Math.min(textLen - 1, pos))];

    // Determine the run-index span that edits touch.
    let firstRunIdx = flat.runs.length;
    let lastRunIdx = -1;
    const touch = (r: number) => {
        if (r < firstRunIdx) firstRunIdx = r;
        if (r > lastRunIdx) lastRunIdx = r;
    };
    for (const p of plan) {
        for (let pos = p.deleteStart; pos < p.deleteEnd; pos++) touch(flat.charRun[pos]);
        // A pure insertion touches the run it inherits formatting from.
        if (p.deleteStart === p.deleteEnd) {
            touch(runAt(p.insertLeft && p.deleteStart > 0 ? p.deleteStart - 1 : p.deleteStart));
        }
    }
    if (firstRunIdx > lastRunIdx) return paraChildren;

    // Child-index range in paragraph.children we are going to rewrite.
    const startChildIdx = flat.runs[firstRunIdx].childIndex;
    const endChildIdx = flat.runs[lastRunIdx].childIndex;

    const cuts: number[] = [];
    for (const p of plan) cuts.push(p.deleteStart, p.deleteEnd);
    const tokens = spanTokens(flat, paraChildren, startChildIdx, endChildIdx, cuts);

    const out: XNode[] = [];
    let delInner: XNode[] | null = null;
    const target = (): XNode[] => delInner ?? out;
    const append = makeRunAppender(flat);
    const trackAttrs = (wId: string) => ({ "w:id": wId, "w:author": author, "w:date": now });

    // Events are keyed by position: 2*pos = "right after char pos-1" (before
    // any zero-width element at pos), 2*pos+1 = "right before char pos"
    // (after them). A zero-width element at pos is visited at key 2*pos, a
    // text token starting at s at key 2*s+1.
    type Ev = { key: number; order: number; fire: () => void };
    const events: Ev[] = [];
    plan.forEach((p, i) => {
        const emitIns = () => {
            if (!p.insertedText) return;
            const rPrRun =
                p.deleteStart === p.deleteEnd && p.insertLeft && p.deleteStart > 0
                    ? runAt(p.deleteStart - 1)
                    : runAt(p.deleteStart);
            const run = buildRun(flat.runs[rPrRun]?.rPr ?? null, p.insertedText, "w:t");
            out.push(makeEl("w:ins", [run], trackAttrs(p.insWId!)));
        };
        if (p.deleteEnd > p.deleteStart) {
            events.push({
                key: 2 * p.deleteStart + 1,
                order: 2 * i + 1,
                fire: () => {
                    emitIns();
                    delInner = [];
                },
            });
            events.push({
                key: 2 * p.deleteEnd,
                order: 2 * i,
                fire: () => {
                    if (delInner && delInner.length > 0) {
                        out.push(makeEl("w:del", delInner, trackAttrs(p.delWId!)));
                    }
                    delInner = null;
                },
            });
        } else {
            events.push({
                key: p.insertLeft ? 2 * p.deleteStart : 2 * p.deleteStart + 1,
                order: 2 * i + 1,
                fire: emitIns,
            });
        }
    });
    events.sort((a, b) => a.key - b.key || a.order - b.order);
    let ei = 0;
    const fireUpTo = (key: number) => {
        while (ei < events.length && events[ei].key <= key) events[ei++].fire();
    };

    for (const t of tokens) {
        if (t.kind === "text") {
            fireUpTo(2 * t.start + 1);
            const tag = delInner ? "w:delText" : "w:t";
            for (const c of textRunChildren(flat.paraText.slice(t.start, t.end), tag)) {
                append(target(), t.runIdx, c);
            }
        } else if (t.kind === "runAtom") {
            fireUpTo(2 * t.pos);
            append(target(), t.runIdx, t.node);
        } else {
            fireUpTo(2 * t.pos);
            target().push(t.node);
        }
    }
    fireUpTo(Number.POSITIVE_INFINITY);

    return [
        ...paraChildren.slice(0, startChildIdx),
        ...out,
        ...paraChildren.slice(endChildIdx + 1),
    ];
}

// ---------------------------------------------------------------------------
// Locating context in the document
// ---------------------------------------------------------------------------

interface ParagraphRef {
    paraNode: XNode;
    paraChildren: XNode[];
    flat: Flattened;
    globalStart: number; // where this paragraph starts in the full doc text
}

function indexAll(hay: string, needle: string): number[] {
    if (!needle) return [];
    const out: number[] = [];
    let i = 0;
    while (i <= hay.length - needle.length) {
        const j = hay.indexOf(needle, i);
        if (j < 0) break;
        out.push(j);
        i = j + 1;
    }
    return out;
}

// --- Whitespace / punctuation normalization for anchor matching -------------
// The text LLMs see (via mammoth's extractRawText) does not line up 1:1 with
// the raw w:t concatenation: smart quotes, non-breaking spaces, tabs, and
// runs of whitespace all differ. We normalize both haystack and needle to
// a canonical form for matching, then map matched offsets back to the
// original paragraph text.

function preNormalize(s: string): string {
    // All 1-to-1 character replacements — preserves length for straightforward
    // index mapping.
    return s
        .replace(/[\u2018\u2019\u2032]/g, "'")
        .replace(/[\u201C\u201D\u2033]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u00A0/g, " ")
        .replace(/\u200B/g, " ");
}

interface Normalized {
    norm: string;
    // origIdx[i] = index in the *original* string for norm[i]
    origIdx: number[];
}

function normalizeWs(input: string): Normalized {
    const s = preNormalize(input);
    const norm: string[] = [];
    const origIdx: number[] = [];
    let prevSpace = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (/\s/.test(ch)) {
            if (!prevSpace) {
                norm.push(" ");
                origIdx.push(i);
                prevSpace = true;
            }
        } else {
            norm.push(ch);
            origIdx.push(i);
            prevSpace = false;
        }
    }
    return { norm: norm.join(""), origIdx };
}

/**
 * Locate the unique position in `hayNorm` where `findNorm` appears AND is
 * preceded by `ctxBeforeNorm` AND followed by `ctxAfterNorm`. The context
 * check uses direct string-slice equality rather than concatenation so
 * boundary-whitespace collapsing doesn't matter. Returns the normalized
 * [start, end) range of the `find` portion, or a structured error.
 */
function findUniqueAnchor(
    hayNorm: string,
    findNorm: string,
    ctxBeforeNorm: string,
    ctxAfterNorm: string,
): { start: number; end: number } | { error: "none" | "ambiguous" } {
    const candidates: number[] = [];

    const checkCtx = (pos: number): boolean => {
        if (ctxBeforeNorm) {
            const start = pos - ctxBeforeNorm.length;
            if (start < 0) return false;
            if (hayNorm.slice(start, pos) !== ctxBeforeNorm) return false;
        }
        if (ctxAfterNorm) {
            const end = pos + findNorm.length;
            if (hayNorm.slice(end, end + ctxAfterNorm.length) !== ctxAfterNorm)
                return false;
        }
        return true;
    };

    if (findNorm.length === 0) {
        // Pure insertion — scan every position
        for (let i = 0; i <= hayNorm.length; i++) {
            if (checkCtx(i)) candidates.push(i);
        }
    } else {
        let from = 0;
        while (from <= hayNorm.length - findNorm.length) {
            const idx = hayNorm.indexOf(findNorm, from);
            if (idx < 0) break;
            if (checkCtx(idx)) candidates.push(idx);
            from = idx + 1;
        }
    }

    if (candidates.length === 0) return { error: "none" };
    if (candidates.length > 1) return { error: "ambiguous" };
    return {
        start: candidates[0],
        end: candidates[0] + findNorm.length,
    };
}

/** Map a normalized [start, end) range back to the original string range. */
function mapNormRangeToOriginal(
    paraNorm: Normalized,
    origLen: number,
    normStart: number,
    normEnd: number,
): { start: number; end: number } {
    const origStart =
        normStart < paraNorm.origIdx.length
            ? paraNorm.origIdx[normStart]
            : origLen;
    const origEnd =
        normEnd === normStart
            ? origStart
            : normEnd - 1 < paraNorm.origIdx.length
              ? paraNorm.origIdx[normEnd - 1] + 1
              : origLen;
    return { start: origStart, end: origEnd };
}

// ---------------------------------------------------------------------------
// Main: applyTrackedEdits
// ---------------------------------------------------------------------------

const W_NS_ATTRS: Record<string, string> = {
    "xmlns:w":
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
};

function createParser() {
    return new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        preserveOrder: true,
        trimValues: false,
        parseAttributeValue: false,
        // Text MUST stay a string. With the default (true) a w:t holding only
        // "0012", "1.50" or "1e5" is parsed as a number and serialized back
        // as "12", "1.5", "100000" - in EVERY paragraph of the document,
        // touched or not, outside tracked changes (audit D-09 follow-up).
        parseTagValue: false,
        processEntities: true,
    });
}

function createBuilder() {
    return new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        preserveOrder: true,
        suppressEmptyNode: false,
        processEntities: true,
    });
}

function findBody(doc: XNode[]): XNode[] | null {
    for (const top of doc) {
        if (elName(top) === "w:document") {
            for (const c of elChildren(top)) {
                if (elName(c) === "w:body") return elChildren(c);
            }
        }
    }
    return null;
}

function replaceBody(doc: XNode[], bodyChildren: XNode[]): void {
    for (const top of doc) {
        if (elName(top) !== "w:document") continue;
        const docKids = elChildren(top);
        for (const c of docKids) {
            if (elName(c) === "w:body") setChildren(c, bodyChildren);
        }
    }
}

/**
 * Walk a tree and collect all max w:id values in w:ins/w:del so new changes
 * can start their numbering safely above it.
 */
function maxTrackedId(doc: XNode[]): number {
    let max = 0;
    const visit = (n: unknown) => {
        const name = elName(n);
        if (!name) return;
        if (name === "w:ins" || name === "w:del") {
            const a = elAttrs(n);
            const raw = a["@_w:id"];
            if (raw != null) {
                const v = parseInt(String(raw), 10);
                if (Number.isFinite(v) && v > max) max = v;
            }
        }
        for (const c of elChildren(n as XNode)) visit(c);
    };
    for (const top of doc) visit(top);
    return max;
}

/**
 * Extract the body text of a .docx using the same flattening rules as the
 * tracked-changes matcher. Paragraphs are joined by a single newline. The
 * output is what the LLM should base its `find` / `context_before` /
 * `context_after` strings on, since it exactly mirrors the string the
 * anchor matcher operates against.
 */
export async function extractDocxBodyText(bytes: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = getZipEntry(zip, "word/document.xml");
    if (!docXmlFile) return "";
    const docXmlRaw = await docXmlFile.async("string");
    const parser = createParser();
    const tree = parser.parse(docXmlRaw) as XNode[];
    const bodyChildren = findBody(tree);
    if (!bodyChildren) return "";

    const lines: string[] = [];
    const collect = (nodes: XNode[]) => {
        for (const n of nodes) {
            const name = elName(n);
            if (!name) continue;
            if (name === "w:p") {
                const flat = flattenParagraph(elChildren(n));
                lines.push(flat.paraText);
            } else if (
                name === "w:tbl" ||
                name === "w:tr" ||
                name === "w:tc" ||
                name === "w:sdt" ||
                name === "w:sdtContent"
            ) {
                collect(elChildren(n));
            }
        }
    };
    collect(bodyChildren);
    return lines.join("\n");
}

/**
 * Walk document.xml in render order and collect the w:id for every
 * w:ins / w:del wrapper. The order here matches what docx-preview emits
 * as <ins>/<del> in the DOM, so the frontend can tag each rendered
 * element by index to recover the w:id attribute that docx-preview drops.
 */
export async function extractTrackedChangeIds(
    bytes: Buffer,
): Promise<{ kind: "ins" | "del"; w_id: string }[]> {
    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = getZipEntry(zip, "word/document.xml");
    if (!docXmlFile) return [];
    const docXmlRaw = await docXmlFile.async("string");
    const parser = createParser();
    const tree = parser.parse(docXmlRaw) as XNode[];
    const out: { kind: "ins" | "del"; w_id: string }[] = [];
    const visit = (n: unknown) => {
        const name = elName(n);
        if (!name) return;
        if (name === "w:ins" || name === "w:del") {
            const a = elAttrs(n);
            const raw = a["@_w:id"];
            if (raw != null) {
                out.push({
                    kind: name === "w:ins" ? "ins" : "del",
                    w_id: String(raw),
                });
            }
        }
        for (const c of elChildren(n as XNode)) visit(c);
    };
    for (const top of tree) visit(top);
    return out;
}

export async function applyTrackedEdits(
    bytes: Buffer,
    edits: EditInput[],
    opts?: { author?: string },
): Promise<ApplyTrackedEditsResult> {
    const author = opts?.author ?? "PATRON";
    const now = new Date().toISOString();

    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = getZipEntry(zip, "word/document.xml");
    if (!docXmlFile) throw new Error("document.xml missing from docx");
    const docXmlRaw = await docXmlFile.async("string");

    const parser = createParser();
    const tree = parser.parse(docXmlRaw) as XNode[];

    const bodyChildren = findBody(tree);
    if (!bodyChildren) throw new Error("w:body missing from document.xml");

    // Build paragraph table (only w:p at the top level of the body — does not
    // recurse into tables; for tables, w:p also appears inside w:tbl > w:tr >
    // w:tc so we need to traverse deeper).
    const paragraphs: ParagraphRef[] = [];
    const collectParagraphs = (nodes: XNode[]) => {
        for (const n of nodes) {
            const name = elName(n);
            if (!name) continue;
            if (name === "w:p") {
                const kids = elChildren(n);
                const flat = flattenParagraph(kids);
                paragraphs.push({
                    paraNode: n,
                    paraChildren: kids,
                    flat,
                    globalStart: 0, // set below
                });
            } else if (name === "w:tbl" || name === "w:tr" || name === "w:tc" || name === "w:sdt" || name === "w:sdtContent") {
                collectParagraphs(elChildren(n));
            }
        }
    };
    collectParagraphs(bodyChildren);

    // Assign global offsets (paragraphs joined by "\n" so context can
    // straddle a paragraph boundary, though edits themselves must stay
    // inside a single paragraph).
    {
        let off = 0;
        for (const p of paragraphs) {
            p.globalStart = off;
            off += p.flat.paraText.length + 1; // +1 for synthetic separator
        }
    }

    // Precompute normalized forms per paragraph for reuse across edits.
    const paraNorms: Normalized[] = paragraphs.map((p) =>
        normalizeWs(p.flat.paraText),
    );

    let nextWId = maxTrackedId(tree) + 1;
    const plansPerParagraph = new Map<number, PlannedChange[]>();
    const appliedChanges: AppliedChange[] = [];
    const errors: EditError[] = [];

    for (let editIdx = 0; editIdx < edits.length; editIdx++) {
        const edit = edits[editIdx];
        const find = edit.find ?? "";
        const replace = edit.replace ?? "";
        const ctxBefore = edit.context_before ?? "";
        const ctxAfter = edit.context_after ?? "";

        if (!find && !replace) {
            errors.push({ index: editIdx, reason: "Empty edit." });
            continue;
        }
        if (!find && !ctxBefore && !ctxAfter) {
            errors.push({
                index: editIdx,
                reason: "Pure insertion requires context_before or context_after.",
            });
            continue;
        }

        const findNorm = normalizeWs(find).norm;
        const ctxBeforeNorm = normalizeWs(ctxBefore).norm;
        const ctxAfterNorm = normalizeWs(ctxAfter).norm;

        // Strategy:
        //   1) find + full context  (strictest — preferred)
        //   2) find + half context  (drop whichever context side is shorter)
        //   3) find alone           (only if globally unique across doc)
        // At each stage we scan every paragraph. "Unique across the doc"
        // means exactly one paragraph yields exactly one match.
        type Hit = { paraIdx: number; normStart: number; normEnd: number };

        /**
         * Search every paragraph with the given context sides. If any
         * paragraph returns a match AND no paragraph is internally ambiguous,
         * return the collected hits; otherwise signal ambiguous.
         */
        const tryStrategy = (
            cb: string,
            ca: string,
        ): { kind: "ok"; hits: Hit[] } | { kind: "ambiguous" } => {
            const hits: Hit[] = [];
            let ambiguous = false;
            for (let pi = 0; pi < paragraphs.length; pi++) {
                const r = findUniqueAnchor(
                    paraNorms[pi].norm,
                    findNorm,
                    cb,
                    ca,
                );
                if ("error" in r) {
                    if (r.error === "ambiguous") ambiguous = true;
                    continue;
                }
                hits.push({ paraIdx: pi, normStart: r.start, normEnd: r.end });
            }
            if (ambiguous || hits.length > 1) return { kind: "ambiguous" };
            return { kind: "ok", hits };
        };

        let selected: Hit | null = null;
        const attempts = [
            { cb: ctxBeforeNorm, ca: ctxAfterNorm },
            { cb: ctxBeforeNorm, ca: "" },
            { cb: "", ca: ctxAfterNorm },
            { cb: "", ca: "" }, // find-only
        ];
        let sawAmbiguous = false;
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
            errors.push({
                index: editIdx,
                reason: sawAmbiguous
                    ? `Ambiguous match for find="${truncate(find, 80)}". Add longer context_before / context_after so the anchor is unique.`
                    : `Could not locate find="${truncate(find, 80)}" in the document. Re-read the document and copy context verbatim (including punctuation & whitespace).`,
            });
            continue;
        }

        const hit = selected;
        const paraIdx = hit.paraIdx;
        const paraNorm = paraNorms[paraIdx];
        const origLen = paragraphs[paraIdx].flat.paraText.length;
        const { start: findStart, end: findEnd } = mapNormRangeToOriginal(
            paraNorm,
            origLen,
            hit.normStart,
            hit.normEnd,
        );

        // Use the actual original text in that range as `deletedText` —
        // this preserves the document's whitespace/quote style rather than
        // the normalized needle the LLM provided.
        const originalFind = paragraphs[paraIdx].flat.paraText.slice(
            findStart,
            findEnd,
        );

        const { deleted, inserted, leadingEq, trailingEq } = collapseDiff(
            originalFind,
            replace,
        );
        const minStart = findStart + leadingEq;
        const minEnd = minStart + deleted.length;
        void findEnd;

        // A tracked deletion may carry text and simple layout elements
        // (w:tab, w:br, ...), but never a footnote reference, field, drawing,
        // hyperlink or a pre-existing tracked change: refuse the edit rather
        // than lose that element (audit D-09).
        const blocking = blockingElementInRange(
            paragraphs[paraIdx].flat,
            minStart,
            minEnd,
        );
        if (blocking) {
            errors.push({
                index: editIdx,
                reason: `The text to replace spans a non-text element (${blocking.name}) that a tracked change cannot carry safely; nothing was changed for this edit. Edit the text before and after that element separately.`,
            });
            continue;
        }

        // Pure insertion: which side of the insertion point holds the anchor?
        const insertLeft =
            leadingEq > 0 ? true : trailingEq > 0 ? false : ctxBefore.length > 0;

        const changeId = `patron-${editIdx}-${Date.now()}`;
        const plan: PlannedChange = {
            editIndex: editIdx,
            deleteStart: minStart,
            deleteEnd: minEnd,
            deletedText: deleted,
            insertedText: inserted,
            contextBefore: edit.context_before ?? "",
            contextAfter: edit.context_after ?? "",
            reason: edit.reason,
            changeId,
            delWId: deleted ? String(nextWId++) : undefined,
            insWId: inserted ? String(nextWId++) : undefined,
            insertLeft,
        };

        // Check for overlap with earlier plans in the same paragraph.
        const existing = plansPerParagraph.get(paraIdx) ?? [];
        const overlap = existing.some(
            (p) => !(plan.deleteEnd <= p.deleteStart || plan.deleteStart >= p.deleteEnd),
        );
        if (overlap) {
            errors.push({
                index: editIdx,
                reason: "Overlaps a previous edit in the same paragraph.",
            });
            continue;
        }

        existing.push(plan);
        existing.sort((a, b) => a.deleteStart - b.deleteStart);
        plansPerParagraph.set(paraIdx, existing);

        appliedChanges.push({
            id: changeId,
            delId: plan.delWId,
            insId: plan.insWId,
            deletedText: plan.deletedText,
            insertedText: plan.insertedText,
            contextBefore: plan.contextBefore,
            contextAfter: plan.contextAfter,
            reason: plan.reason,
        });
    }

    // Apply plans per paragraph.
    for (const [paraIdx, plan] of plansPerParagraph) {
        const p = paragraphs[paraIdx];
        const newKids = reconstructParagraph(
            p.paraChildren,
            p.flat,
            plan,
            now,
            author,
        );
        setChildren(p.paraNode, newKids);
    }

    const builder = createBuilder();
    const rebuiltXml = builder.build(tree);
    const withDecl = ensureXmlDeclaration(rebuiltXml);
    setZipEntry(zip, "word/document.xml", withDecl);

    const outBuf = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
    });
    return { bytes: outBuf, changes: appliedChanges, errors };
}

// ---------------------------------------------------------------------------
// Resolve a single tracked change (Accept or Reject)
// ---------------------------------------------------------------------------

/**
 * Walk the XML tree and transform matching w:ins/w:del wrappers for the
 * given change id. Returns { found, updatedTree }.
 */
function resolveInTree(
    doc: XNode[],
    changeIds: string[],
    mode: "accept" | "reject",
): { found: boolean } {
    const ids = new Set(changeIds.map((s) => String(s)));
    let touched = false;

    const rewrite = (parentKids: XNode[]): XNode[] => {
        const out: XNode[] = [];
        for (const n of parentKids) {
            const name = elName(n);
            if (!name) {
                out.push(n);
                continue;
            }

            // Recurse first so nested tables/sdts get processed
            const kids = elChildren(n);
            if (kids.length) {
                const newKids = rewrite(kids);
                if (newKids !== kids) setChildren(n, newKids);
            }

            if (name === "w:ins" || name === "w:del") {
                const a = elAttrs(n);
                const wId = String(a["@_w:id"] ?? "");
                if (ids.has(wId)) {
                    touched = true;
                    if (
                        (name === "w:ins" && mode === "accept") ||
                        (name === "w:del" && mode === "reject")
                    ) {
                        // Keep children, drop wrapper. For w:del rejected, we
                        // also need to convert inner w:delText → w:t so the
                        // text reverts to normal body content.
                        const inner =
                            name === "w:del"
                                ? (elChildren(n) as XNode[]).map(unwrapDelText)
                                : (elChildren(n) as XNode[]);
                        for (const c of inner) out.push(c);
                        continue;
                    } else {
                        // accept-del / reject-ins → drop the wrapper and its
                        // inner runs, but keep zero-width range markup
                        // (bookmarks, comment ranges ...) that an edit may
                        // have carried inside the w:del, so a comment or
                        // bookmark does not lose its anchor.
                        for (const c of elChildren(n)) {
                            const cn = elName(c);
                            if (cn && DELETABLE_PARA_ELEMENTS.has(cn) && cn !== "w:proofErr") {
                                out.push(c);
                            }
                        }
                        continue;
                    }
                }
            }

            out.push(n);
        }
        return out;
    };

    for (const top of doc) {
        if (elName(top) !== "w:document") continue;
        const docKids = elChildren(top);
        setChildren(top, rewrite(docKids));
    }

    return { found: touched };
}

function unwrapDelText(n: XNode): XNode {
    const name = elName(n);
    if (!name) return n;
    if (name === "w:r") {
        const kids = elChildren(n).map(unwrapDelText);
        setChildren(n, kids);
        return n;
    }
    if (name === "w:delText") {
        const attrs = elAttrs(n);
        return {
            "w:t": elChildren(n),
            ...(Object.keys(attrs).length ? { [ATTR_KEY]: attrs } : {}),
        };
    }
    return n;
}

export async function resolveTrackedChange(
    bytes: Buffer,
    changeIds: string[],
    mode: "accept" | "reject",
): Promise<{ bytes: Buffer; found: boolean }> {
    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = getZipEntry(zip, "word/document.xml");
    if (!docXmlFile) throw new Error("document.xml missing from docx");
    const docXmlRaw = await docXmlFile.async("string");

    const parser = createParser();
    const tree = parser.parse(docXmlRaw) as XNode[];

    const { found } = resolveInTree(tree, changeIds, mode);

    const builder = createBuilder();
    const rebuilt = ensureXmlDeclaration(builder.build(tree));
    setZipEntry(zip, "word/document.xml", rebuilt);
    const out = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
    });
    return { bytes: out, found };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ensureXmlDeclaration(xml: string): string {
    if (xml.startsWith("<?xml")) return xml;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;
}

function truncate(s: string, n: number): string {
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---------------------------------------------------------------------------
// Shared OOXML primitives (reused by docxComments.ts for comment emission)
// ---------------------------------------------------------------------------
//
// These are PURE helpers exported additively. `applyTrackedEdits` /
// `resolveTrackedChange` behavior is unchanged. docxComments.ts reuses the
// same paragraph flattening + whitespace-normalized anchor matching so a
// comment lands on exactly the span a model named, with the same robustness
// as a tracked edit.
//
// TODO(docx): a follow-up refactor can lift these plus the multi-strategy
// locate loop (currently inlined in applyTrackedEdits) into a dedicated
// docxOoxml.ts, so docxComments stops re-deriving the ~25-line anchor scan.
// Tracked as a reservation in ADR-0077.

export type { Flattened, SpanToken };
export {
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
    spanTokens,
    textRunChildren,
    makeRunAppender,
};

// Lightweight guards used elsewhere; exported for tests.
export const _internal = {
    flattenParagraph,
    collapseDiff,
    indexAll,
};

// Silence unused import if fastDiff is ever reintroduced for ranged matching.
// kept available in the file because the plan references it for future work.
export const _fastDiff = fastDiff;

// Suppress unused warning for W_NS_ATTRS (kept for potential future use when
// emitting standalone w:ins/w:del into parts without a namespace inheritance).
export const _nsAttrs = W_NS_ATTRS;
