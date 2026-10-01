// Rdzen weryfikatora lancucha audytu (ADR-0161). Czysta funkcja: dostaje WSZYSTKIE
// wiersze audit_log, zwraca raport z trojstanem ok / uwagi / blokada. Zrodlo
// wierszy (Supabase, plik SQLite) zyje w scripts/verify-audit-chain.ts.
//
// Weryfikator liniowy (kazdy prev_hash == hash wiersza o id-1) myli dwie rozne
// rzeczy: rozwidlenie z wyscigu zapisow i usuniecie wpisu. Na instalacji
// desktopowej zmierzone 2026-10-01: rozwidlenia z rownoleglych wywolan
// narzedzi, kazdy wiersz z poprawnym hashem i istniejacym poprzednikiem - a
// liniowy weryfikator zglosilby "srodkowy wpis zmodyfikowany lub usuniety".
// Dlatego lancuch traktujemy jako drzewo: kazdy wiersz wskazuje poprzednika
// po hashu, nie po id.
//
// Co jest BLOKADA (tego wyscig nie tlumaczy):
//   - hash wiersza nie zgadza sie z trescia (modyfikacja po zapisie),
//   - prev_hash wskazuje hash, ktorego nie ma w tabeli (usuniety wpis),
//   - poprzednik ma id >= id wiersza (wstawka wstecz),
//   - wiecej niz jeden poczatek lancucha (GENESIS) albo zaden,
//   - zdublowany hash,
//   - rozwidlenie powyzej progu straznika (przy zywym indeksie niemozliwe),
//   - rozwidlenie bez sygnatury wyscigu (patrz classifyFork),
//   - pusta tabela: nie ma czego potwierdzic, a pusty dziennik po uzyciu
//     programu to wlasnie slad wyczyszczenia.
// UWAGI: rozwidlenia z sygnatura wyscigu sprzed straznika. Kazde ogniwo ma
// poprawny hash, ale ogniwa boczne sa liscmi - ich usuniecia nie wykryje
// zaden kolejny wpis. To realna strata ochrony, nie kosmetyka.
// INFO (nie zmienia werdyktu): takie rozwidlenie potwierdzone przez Operatora
// zdarzeniem `audit.chain.fork_acknowledged` (wariant B). Zdarzenie niesie hashe
// ogniw, wiec ich pozniejsze usuniecie to BLOKADA `ack_missing` - potwierdzenie
// przywraca liscim ochrone. Potwierdzenie NIE wybiela rozwidlenia powyzej progu
// ani bez sygnatury wyscigu: te sprawdzenia ida pierwsze.
//
// Granica metody: lancuch bez zewnetrznej kotwicy (Merkle + RFC 3161, ADR-0026/
// 0037) nie chroni przed kims, kto ma zapis do bazy i dopisze ogniwa z poprawnymi
// hashami. Sygnatura wyscigu odroznia awarie od manipulacji, nie dowodzi
// niewinnosci.

import { GENESIS_HASH, computeAuditHash } from "./audit";

export interface ChainRow {
    id: number;
    ts: string;
    event_type: string;
    actor_user_id: string | null;
    chat_id: string | null;
    document_id: string | null;
    payload: Record<string, unknown>;
    prev_hash: string;
    hash: string;
}

export type ChainVerdict = "ok" | "uwagi" | "blokada";

export type ChainFindingKind =
    | "empty"
    | "hash_mismatch"
    | "duplicate_hash"
    | "missing_parent"
    | "parent_not_earlier"
    | "genesis_count"
    | "fork_concurrent"
    | "fork_unexplained"
    | "fork_after_guard"
    | "fork_acknowledged"
    | "ack_invalid"
    | "ack_missing";

/** Zdarzenie, ktorym Operator potwierdza rozwidlenia sprzed straznika (ADR-0161 B). */
export const FORK_ACK_EVENT = "audit.chain.fork_acknowledged";

export interface ForkAckPayload {
    schema: "fork-ack/1";
    /** Prog straznika w chwili potwierdzenia - potwierdza sie tylko zbior zamkniety. */
    guard_after_id: number;
    forks: Array<{
        parent_id: number;
        parent_hash: string;
        siblings: Array<{ id: number; hash: string }>;
    }>;
}

export interface ChainFinding {
    kind: ChainFindingKind;
    severity: "info" | "uwagi" | "blokada";
    /** id wierszy, ktorych dotyczy znalezisko (bez tresci - payload to dane sprawy). */
    ids: number[];
    detail: string;
}

export interface ChainReport {
    verdict: ChainVerdict;
    rows: number;
    /** Wiersze na sciezce od najnowszego wpisu do GENESIS. */
    mainChain: number;
    /** Wiersze poza ta sciezka (boczne ogniwa rozwidlen). */
    sideRows: number;
    forkPoints: number;
    /** Prog straznika (`where id > N`) albo null, gdy nieznany / brak indeksu. */
    guardAfterId: number | null;
    headId: number | null;
    headHash: string | null;
    findings: ChainFinding[];
}

export interface VerifyOptions {
    guardAfterId: number | null;
    /**
     * Najwiekszy rozrzut `ts` rodzenstwa, ktory uznajemy za wyscig. Zmierzone
     * rozwidlenia mialy rozrzut 0 ms (identyczny ts). Domyslnie 2000 ms.
     */
    raceWindowMs?: number;
}

const DEFAULT_RACE_WINDOW_MS = 2000;

export function verifyAuditChain(
    input: ReadonlyArray<ChainRow>,
    opts: VerifyOptions,
): ChainReport {
    const raceWindowMs = opts.raceWindowMs ?? DEFAULT_RACE_WINDOW_MS;
    const findings: ChainFinding[] = [];
    const rows = [...input].sort((a, b) => a.id - b.id);

    const base = {
        rows: rows.length,
        guardAfterId: opts.guardAfterId,
    };
    if (rows.length === 0) {
        return {
            ...base,
            verdict: "blokada",
            mainChain: 0,
            sideRows: 0,
            forkPoints: 0,
            headId: null,
            headHash: null,
            findings: [
                {
                    kind: "empty",
                    severity: "blokada",
                    ids: [],
                    detail: "audit_log jest pusty - nie ma czego potwierdzic (na swiezej instalacji oczekiwane)",
                },
            ],
        };
    }

    // 1. Tresc kazdego wiersza.
    const byHash = new Map<string, ChainRow>();
    for (const row of rows) {
        const recomputed = computeAuditHash({
            prev_hash: row.prev_hash,
            ts: row.ts,
            event_type: row.event_type,
            actor_user_id: row.actor_user_id,
            chat_id: row.chat_id,
            document_id: row.document_id,
            payload: row.payload,
        });
        if (recomputed !== row.hash) {
            findings.push({
                kind: "hash_mismatch",
                severity: "blokada",
                ids: [row.id],
                detail: "hash nie zgadza sie z trescia wiersza - modyfikacja po zapisie",
            });
        }
        if (byHash.has(row.hash)) {
            findings.push({
                kind: "duplicate_hash",
                severity: "blokada",
                ids: [byHash.get(row.hash)!.id, row.id],
                detail: "dwa wiersze z tym samym hashem",
            });
        } else {
            byHash.set(row.hash, row);
        }
    }

    // 2. Poprzednicy.
    const parentOf = new Map<number, ChainRow>();
    const children = new Map<string, ChainRow[]>();
    const genesis: ChainRow[] = [];
    for (const row of rows) {
        const list = children.get(row.prev_hash) ?? [];
        list.push(row);
        children.set(row.prev_hash, list);
        if (row.prev_hash === GENESIS_HASH) {
            genesis.push(row);
            continue;
        }
        const parent = byHash.get(row.prev_hash);
        if (!parent) {
            findings.push({
                kind: "missing_parent",
                severity: "blokada",
                ids: [row.id],
                detail: "prev_hash wskazuje wpis, ktorego nie ma w tabeli - usuniety wpis",
            });
            continue;
        }
        if (parent.id >= row.id) {
            findings.push({
                kind: "parent_not_earlier",
                severity: "blokada",
                ids: [parent.id, row.id],
                detail: "poprzednik ma id nie mniejsze niz wiersz - wstawka wstecz",
            });
            continue;
        }
        parentOf.set(row.id, parent);
    }
    if (genesis.length !== 1) {
        findings.push({
            kind: "genesis_count",
            severity: "blokada",
            ids: genesis.map((r) => r.id),
            detail: `poczatkow lancucha (GENESIS): ${genesis.length}, oczekiwany dokladnie jeden`,
        });
    }

    // 3. Sciezka glowna: od najnowszego wpisu wstecz do GENESIS.
    const head = rows[rows.length - 1];
    const onMain = new Set<number>();
    for (let cur: ChainRow | undefined = head; cur; cur = parentOf.get(cur.id)) {
        if (onMain.has(cur.id)) break;
        onMain.add(cur.id);
    }

    // 4. Potwierdzenia rozwidlen: kazde zadeklarowane ogniwo musi nadal istniec
    //    z tym samym id i byc starsze od deklaracji.
    const acked = new Set<string>();
    for (const ack of rows) {
        if (ack.event_type !== FORK_ACK_EVENT) continue;
        const forks = parseForkAck(ack.payload);
        if (!forks) {
            findings.push({
                kind: "ack_invalid",
                severity: "blokada",
                ids: [ack.id],
                detail: "potwierdzenie rozwidlen ma nieczytelny payload",
            });
            continue;
        }
        for (const f of forks) {
            for (const node of [{ id: f.parent_id, hash: f.parent_hash }, ...f.siblings]) {
                const row = byHash.get(node.hash);
                if (!row || row.id !== node.id || row.id >= ack.id) {
                    findings.push({
                        kind: "ack_missing",
                        severity: "blokada",
                        ids: [ack.id, node.id],
                        detail: `potwierdzenie id=${ack.id} wskazuje ogniwo id=${node.id}, ktorego nie ma z tym hashem - usuniete albo podmienione po potwierdzeniu`,
                    });
                    continue;
                }
                acked.add(node.hash);
            }
        }
    }

    // 5. Rozwidlenia.
    const hasChildren = (r: ChainRow) => (children.get(r.hash)?.length ?? 0) > 0;
    let forkPoints = 0;
    for (const [prev, siblings] of children) {
        if (siblings.length < 2) continue;
        // Wielokrotny GENESIS juz zgloszony wyzej jako genesis_count.
        if (prev === GENESIS_HASH) continue;
        forkPoints++;
        const parent = byHash.get(prev);
        const ids = siblings.map((s) => s.id);
        if (opts.guardAfterId !== null && siblings.some((s) => s.id > opts.guardAfterId!)) {
            findings.push({
                kind: "fork_after_guard",
                severity: "blokada",
                ids,
                detail: `rozwidlenie powyzej progu straznika (id > ${opts.guardAfterId}) - przy zywym indeksie niemozliwe; indeks usuniety albo zapis z pominieciem`,
            });
            continue;
        }
        const why = classifyFork(parent, siblings, raceWindowMs, hasChildren, head);
        if (why === null && parent && acked.has(parent.hash) && siblings.every((x) => acked.has(x.hash))) {
            findings.push({
                kind: "fork_acknowledged",
                severity: "info",
                ids,
                detail: `rozwidlenie z sygnatura wyscigu potwierdzone przez Operatora (poprzednik id=${parent.id}); ogniwa chronione hashem w potwierdzeniu`,
            });
        } else if (why === null) {
            findings.push({
                kind: "fork_concurrent",
                severity: "uwagi",
                ids,
                detail: `rozwidlenie z sygnatura wyscigu zapisow (poprzednik id=${parent?.id}); ogniwa boczne sa liscmi - ich usuniecia lancuch nie wykryje`,
            });
        } else {
            findings.push({
                kind: "fork_unexplained",
                severity: "blokada",
                ids,
                detail: `rozwidlenie bez sygnatury wyscigu: ${why}`,
            });
        }
    }

    const verdict: ChainVerdict = findings.some((f) => f.severity === "blokada")
        ? "blokada"
        : findings.some((f) => f.severity === "uwagi")
          ? "uwagi"
          : "ok";
    return {
        ...base,
        verdict,
        mainChain: onMain.size,
        sideRows: rows.length - onMain.size,
        forkPoints,
        headId: head.id,
        headHash: head.hash,
        findings,
    };
}

/**
 * Sygnatura wyscigu dwoch zapisow czytajacych ten sam ostatni hash:
 *   - rodzenstwo powstalo w jednym oknie czasu (rozrzut `ts` <= raceWindowMs),
 *   - nikt z rodzenstwa nie jest starszy od poprzednika,
 *   - lancuch biegnie dalej z co najwyzej jednego z nich; pozostale sa liscmi.
 * Zwraca null, gdy sygnatura pasuje, albo powod, dla ktorego nie pasuje.
 */
function classifyFork(
    parent: ChainRow | undefined,
    siblings: ReadonlyArray<ChainRow>,
    raceWindowMs: number,
    hasChildren: (r: ChainRow) => boolean,
    head: ChainRow,
): string | null {
    if (!parent) return "brak poprzednika";
    const times = siblings.map((s) => Date.parse(s.ts));
    if (times.some((t) => Number.isNaN(t))) return "nieczytelny ts";
    const spread = Math.max(...times) - Math.min(...times);
    if (spread > raceWindowMs) {
        return `rozrzut ts rodzenstwa ${spread} ms > ${raceWindowMs} ms`;
    }
    const parentTs = Date.parse(parent.ts);
    if (Number.isNaN(parentTs) || times.some((t) => t < parentTs)) {
        return "ogniwo starsze od poprzednika";
    }
    const continuing = siblings.filter((s) => hasChildren(s) || s.id === head.id);
    if (continuing.length > 1) {
        return `lancuch biegnie dalej z ${continuing.length} galezi`;
    }
    return null;
}

function isHash(x: unknown): x is string {
    return typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
}

function isId(x: unknown): x is number {
    return typeof x === "number" && Number.isSafeInteger(x) && x > 0;
}

/** Waliduje payload potwierdzenia; null gdy ksztalt sie nie zgadza. */
function parseForkAck(payload: Record<string, unknown>): ForkAckPayload["forks"] | null {
    if (payload.schema !== "fork-ack/1" || !Array.isArray(payload.forks) || payload.forks.length === 0) {
        return null;
    }
    const out: ForkAckPayload["forks"] = [];
    for (const f of payload.forks as unknown[]) {
        const o = f as Record<string, unknown>;
        if (!o || !isId(o.parent_id) || !isHash(o.parent_hash) || !Array.isArray(o.siblings)) return null;
        const siblings: Array<{ id: number; hash: string }> = [];
        for (const sib of o.siblings as unknown[]) {
            const so = sib as Record<string, unknown>;
            if (!so || !isId(so.id) || !isHash(so.hash)) return null;
            siblings.push({ id: so.id, hash: so.hash });
        }
        if (siblings.length < 2) return null;
        out.push({ parent_id: o.parent_id, parent_hash: o.parent_hash, siblings });
    }
    return out;
}

/**
 * Sklada payload potwierdzenia dla rozwidlen z sygnatura wyscigu, ktorych nikt
 * jeszcze nie potwierdzil. Zwraca null, gdy nie ma czego potwierdzac albo gdy
 * potwierdzenie jest niedozwolone: werdykt BLOKADA (najpierw wyjasnic) lub brak
 * progu straznika (zbior rozwidlen nie jest zamkniety - kolejne moga dojsc).
 */
export function buildForkAcknowledgement(
    rows: ReadonlyArray<ChainRow>,
    report: ChainReport,
): ForkAckPayload | null {
    if (report.verdict === "blokada" || report.guardAfterId === null) return null;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const forks: ForkAckPayload["forks"] = [];
    for (const f of report.findings) {
        if (f.kind !== "fork_concurrent") continue;
        const siblings = f.ids.map((id) => byId.get(id)!);
        const parent = rows.find((r) => r.hash === siblings[0].prev_hash)!;
        forks.push({
            parent_id: parent.id,
            parent_hash: parent.hash,
            siblings: siblings.map((x) => ({ id: x.id, hash: x.hash })),
        });
    }
    if (forks.length === 0) return null;
    return { schema: "fork-ack/1", guard_after_id: report.guardAfterId, forks };
}
