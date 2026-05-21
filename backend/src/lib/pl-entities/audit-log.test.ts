// Testy pseudonim audit log (ADR-0013, pattern 5 cherry-pick PII-Shield).
//
// Cele testow:
// 1. detectResidualPII wykrywa "original" w tekscie po pseudonimizacji.
// 2. PseudonimAuditLog.append zapisuje linie w poprawnym formacie.
// 3. appendLlmCallOut RZUCA ResidualPIIError gdy PII zostalo - log
//    NIE zapisuje sukcesu.
// 4. formatAuditLine zachowuje stala kolejnosc pol (czytelnosc Inspektora).
// 5. Clock injection daje deterministyczny timestamp dla testow.

import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    PseudonimAuditLog,
    ResidualPIIError,
    detectResidualPII,
    formatAuditLine,
} from "./audit-log";

describe("detectResidualPII", () => {
    it("zwraca count=0 gdy wszystkie originals zastapione", () => {
        const placeholders = new Map<string, string>([
            ["Jan Kowalski", "[PERSON_1]"],
            ["12345678901", "[PESEL_1]"],
        ]);
        const promptAfterWrap = "Klient [PERSON_1] o numerze [PESEL_1] zlozyl wniosek.";
        const residual = detectResidualPII(promptAfterWrap, placeholders);
        expect(residual.count).toBe(0);
        expect(residual.samples).toEqual([]);
    });

    it("wykrywa pominiete original w tekscie", () => {
        const placeholders = new Map<string, string>([
            ["Jan Kowalski", "[PERSON_1]"],
            ["Anna Nowak", "[PERSON_2]"],
        ]);
        // Pseudonimizacja zastapila Jan Kowalski tokenem, ale pominela
        // Anna Nowak - exact match nadal w prompcie. Granica detektora
        // (fleksji "Anny Nowak" NIE wykryjemy - to robota wyzszej warstwy).
        const promptLeak = "Klient [PERSON_1] reprezentuje Anna Nowak.";
        const residual = detectResidualPII(promptLeak, placeholders);
        expect(residual.count).toBe(1);
        expect(residual.samples).toEqual(["Anna Nowak"]);
    });

    it("zwraca maksymalnie 3 sample dla logu wyjatku", () => {
        const placeholders = new Map<string, string>([
            ["AAA", "[X1]"],
            ["BBB", "[X2]"],
            ["CCC", "[X3]"],
            ["DDD", "[X4]"],
            ["EEE", "[X5]"],
        ]);
        const promptLeak = "AAA BBB CCC DDD EEE - nic nie zastapione.";
        const residual = detectResidualPII(promptLeak, placeholders);
        expect(residual.count).toBe(5);
        expect(residual.samples).toHaveLength(3);
        expect(residual.samples).toEqual(["AAA", "BBB", "CCC"]);
    });

    it("ignoruje originaly krotsze niz 2 znaki (false-positive guard)", () => {
        const placeholders = new Map<string, string>([
            ["A", "[X1]"],     // pojedyncza litera - ignored
            ["Jan", "[X2]"],   // 3 znaki - liczone
        ]);
        const promptLeak = "Litera A i Jan zostali.";
        const residual = detectResidualPII(promptLeak, placeholders);
        // "A" ignored (1 znak), "Jan" wykryty
        expect(residual.count).toBe(1);
        expect(residual.samples).toEqual(["Jan"]);
    });
});

describe("formatAuditLine", () => {
    const fixedTs = new Date("2026-05-21T18:42:13.123Z");

    it("formatuje pseudonim-applied z pelnym zestawem pol", () => {
        const line = formatAuditLine(fixedTs, {
            event: "pseudonim-applied",
            doc_id: "01HXY12345",
            source_hash: "sha256:abc123",
            entities: { OSOBA: 3, PESEL: 1, NIP: 2 },
            bytes_in: 12450,
            bytes_out: 12180,
        });
        expect(line).toBe(
            "2026-05-21T18:42:13.123Z | pseudonim-applied | doc_id=01HXY12345 | source_hash=sha256:abc123 | entities={OSOBA:3,PESEL:1,NIP:2} | bytes_in=12450 | bytes_out=12180",
        );
    });

    it("formatuje llm-call-out z minimalnymi polami", () => {
        const line = formatAuditLine(fixedTs, {
            event: "llm-call-out",
            bytes_out: 8200,
            pii_count: 0,
        });
        expect(line).toBe(
            "2026-05-21T18:42:13.123Z | llm-call-out | bytes_out=8200 | pii_count=0",
        );
    });

    it("pomija puste i undefined pola", () => {
        const line = formatAuditLine(fixedTs, {
            event: "mapping-cleanup",
            removed_sessions: 17,
        });
        expect(line).toBe(
            "2026-05-21T18:42:13.123Z | mapping-cleanup | removed_sessions=17",
        );
    });

    it("zachowuje stala kolejnosc pol (czytelnosc Inspektora)", () => {
        // Pola wstawione w odwroconej kolejnosci - format MUSI je posortowac.
        const line = formatAuditLine(fixedTs, {
            event: "pseudonim-applied",
            bytes_out: 100,
            bytes_in: 200,
            doc_id: "01HXY",
        });
        const fields = line.split(" | ");
        // [timestamp, event, doc_id, bytes_in, bytes_out]
        expect(fields[0]).toBe("2026-05-21T18:42:13.123Z");
        expect(fields[1]).toBe("pseudonim-applied");
        expect(fields[2]).toBe("doc_id=01HXY");
        expect(fields[3]).toBe("bytes_in=200");
        expect(fields[4]).toBe("bytes_out=100");
    });
});

// Helper: wspolny setup tmpdir + fixed clock dla testow audit log z FS I/O.
function setupAuditLogFs() {
    const ctx = {
        tmpDir: "",
        logPath: "",
        clock: () => new Date("2026-05-21T18:42:13.123Z"),
    };
    beforeEach(async () => {
        ctx.tmpDir = await mkdtemp(path.join(tmpdir(), "patron-audit-test-"));
        ctx.logPath = path.join(ctx.tmpDir, "pseudonim_audit.log");
    });
    afterEach(async () => {
        await rm(ctx.tmpDir, { recursive: true, force: true });
    });
    return ctx;
}

describe("PseudonimAuditLog.append", () => {
    const ctx = setupAuditLogFs();

    it("zapisuje linie zakonczona newlinem", async () => {
        const log = new PseudonimAuditLog(ctx.logPath, ctx.clock);
        await log.append({
            event: "pseudonim-applied",
            doc_id: "01HXY",
            entities: { OSOBA: 2 },
        });
        const content = await readFile(ctx.logPath, "utf8");
        expect(content).toBe(
            "2026-05-21T18:42:13.123Z | pseudonim-applied | doc_id=01HXY | entities={OSOBA:2}\n",
        );
    });

    it("appenduje kolejne linie bez nadpisania", async () => {
        const log = new PseudonimAuditLog(ctx.logPath, ctx.clock);
        await log.append({ event: "pseudonim-applied", doc_id: "doc1" });
        await log.append({ event: "llm-call-out", pii_count: 0 });
        const content = await readFile(ctx.logPath, "utf8");
        const lines = content.trim().split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain("pseudonim-applied | doc_id=doc1");
        expect(lines[1]).toContain("llm-call-out | pii_count=0");
    });
});

describe("PseudonimAuditLog.appendLlmCallOut", () => {
    const ctx = setupAuditLogFs();

    it("zapisuje linie llm-call-out gdy zero residual PII", async () => {
        const log = new PseudonimAuditLog(ctx.logPath, ctx.clock);
        const placeholders = new Map<string, string>([
            ["Jan Kowalski", "[PERSON_1]"],
        ]);
        const cleanPrompt = "Klient [PERSON_1] zlozyl wniosek.";
        await log.appendLlmCallOut(cleanPrompt, placeholders);
        const content = await readFile(ctx.logPath, "utf8");
        expect(content).toContain("llm-call-out");
        expect(content).toContain("pii_count=0");
        // bytes_out = liczba bajtow UTF-8 z cleanPrompt
        const expectedBytes = Buffer.byteLength(cleanPrompt, "utf8");
        expect(content).toContain(`bytes_out=${expectedBytes}`);
    });

    it("RZUCA ResidualPIIError i NIE zapisuje linii gdy PII residual", async () => {
        const log = new PseudonimAuditLog(ctx.logPath, ctx.clock);
        const placeholders = new Map<string, string>([
            ["Jan Kowalski", "[PERSON_1]"],
        ]);
        const leakedPrompt = "Klient Jan Kowalski zlozyl wniosek.";

        await expect(log.appendLlmCallOut(leakedPrompt, placeholders))
            .rejects.toThrow(ResidualPIIError);

        // Plik log MUSI byc pusty albo nie istniec - sukces NIE zostal zapisany.
        await expect(readFile(ctx.logPath, "utf8")).rejects.toThrow();
    });

    it("ResidualPIIError zawiera count i max 3 sample originals", async () => {
        const log = new PseudonimAuditLog(ctx.logPath, ctx.clock);
        const placeholders = new Map<string, string>([
            ["Anna", "[P1]"],
            ["Bartek", "[P2]"],
        ]);
        const leakedPrompt = "Anna i Bartek zostali pominieci.";

        try {
            await log.appendLlmCallOut(leakedPrompt, placeholders);
            expect.fail("Powinno rzucic ResidualPIIError");
        } catch (err) {
            expect(err).toBeInstanceOf(ResidualPIIError);
            const pii = err as ResidualPIIError;
            expect(pii.piiCount).toBe(2);
            expect(pii.samples).toEqual(["Anna", "Bartek"]);
        }
    });

    it("ResidualPIIError.message NIE zawiera wartosci PII (guarantee no PII leaves)", async () => {
        const log = new PseudonimAuditLog(ctx.logPath, ctx.clock);
        const placeholders = new Map<string, string>([
            ["TopSecretClientName", "[P1]"],
            ["98765432101", "[PESEL_1]"],
        ]);
        const leakedPrompt = "TopSecretClientName ma PESEL 98765432101.";

        try {
            await log.appendLlmCallOut(leakedPrompt, placeholders);
            expect.fail("Powinno rzucic ResidualPIIError");
        } catch (err) {
            expect(err).toBeInstanceOf(ResidualPIIError);
            const pii = err as ResidualPIIError;
            // .samples ma wartosci (caller decyduje co z nimi zrobic)
            expect(pii.samples).toContain("TopSecretClientName");
            expect(pii.samples).toContain("98765432101");
            // ALE .message NIE moze ich zawierac - caller ktory loguje err.message
            // (console.error, Sentry, winston) NIE moze ujawnic PII.
            expect(pii.message).not.toContain("TopSecretClientName");
            expect(pii.message).not.toContain("98765432101");
            // Sanity: message zachowuje czytelny komunikat z licznikiem.
            expect(pii.message).toContain("2 PII");
            expect(pii.message).toContain("ZATRZYMANY");
        }
    });
});
