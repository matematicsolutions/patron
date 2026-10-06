// Testy rdzenia weryfikatora lancucha (ADR-0161). Dane w calosci syntetyczne: hashe
// liczone prawdziwym computeAuditHash, czasy i szerokosci rozwidlen wymyslone.
// Z pomiaru na instalacji (2026-10-01) wziety jest tylko WZORZEC: rodzenstwo w tej
// samej milisekundzie, lancuch biegnie dalej z najwyzszego id, reszta to liscie.
import { describe, expect, it } from "vitest";
import { GENESIS_HASH, computeAuditHash } from "./audit";
import {
    buildForkAcknowledgement,
    FORK_ACK_EVENT,
    verifyAuditChain,
    type ChainRow,
} from "./audit-chain-verify";

/** Dopisuje wiersz z poprawnym hashem do poprzednika `parent` (null = GENESIS). */
function link(
    rows: ChainRow[],
    parent: ChainRow | null,
    ts: string,
    label = "x",
    event_type = "ring_policy.decision",
    payload: Record<string, unknown> = { label },
): ChainRow {
    const base = {
        id: rows.length === 0 ? 1 : Math.max(...rows.map((r) => r.id)) + 1,
        ts,
        event_type,
        actor_user_id: null,
        chat_id: null,
        document_id: null,
        payload,
        prev_hash: parent?.hash ?? GENESIS_HASH,
    };
    const row = { ...base, hash: computeAuditHash(base) };
    rows.push(row);
    return row;
}

function linear(n: number): ChainRow[] {
    const rows: ChainRow[] = [];
    let prev: ChainRow | null = null;
    for (let i = 0; i < n; i++) prev = link(rows, prev, `2026-01-15T10:00:${String(10 + i).padStart(2, "0")}.000Z`);
    return rows;
}

/** Wzorzec wyscigu: poprzednik -> kilka ogniw w tej samej ms, dalej z ostatniego, i jeszcze raz. */
function raceShape(): ChainRow[] {
    const rows = linear(3);
    let parent = rows[2];
    for (const [width, ts] of [
        [3, "2026-01-15T10:02:00.100Z"],
        [2, "2026-01-15T10:02:05.200Z"],
    ] as const) {
        let last: ChainRow = parent;
        for (let i = 0; i < width; i++) last = link(rows, parent, ts, `s${i}`);
        parent = last;
    }
    link(rows, parent, "2026-01-15T10:02:09.300Z");
    return rows;
}

const noGuard = { guardAfterId: null };

describe("verifyAuditChain - trojstan", () => {
    it("jeden lancuch: OK, pelna sciezka glowna", () => {
        const r = verifyAuditChain(linear(5), noGuard);
        expect(r.verdict).toBe("ok");
        expect(r).toMatchObject({ rows: 5, mainChain: 5, sideRows: 0, forkPoints: 0, findings: [] });
    });

    it("pusty dziennik: BLOKADA, nie sukces", () => {
        const r = verifyAuditChain([], noGuard);
        expect(r.verdict).toBe("blokada");
        expect(r.findings[0].kind).toBe("empty");
    });

    it("wzorzec wyscigu: 2 rozwidlenia jedno po drugim, 3 ogniwa boczne -> UWAGI", () => {
        const r = verifyAuditChain(raceShape(), noGuard);
        expect(r.verdict).toBe("uwagi");
        expect(r.forkPoints).toBe(2);
        expect(r.sideRows).toBe(3);
        expect(r.findings.map((f) => f.kind)).toEqual(Array(2).fill("fork_concurrent"));
    });

    it("to samo rozwidlenie powyzej progu straznika -> BLOKADA", () => {
        const rows = raceShape();
        const r = verifyAuditChain(rows, { guardAfterId: 3 });
        expect(r.verdict).toBe("blokada");
        expect(r.findings.every((f) => f.kind === "fork_after_guard")).toBe(true);
    });

    it("rozwidlenia ponizej progu, lancuch dalej liniowy -> UWAGI (stan bazy po migracji)", () => {
        const rows = raceShape();
        let prev = rows[rows.length - 1];
        const guard = prev.id;
        for (let i = 0; i < 3; i++) prev = link(rows, prev, `2026-10-01T09:00:0${i}.000Z`);
        const r = verifyAuditChain(rows, { guardAfterId: guard });
        expect(r.verdict).toBe("uwagi");
    });
});

describe("verifyAuditChain - manipulacja to BLOKADA, nie rozwidlenie", () => {
    it("zmieniony payload srodkowego wpisu", () => {
        const rows = linear(5);
        rows[2] = { ...rows[2], payload: { label: "podmienione" } };
        const r = verifyAuditChain(rows, noGuard);
        expect(r.verdict).toBe("blokada");
        expect(r.findings.map((f) => f.kind)).toContain("hash_mismatch");
    });

    it("usuniety srodkowy wpis: brak poprzednika", () => {
        const rows = linear(5);
        rows.splice(2, 1);
        const r = verifyAuditChain(rows, noGuard);
        expect(r.verdict).toBe("blokada");
        expect(r.findings[0]).toMatchObject({ kind: "missing_parent", ids: [4] });
    });

    it("wstawka z ts sprzed poprzednika ma inna sygnature niz wyscig (nawet w oknie czasu)", () => {
        const rows = linear(4);
        // Poprzednik id=2 ma ts 10:00:11.000, jego nastepca :12.000; wstawka :10.500 miesci
        // sie w oknie rozrzutu (1,5 s), ale jest starsza od wpisu, do ktorego sie podpina.
        link(rows, rows[1], "2026-01-15T10:00:10.500Z");
        const r = verifyAuditChain(rows, noGuard);
        expect(r.verdict).toBe("blokada");
        expect(r.findings[0].kind).toBe("fork_unexplained");
        expect(r.findings[0].detail).toContain("starsze od poprzednika");
    });

    it("wstawka dopisana duzo pozniej do starego wpisu (rozrzut ts poza oknem)", () => {
        const rows = linear(4);
        link(rows, rows[1], "2026-09-01T00:00:00.000Z");
        const r = verifyAuditChain(rows, noGuard);
        expect(r.verdict).toBe("blokada");
        expect(r.findings[0].detail).toContain("rozrzut ts");
    });

    it("galaz boczna, ktora ma dalsze ogniwa, nie jest wyscigiem", () => {
        const rows = linear(3);
        const a = link(rows, rows[2], "2026-01-15T10:01:00.000Z", "a");
        const b = link(rows, rows[2], "2026-01-15T10:01:00.000Z", "b");
        link(rows, a, "2026-01-15T10:01:01.000Z");
        link(rows, b, "2026-01-15T10:01:02.000Z");
        const r = verifyAuditChain(rows, noGuard);
        expect(r.verdict).toBe("blokada");
        expect(r.findings[0].detail).toContain("2 galezi");
    });

    it("drugi poczatek lancucha (GENESIS)", () => {
        const rows = linear(3);
        link(rows, null, "2026-01-15T10:05:00.000Z");
        const r = verifyAuditChain(rows, noGuard);
        expect(r.verdict).toBe("blokada");
        expect(r.findings.map((f) => f.kind)).toContain("genesis_count");
    });

    it("GRANICA METODY: usuniety lisc rozwidlenia znika bez sladu", () => {
        // Udokumentowana strata ochrony (ADR-0161): ogniwo boczne nie ma nastepcy,
        // wiec jego usuniecia lancuch nie widzi. Gdy z rozwidlenia zostanie jedno
        // ogniwo, weryfikator widzi zwykly lancuch. Test pilnuje, zeby nikt nie
        // ogloszal, ze weryfikator to wykrywa.
        const rows = linear(3);
        link(rows, rows[2], "2026-01-15T10:01:00.000Z", "lisc");
        const main = link(rows, rows[2], "2026-01-15T10:01:00.000Z", "dalej");
        link(rows, main, "2026-01-15T10:01:05.000Z");
        expect(verifyAuditChain(rows, noGuard).verdict).toBe("uwagi");
        const bezLiscia = rows.filter((r) => r.id !== 4);
        expect(verifyAuditChain(bezLiscia, noGuard).verdict).toBe("ok");
    });
});

describe("potwierdzenie rozwidlen przez Operatora (ADR-0161 wariant B)", () => {
    /** Wzorzec wyscigu, potem lancuch po strazniku i potwierdzenie na glownej sciezce. */
    function acknowledged(): { rows: ChainRow[]; guard: number } {
        const rows = raceShape();
        const guard = rows[rows.length - 1].id;
        const before = verifyAuditChain(rows, { guardAfterId: guard });
        const ack = buildForkAcknowledgement(rows, before)!;
        link(rows, rows[rows.length - 1], "2026-01-15T11:00:00.000Z", "", FORK_ACK_EVENT, { ...ack });
        return { rows, guard };
    }

    it("potwierdzone rozwidlenia nie zmieniaja werdyktu: OK z INFO", () => {
        const { rows, guard } = acknowledged();
        const r = verifyAuditChain(rows, { guardAfterId: guard });
        expect(r.verdict).toBe("ok");
        expect(r.findings.map((f) => f.kind)).toEqual(["fork_acknowledged", "fork_acknowledged"]);
    });

    it("KONTROLA POZYTYWNA: usuniety lisc PO potwierdzeniu jest BLOKADA (bez potwierdzenia byl niewidoczny)", () => {
        const { rows, guard } = acknowledged();
        const leaf = rows.find((r) => r.payload.label === "s0")!;
        const r = verifyAuditChain(
            rows.filter((x) => x.id !== leaf.id),
            { guardAfterId: guard },
        );
        expect(r.verdict).toBe("blokada");
        expect(r.findings.find((f) => f.kind === "ack_missing")?.ids).toContain(leaf.id);
    });

    it("potwierdzenie nie wybiela rozwidlenia powyzej progu straznika", () => {
        const { rows } = acknowledged();
        const r = verifyAuditChain(rows, { guardAfterId: 3 });
        expect(r.verdict).toBe("blokada");
        expect(r.findings.some((f) => f.kind === "fork_after_guard")).toBe(true);
    });

    it("potwierdzenie nie wybiela rozwidlenia bez sygnatury wyscigu", () => {
        const rows = linear(4);
        link(rows, rows[1], "2026-09-01T00:00:00.000Z", "wstawka");
        const forged = {
            schema: "fork-ack/1",
            guard_after_id: 5,
            forks: [
                {
                    parent_id: 2,
                    parent_hash: rows[1].hash,
                    siblings: [rows[2], rows[4]].map((x) => ({ id: x.id, hash: x.hash })),
                },
            ],
        };
        link(rows, rows[3], "2026-09-01T00:00:01.000Z", "", FORK_ACK_EVENT, forged);
        const r = verifyAuditChain(rows, { guardAfterId: 5 });
        expect(r.verdict).toBe("blokada");
        expect(r.findings.some((f) => f.kind === "fork_unexplained")).toBe(true);
    });

    it("nieczytelny payload potwierdzenia to BLOKADA", () => {
        const rows = linear(3);
        link(rows, rows[2], "2026-01-15T11:00:00.000Z", "", FORK_ACK_EVENT, { schema: "fork-ack/1", forks: "x" });
        expect(verifyAuditChain(rows, { guardAfterId: 0 }).findings[0].kind).toBe("ack_invalid");
    });

    it("buildForkAcknowledgement odmawia przy BLOKADZIE i bez progu, a gdy wszystko potwierdzone - nie ma czego", () => {
        const rows = raceShape();
        expect(buildForkAcknowledgement(rows, verifyAuditChain(rows, noGuard))).toBeNull();
        expect(buildForkAcknowledgement(rows, verifyAuditChain(rows, { guardAfterId: 3 }))).toBeNull();
        const ok = buildForkAcknowledgement(rows, verifyAuditChain(rows, { guardAfterId: rows.length }));
        expect(ok?.forks).toHaveLength(2);
        expect(ok?.forks[0].siblings).toHaveLength(3);
        const { rows: done, guard } = acknowledged();
        expect(buildForkAcknowledgement(done, verifyAuditChain(done, { guardAfterId: guard }))).toBeNull();
    });
});

// ADR-0164 w rdzeniu ADR-0161: zerwanie TRESCI dostaje trojstan. Na linii 2.0 zyl
// w skrypcie Postgres; po scaleniu linii jest tutaj, wiec obejmuje tez SQLite.
describe("zerwanie tresci: z mocy prawa / kaskada FK / niewyjasnione (ADR-0164)", () => {
    /** Lancuch z aktorem, potem anonimizacja jak w rodo-delete (UPDATE bez przeliczenia). */
    function anonymized(declare: Record<string, unknown> | null): ChainRow[] {
        const rows: ChainRow[] = [];
        let prevHash = GENESIS_HASH;
        for (let i = 0; i < 4; i++) {
            const base: Omit<ChainRow, "hash"> = {
                id: i + 1,
                ts: `2026-01-15T10:00:1${i}.000Z`,
                event_type: "chat.message.user",
                actor_user_id: i === 1 || i === 2 ? "u-anon" : "u-inny",
                chat_id: "c1",
                document_id: null,
                payload: { n: i },
                prev_hash: prevHash,
            };
            const row: ChainRow = { ...base, hash: computeAuditHash(base) };
            rows.push(row);
            prevHash = row.hash;
        }
        rows[1] = { ...rows[1], actor_user_id: null };
        rows[2] = { ...rows[2], actor_user_id: null };
        if (declare) link(rows, rows[3], "2026-01-15T10:00:20.000Z", "d", "audit.chain.legal_break", declare);
        return rows;
    }
    const decl = {
        reason: "rodo_art_17_anonymization",
        field: "actor_user_id",
        affected_count: 2,
        first_id: 2,
        last_id: 3,
        affected_ids: [2, 3],
        affected_ids_truncated: false,
    };
    const kinds = (r: ReturnType<typeof verifyAuditChain>) => r.findings.map((f) => f.kind);

    it("zadeklarowana anonimizacja: UWAGI, nie BLOKADA, z id zdarzenia w opisie", () => {
        const r = verifyAuditChain(anonymized(decl), noGuard);
        expect(r.verdict).toBe("uwagi");
        expect(kinds(r)).toEqual(["hash_mismatch_legal_break", "hash_mismatch_legal_break"]);
        expect(r.findings[0].detail).toContain("id=5");
    });

    it("KONTROLA POZYTYWNA: bez deklaracji ta sama anonimizacja to BLOKADA", () => {
        const r = verifyAuditChain(anonymized(null), noGuard);
        expect(r.verdict).toBe("blokada");
        expect(kinds(r)).toEqual(["hash_mismatch", "hash_mismatch"]);
    });

    it("kaskada FK tylko gdy zrodlo ja w ogole mialo (Postgres): nadal BLOKADA, z hipoteza", () => {
        const rows = anonymized(null);
        expect(kinds(verifyAuditChain(rows, noGuard))).not.toContain("hash_mismatch_fk_cascade");
        const r = verifyAuditChain(rows, { ...noGuard, fkCascadePossible: true });
        expect(r.verdict).toBe("blokada");
        expect(kinds(r)).toEqual(["hash_mismatch_fk_cascade", "hash_mismatch_fk_cascade"]);
    });

    it("deklaracja nie wybiela innej zmiany: zadeklarowany wiersz z podmienionym payloadem", () => {
        const rows = anonymized(decl);
        rows[2] = { ...rows[2], payload: { n: "podmienione" } };
        rows[2] = { ...rows[2], actor_user_id: "u-anon" };
        const r = verifyAuditChain(rows, noGuard);
        expect(r.verdict).toBe("blokada");
        expect(kinds(r)).toContain("hash_mismatch");
    });

    it("zmieniona deklaracja nie wybiela niczego (sama jest zerwaniem tresci)", () => {
        const rows = anonymized(decl);
        const ev = rows[rows.length - 1];
        rows[rows.length - 1] = { ...ev, payload: { ...ev.payload, affected_ids: [2, 3, 4] } };
        const r = verifyAuditChain(rows, noGuard);
        expect(r.verdict).toBe("blokada");
        expect(kinds(r)).not.toContain("hash_mismatch_legal_break");
    });

    it("deklaracja nie obejmuje wiersza NOWSZEGO od siebie (nawet gdy wymienia jego id)", () => {
        // Deklaracja wymienia id 6, ktorego w chwili zapisu jeszcze nie bylo.
        const rows = anonymized({ ...decl, affected_ids: [2, 3, 6], affected_count: 3 });
        const base = {
            id: 6,
            ts: "2026-01-15T10:00:30.000Z",
            event_type: "chat.message.user",
            actor_user_id: "u-anon",
            chat_id: "c1",
            document_id: null,
            payload: { n: 6 },
            prev_hash: rows[rows.length - 1].hash,
        };
        rows.push({ ...base, hash: computeAuditHash(base), actor_user_id: null });
        const r = verifyAuditChain(rows, noGuard);
        expect(r.findings.filter((f) => f.ids.includes(6)).map((f) => f.kind)).toEqual(["hash_mismatch"]);
        expect(r.verdict).toBe("blokada");
    });

    it("deklaracja z hashem po zerwaniu: podmieniony payload anonimizowanego wiersza to BLOKADA (R-AC-01)", () => {
        // Hashe po zerwaniu liczone tak jak scripts/rodo-delete.ts: wiersz z wyzerowanym polem.
        const przed = anonymized(null);
        const hashePo = [przed[1], przed[2]].map((r) => computeAuditHash(r));
        const ok = anonymized({ ...decl, affected_hashes_after: hashePo });
        expect(verifyAuditChain(ok, noGuard).verdict).toBe("uwagi");

        const rows = anonymized({ ...decl, affected_hashes_after: hashePo });
        rows[2] = { ...rows[2], payload: { n: "podmienione" } };
        const r = verifyAuditChain(rows, noGuard);
        expect(r.verdict).toBe("blokada");
        expect(r.findings.filter((f) => f.ids.includes(3)).map((f) => f.kind)).toEqual(["hash_mismatch"]);
    });

    it("deklaracja w starym formacie (bez hasha po zerwaniu): UWAGI z jawna nota", () => {
        const r = verifyAuditChain(anonymized(decl), noGuard);
        expect(r.verdict).toBe("uwagi");
        expect(r.findings[0].detail).toContain("starym formacie");
    });

    it("obcieta lista id w deklaracji: INFO z jawnym mianownikiem", () => {
        const r = verifyAuditChain(
            anonymized({ ...decl, affected_count: 700, affected_ids_truncated: true }),
            noGuard,
        );
        const t = r.findings.find((f) => f.kind === "legal_break_truncated");
        expect(t?.severity).toBe("info");
        expect(t?.detail).toContain("2 z 700");
        expect(r.verdict).toBe("uwagi");
    });
});
