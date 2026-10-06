// Testy warstwy kart zatwierdzenia mutacji (ADR-0137). Swieza tymczasowa baza
// SQLite per uruchomienie (PATRON_DB_PATH) - jak supabase-shim.test.ts.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// `any`: createServerSupabase() zwraca shim bez generyka schematu - luzny typ
// w tescie jest swiadomy (jak w supabase-shim.test.ts).
let db: any;
let mod: typeof import("./mutation-approval");
// Realny dokument (FK mutation_approvals.document_id -> documents.id).
let docId: string;
const tmp = path.join(os.tmpdir(), `patron-mutapproval-test-${Date.now()}.db`);

beforeAll(async () => {
    process.env.PATRON_DB_BACKEND = "sqlite";
    process.env.PATRON_DB_PATH = tmp;
    const supa = await import("./supabase");
    db = supa.createServerSupabase();
    mod = await import("./mutation-approval");
    const doc = await db
        .from("documents")
        .insert({ user_id: "u1", filename: "pismo.docx", file_type: "docx", status: "ready" })
        .select()
        .single();
    docId = doc.data.id;
});

afterAll(async () => {
    const { closeDb } = await import("./db/sqlite-connection");
    closeDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
        try {
            fs.unlinkSync(f);
        } catch {
            /* ignore */
        }
    }
});

async function countAuditDecisions(): Promise<number> {
    const { data } = await db
        .from("audit_log")
        .select("id")
        .eq("event_type", "mutation.approval.decision");
    return (data ?? []).length;
}

describe("canTransition (reguly przejsc, fail-closed)", () => {
    it("tylko pending -> approved/rejected; terminalne stany zablokowane", () => {
        expect(mod.canTransition("pending", "approved")).toBe(true);
        expect(mod.canTransition("pending", "rejected")).toBe(true);
        expect(mod.canTransition("approved", "rejected")).toBe(false);
        expect(mod.canTransition("rejected", "approved")).toBe(false);
        expect(mod.canTransition("approved", "approved")).toBe(false);
    });
});

describe("isMutationApprovalEnabled (domyslnie ON, wylacznik =false)", () => {
    it("domyslnie ON (ADR-0137, aktualizacja 2026-10-06); OFF tylko przy jawnym false/off/0/no", () => {
        const prev = process.env.PATRON_MUTATION_APPROVAL;
        delete process.env.PATRON_MUTATION_APPROVAL;
        expect(mod.isMutationApprovalEnabled()).toBe(true);
        process.env.PATRON_MUTATION_APPROVAL = "";
        expect(mod.isMutationApprovalEnabled()).toBe(true);
        process.env.PATRON_MUTATION_APPROVAL = "true";
        expect(mod.isMutationApprovalEnabled()).toBe(true);
        for (const off of ["false", "FALSE", " off ", "0", "no"]) {
            process.env.PATRON_MUTATION_APPROVAL = off;
            expect(mod.isMutationApprovalEnabled(), off).toBe(false);
        }
        if (prev === undefined) delete process.env.PATRON_MUTATION_APPROVAL;
        else process.env.PATRON_MUTATION_APPROVAL = prev;
    });
});

describe("mutationStagingMode + shouldStageMutation (US3 polityka, ADR-0092)", () => {
    const setEnv = (v?: string) => {
        if (v === undefined) delete process.env.PATRON_MUTATION_APPROVAL;
        else process.env.PATRON_MUTATION_APPROVAL = v;
    };

    it("mode: brak/inne=all (fail-closed), false|off=off, high-stakes=high-stakes", () => {
        const prev = process.env.PATRON_MUTATION_APPROVAL;
        setEnv(undefined);
        expect(mod.mutationStagingMode()).toBe("all");
        setEnv("1");
        expect(mod.mutationStagingMode()).toBe("all");
        // Literowka nie wylacza bramki zapisu po cichu.
        setEnv("flase");
        expect(mod.mutationStagingMode()).toBe("all");
        setEnv("false");
        expect(mod.mutationStagingMode()).toBe("off");
        setEnv("off");
        expect(mod.mutationStagingMode()).toBe("off");
        setEnv("true");
        expect(mod.mutationStagingMode()).toBe("all");
        setEnv("all");
        expect(mod.mutationStagingMode()).toBe("all");
        setEnv("high-stakes");
        expect(mod.mutationStagingMode()).toBe("high-stakes");
        setEnv(prev);
    });

    it("off -> nie stage; all (takze domyslnie) -> stage zawsze", () => {
        const prev = process.env.PATRON_MUTATION_APPROVAL;
        setEnv("false");
        expect(mod.shouldStageMutation().stage).toBe(false);
        setEnv(undefined);
        expect(mod.shouldStageMutation().stage).toBe(true);
        setEnv("all");
        expect(mod.shouldStageMutation().stage).toBe(true);
        setEnv(prev);
    });

    it("high-stakes: FAIL-CLOSED gdy brak danych; auto-execute tylko gdy pewne low-stakes", () => {
        const prev = process.env.PATRON_MUTATION_APPROVAL;
        setEnv("high-stakes");
        // brak kontekstu -> isInputSufficient=false -> stage (fail-closed)
        expect(mod.shouldStageMutation({}).stage).toBe(true);
        // pewne low-stakes (notatka) -> auto-execute (nie stage)
        expect(mod.shouldStageMutation({ documentType: "notatka" }).stage).toBe(false);
        // high-stakes z definicji (opinia) -> stage
        expect(mod.shouldStageMutation({ documentType: "opinia" }).stage).toBe(true);
        // explicit override -> stage
        expect(mod.shouldStageMutation({ explicitFlag: true }).stage).toBe(true);
        setEnv(prev);
    });
});

describe("stageMutationApproval + scoping", () => {
    it("tworzy karte pending z round-trip tool_payload i scoping user_id", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            chatId: null,
            documentId: docId,
            toolName: "edit_document",
            toolPayload: { document_id: docId, edits: [{ find: "a", replace: "b" }] },
        });
        expect(card).not.toBeNull();
        expect(card!.status).toBe("pending");
        expect(card!.user_id).toBe("u1");
        expect(card!.tool_name).toBe("edit_document");
        // jsonb round-trip przez shim (JSON_COLUMNS.mutation_approvals).
        expect((card!.tool_payload.edits as unknown[]).length).toBe(1);
        expect(card!.staged_by).toBe("u1");
    });

    it("getPendingApprovals zwraca tylko karty danego usera", async () => {
        await mod.stageMutationApproval(db, {
            userId: "u2",
            toolName: "generate_docx",
            toolPayload: { title: "Pismo" },
        });
        const u1 = await mod.getPendingApprovals(db, "u1");
        const u2 = await mod.getPendingApprovals(db, "u2");
        expect(u1.every((c) => c.user_id === "u1")).toBe(true);
        expect(u2.every((c) => c.user_id === "u2")).toBe(true);
        expect(u2.length).toBe(1);
    });

    it("getApprovalById nie zwraca karty innego usera (izolacja)", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u3",
            toolName: "edit_document",
            toolPayload: {},
        });
        expect(await mod.getApprovalById(db, "u3", card!.id)).not.toBeNull();
        expect(await mod.getApprovalById(db, "u_other", card!.id)).toBeNull();
    });
});

describe("approveMutationApproval (wykonuje + audytuje)", () => {
    it("pending -> approved, executor wywolany, executed_at + audit (decision=approved)", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            documentId: docId,
            toolName: "edit_document",
            toolPayload: { ok: true },
        });
        const before = await countAuditDecisions();
        let executedWith: string | null = null;
        const res = await mod.approveMutationApproval(
            db,
            { id: card!.id, userId: "u1", actorId: "u1" },
            async (c) => {
                executedWith = c.id;
                return { ok: true, result: { version_id: "v1" } };
            },
        );
        expect(res.ok).toBe(true);
        expect(executedWith).toBe(card!.id);
        expect(res.card!.status).toBe("approved");
        expect(res.card!.approved_by).toBe("u1");
        expect(res.card!.executed_at).not.toBeNull();
        expect(res.card!.execution_error).toBeNull();
        expect(await countAuditDecisions()).toBe(before + 1);
    });

    it("executor zawodzi -> karta approved, execution_error ustawiony, ok=true (decyzja zaszla)", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            toolName: "generate_docx",
            toolPayload: {},
        });
        const res = await mod.approveMutationApproval(
            db,
            { id: card!.id, userId: "u1", actorId: "u1" },
            async () => ({ ok: false, error: "dokument zmieniony" }),
        );
        expect(res.ok).toBe(true);
        expect(res.execution!.ok).toBe(false);
        expect(res.card!.status).toBe("approved");
        expect(res.card!.executed_at).toBeNull();
        expect(res.card!.execution_error).toBe("dokument zmieniony");
    });

    it("C-08: wykonanie czesciowe -> karta oznaczona, audit niesie same liczby", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            documentId: docId,
            toolName: "edit_document",
            toolPayload: { edits: [{}, {}, {}] },
        });
        const res = await mod.approveMutationApproval(
            db,
            { id: card!.id, userId: "u1", actorId: "u1" },
            async () => ({
                ok: true,
                counts: { requested: 3, applied: 1, failed: 2 },
                failures: [
                    { index: 1, reason: 'Could not locate find="TAJNY-FRAGMENT-1"' },
                    { index: 2, reason: "Overlaps a previous edit in the same paragraph." },
                ],
                result: { applied: 1 },
            }),
        );
        expect(res.ok).toBe(true);
        expect(mod.isPartialExecution(res.execution!)).toBe(true);
        expect(res.card!.status).toBe("approved");
        expect(res.card!.executed_at).not.toBeNull();
        expect(res.card!.execution_error).toMatch(/zastosowano 1 z 3/);
        expect(res.card!.execution_error).toMatch(/#2: Could not locate/);

        const { data } = await db
            .from("audit_log")
            .select("payload")
            .eq("event_type", "mutation.approval.decision");
        const payloads = (data as { payload: unknown }[]).map((r) =>
            typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
        ) as Record<string, unknown>[];
        const mine = payloads.find((p) => p.approval_id === card!.id)!;
        expect(mine).toMatchObject({
            executed: true,
            partial: true,
            execution_error_present: true,
            requested: 3,
            applied: 1,
            failed: 2,
        });
        // Minimalizacja: powody (moga cytowac dokument) NIE ida do audit_log.
        expect(JSON.stringify(mine)).not.toContain("TAJNY-FRAGMENT-1");
    });

    it("C-08: pelny sukces z liczbami -> execution_error null, partial=false", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            documentId: docId,
            toolName: "add_comments",
            toolPayload: {},
        });
        const res = await mod.approveMutationApproval(
            db,
            { id: card!.id, userId: "u1", actorId: "u1" },
            async () => ({ ok: true, counts: { requested: 2, applied: 2, failed: 0 }, failures: [] }),
        );
        expect(mod.isPartialExecution(res.execution!)).toBe(false);
        expect(res.card!.execution_error).toBeNull();
    });

    it("fail-closed: brak karty -> 404; powtorne approve -> 409; nie-czlowiek -> 403", async () => {
        expect(
            (await mod.approveMutationApproval(db, { id: "nope", userId: "u1", actorId: "u1" }, async () => ({ ok: true }))).status,
        ).toBe(404);

        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            toolName: "edit_document",
            toolPayload: {},
        });
        await mod.approveMutationApproval(db, { id: card!.id, userId: "u1", actorId: "u1" }, async () => ({ ok: true }));
        const second = await mod.approveMutationApproval(db, { id: card!.id, userId: "u1", actorId: "u1" }, async () => ({ ok: true }));
        expect(second.status).toBe(409);

        const card2 = await mod.stageMutationApproval(db, {
            userId: "u1",
            toolName: "edit_document",
            toolPayload: {},
        });
        const nonHuman = await mod.approveMutationApproval(db, { id: card2!.id, userId: "u1", actorId: "system" }, async () => ({ ok: true }));
        expect(nonHuman.status).toBe(403);
    });
});

describe("rejectMutationApproval (zamyka + audytuje, bez wykonania)", () => {
    it("pending -> rejected z powodem, audit (decision=rejected)", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            toolName: "edit_document",
            toolPayload: {},
        });
        const before = await countAuditDecisions();
        const res = await mod.rejectMutationApproval(db, {
            id: card!.id,
            userId: "u1",
            actorId: "u1",
            reason: "niezgodne ze stanowiskiem",
        });
        expect(res.ok).toBe(true);
        expect(res.card!.status).toBe("rejected");
        expect(res.card!.rejection_reason).toBe("niezgodne ze stanowiskiem");
        expect(res.card!.executed_at).toBeNull();
        expect(await countAuditDecisions()).toBe(before + 1);
    });

    it("fail-closed: reject juz odrzuconej -> 409", async () => {
        const card = await mod.stageMutationApproval(db, {
            userId: "u1",
            toolName: "edit_document",
            toolPayload: {},
        });
        await mod.rejectMutationApproval(db, { id: card!.id, userId: "u1", actorId: "u1" });
        const second = await mod.rejectMutationApproval(db, { id: card!.id, userId: "u1", actorId: "u1" });
        expect(second.status).toBe(409);
    });
});

// Audyt 2026-09 C-06: przejscie stanu karty musi byc ATOMOWE. Na czystym shimie
// zapytania koncza sie w mikrozadaniach, wiec wyscig sie nie ujawnia - baze
// serwerowa (Postgres przez siec) symuluje ten sam shim z opoznieniem I/O na
// kazdym zapytaniu (kolejnosc i semantyka zapytan bez zmian).
function zOpoznieniem(baza: any, ms = 3): any {
    const owin = (q: any): any =>
        new Proxy(q, {
            get(t, prop) {
                if (prop === "then") {
                    return (ok: any, ko: any) =>
                        new Promise((r) => setTimeout(r, ms)).then(() => t.then(ok, ko));
                }
                const v = t[prop];
                if (typeof v !== "function") return v;
                return (...args: any[]) => {
                    const out = v.apply(t, args);
                    return out === t ? owin(t) : out && typeof out === "object" ? owin(out) : out;
                };
            },
        });
    return { ...baza, from: (table: string) => owin(baza.from(table)) };
}

/** Decyzje karty w audit_log - bez zdarzenia stagingu (phase "staged", C-09). */
async function decyzjeKarty(id: string): Promise<unknown[]> {
    const { data } = await db
        .from("audit_log")
        .select("payload")
        .eq("event_type", "mutation.approval.decision");
    return (data ?? [])
        .map((r: { payload: Record<string, unknown> }) => r.payload)
        .filter((p: Record<string, unknown>) => p.approval_id === id && p.phase !== "staged")
        .map((p: Record<string, unknown>) => p.decision);
}

describe("C-06: atomowe przejscie pending -> decyzja (baza z opoznieniem I/O)", () => {
    it("dwa rownolegle approve: jedno wykonanie, przegrany 409 bez wpisu decyzji", async () => {
        const wolna = zOpoznieniem(db);
        const card = await mod.stageMutationApproval(db, { userId: "u1", toolName: "generate_docx", toolPayload: {} });
        let wykonan = 0;
        const executor = async () => {
            wykonan++;
            await new Promise((r) => setTimeout(r, 10));
            return { ok: true };
        };
        const params = { id: card!.id, userId: "u1", actorId: "u1" };
        const [a, b] = await Promise.all([
            mod.approveMutationApproval(wolna, params, executor),
            mod.approveMutationApproval(wolna, params, executor),
        ]);
        expect(wykonan).toBe(1);
        expect([a.ok, b.ok].sort()).toEqual([false, true]);
        expect((a.ok ? b : a).status).toBe(409);
        expect(await decyzjeKarty(card!.id)).toEqual(["approved"]);
    });

    it("approve || reject: jedna decyzja, a stan karty zgodny z wykonaniem", async () => {
        const wolna = zOpoznieniem(db);
        const card = await mod.stageMutationApproval(db, { userId: "u1", toolName: "generate_docx", toolPayload: {} });
        let wykonan = 0;
        const [a, r] = await Promise.all([
            mod.approveMutationApproval(wolna, { id: card!.id, userId: "u1", actorId: "u1" }, async () => {
                wykonan++;
                return { ok: true };
            }),
            mod.rejectMutationApproval(wolna, { id: card!.id, userId: "u1", actorId: "u1", reason: "nie" }),
        ]);
        expect([a.ok, r.ok].filter(Boolean)).toHaveLength(1);
        expect((a.ok ? r : a).status).toBe(409);
        const decyzje = await decyzjeKarty(card!.id);
        const stan = (await mod.getApprovalById(db, "u1", card!.id))!.status;
        if (wykonan > 0) {
            expect(stan).toBe("approved");
            expect(decyzje).toEqual(["approved"]);
        } else {
            expect(stan).toBe("rejected");
            expect(decyzje).toEqual(["rejected"]);
        }
    });

    it("reject ze stara migawka 'pending' nie nadpisuje karty juz zatwierdzonej", async () => {
        const card = await mod.stageMutationApproval(db, { userId: "u1", toolName: "generate_docx", toolPayload: {} });
        await mod.approveMutationApproval(db, { id: card!.id, userId: "u1", actorId: "u1" }, async () => ({ ok: true }));
        // Odczyt w reject widzi 'pending' (migawka sprzed zatwierdzenia) -
        // dokladnie okno wyscigu z C-06. Decyduje dopiero warunek w UPDATE.
        const staraMigawka: any = {
            ...db,
            from: (table: string) => {
                const q = db.from(table);
                if (table === "mutation_approvals") {
                    q.maybeSingle = async () => {
                        const { data } = await db.from("mutation_approvals").select("*").eq("id", card!.id).single();
                        return { data: { ...data, status: "pending" }, error: null };
                    };
                }
                return q;
            },
        };
        const res = await mod.rejectMutationApproval(staraMigawka, { id: card!.id, userId: "u1", actorId: "u1" });
        expect(res.status).toBe(409);
        expect((await mod.getApprovalById(db, "u1", card!.id))!.status).toBe("approved");
        expect(await decyzjeKarty(card!.id)).toEqual(["approved"]);
    });

    it("blad zapisu decyzji: 500 fail-closed, bez wykonania i bez wpisu decyzji", async () => {
        const card = await mod.stageMutationApproval(db, { userId: "u1", toolName: "generate_docx", toolPayload: {} });
        const zepsuta: any = {
            ...db,
            from: (table: string) => {
                const q = db.from(table);
                if (table === "mutation_approvals") {
                    q.update = () => {
                        const blad: any = {
                            eq: () => blad,
                            select: () => Promise.resolve({ data: null, error: { message: "db down" } }),
                        };
                        return blad;
                    };
                }
                return q;
            },
        };
        let wykonan = 0;
        const res = await mod.approveMutationApproval(zepsuta, { id: card!.id, userId: "u1", actorId: "u1" }, async () => {
            wykonan++;
            return { ok: true };
        });
        expect(res.status).toBe(500);
        expect(wykonan).toBe(0);
        expect(await decyzjeKarty(card!.id)).toEqual([]);
        expect((await mod.getApprovalById(db, "u1", card!.id))!.status).toBe("pending");
    });
});
