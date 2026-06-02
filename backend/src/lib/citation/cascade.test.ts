import { describe, it, expect, vi } from "vitest";
import { groundCascade, type JudgeFn, type JudgeVerdict } from "./cascade";
import type { ParsedCitation } from "../chat/types";

function cite(quote: string): ParsedCitation {
    return { ref: 1, doc_id: "D1", page: 1, quote };
}

// Deterministyczny fake sedziego - zwraca skonfigurowany werdykt, liczy wywolania.
function fakeJudge(v: JudgeVerdict): JudgeFn {
    return vi.fn().mockResolvedValue(v);
}

const SRC_ODDALIL = "Sąd oddalił powództwo w całości jako bezzasadne.";
const SRC_PRZEDAWNIENIE =
    "Roszczenie majątkowe ulega przedawnieniu z upływem lat trzech od dnia wymagalności.";

describe("groundCascade - BEZ sedziego (no-op semantyczny = zachowanie verifyOne)", () => {
    it("dokladne trafienie -> green, etap 1, confidence 1", async () => {
        const r = await groundCascade(cite("oddalił powództwo"), SRC_ODDALIL);
        expect(r.verdict).toBe("green");
        expect(r.stage).toBe(1);
        expect(r.confidence).toBe(1);
        expect(r.status).toBe("ZWERYFIKOWANY");
        expect(r.partial).toBe(false);
    });

    it("drobne roznice -> yellow, etap 2, partial", async () => {
        // 'powodztwo' vs 'powództwo' (1 znak ó->o) - ratio <= 0.15.
        const r = await groundCascade(cite("oddalił powodztwo"), SRC_ODDALIL);
        expect(r.verdict).toBe("yellow");
        expect(r.stage).toBe(2);
        expect(r.partial).toBe(true);
        expect(r.status).toBe("ZMODYFIKOWANY");
    });

    it("brak trafienia -> red", async () => {
        const r = await groundCascade(
            cite("zasądził od pozwanego kwotę pięćdziesięciu tysięcy złotych"),
            SRC_ODDALIL,
        );
        expect(r.verdict).toBe("red");
        expect(r.status).toBe("NIEZWERYFIKOWANY");
    });

    it("brak zrodla -> red, BRAK_ZRODLA", async () => {
        const r = await groundCascade(cite("cokolwiek"), null);
        expect(r.verdict).toBe("red");
        expect(r.status).toBe("BRAK_ZRODLA");
    });
});

describe("groundCascade - z sedzia (etap 3 semantyczny)", () => {
    it("FALSE-UNDER-TRUE (Stanford): cytat doslowny ale teza niewsparta -> judge 'nie' DEGRADUJE green->red", async () => {
        const judge = fakeJudge({
            verdict: "nie",
            confidence: "wysoka",
            uzasadnienie: "Zrodlo mowi o oddaleniu, teza twierdzi przeciwnie.",
        });
        const r = await groundCascade(cite("oddalił powództwo"), SRC_ODDALIL, {
            judge,
            claim: "Sąd uwzględnił powództwo w całości.",
        });
        // Deterministycznie cytat ISTNIEJE (status ZWERYFIKOWANY, decision verified),
        // ale judge degraduje werdykt doradczy do red - to jest sedno Stanford.
        expect(r.status).toBe("ZWERYFIKOWANY");
        expect(r.decision).toBe("verified"); // deterministyczna decision NIETKNIETA
        expect(r.verdict).toBe("red"); // werdykt doradczy zdegradowany
        expect(r.stage).toBe(3);
        expect(r.partial).toBe(false);
        expect(r.confidence).toBe(0.9);
        expect(judge).toHaveBeenCalledTimes(1);
    });

    it("parafraza: tekst nie trafia (red) ale judge 'tak' RATUJE do yellow (sens, nie verbatim)", async () => {
        const judge = fakeJudge({
            verdict: "tak",
            confidence: "srednia",
            uzasadnienie: "Zrodlo wyraza ten sam termin przedawnienia innym slownictwem.",
        });
        const r = await groundCascade(
            cite("termin przedawnienia roszczenia wynosi 3 lata"),
            SRC_PRZEDAWNIENIE,
            { judge, claim: "Roszczenie przedawnia się po trzech latach." },
        );
        expect(r.verdict).toBe("yellow");
        expect(r.stage).toBe(3);
        expect(r.partial).toBe(true);
        expect(r.confidence).toBe(0.7);
    });

    it("judge 'czesciowo' -> yellow + partial", async () => {
        const judge = fakeJudge({
            verdict: "czesciowo",
            confidence: "niska",
            uzasadnienie: "Zrodlo wspiera czesc tezy.",
        });
        const r = await groundCascade(cite("oddalił powództwo"), SRC_ODDALIL, {
            judge,
            claim: "Sąd oddalił powództwo, bo roszczenie było przedawnione.",
        });
        expect(r.verdict).toBe("yellow");
        expect(r.partial).toBe(true);
        expect(r.confidence).toBe(0.5);
    });

    it("judge 'tak' przy dokladnym trafieniu -> zostaje green", async () => {
        const judge = fakeJudge({
            verdict: "tak",
            confidence: "wysoka",
            uzasadnienie: "Zrodlo wprost wspiera teze.",
        });
        const r = await groundCascade(cite("oddalił powództwo"), SRC_ODDALIL, {
            judge,
            claim: "Sąd oddalił powództwo.",
        });
        expect(r.verdict).toBe("green");
        expect(r.stage).toBe(3);
        expect(r.partial).toBe(false);
    });
});

describe("groundCascade - bramki odpalenia sedziego", () => {
    it("judge podany ale BRAK claim -> sedzia NIE wolany (no-op tekstowy)", async () => {
        const judge = fakeJudge({
            verdict: "nie",
            confidence: "wysoka",
            uzasadnienie: "x",
        });
        const r = await groundCascade(cite("oddalił powództwo"), SRC_ODDALIL, {
            judge,
        });
        expect(judge).not.toHaveBeenCalled();
        expect(r.verdict).toBe("green"); // tekstowy, bez korekty sedziego
        expect(r.stage).toBe(1);
    });

    it("BRAK_ZRODLA + judge + claim -> sedzia NIE wolany (nie ma czego oceniac)", async () => {
        const judge = fakeJudge({
            verdict: "tak",
            confidence: "wysoka",
            uzasadnienie: "x",
        });
        const r = await groundCascade(cite("cokolwiek"), null, {
            judge,
            claim: "jakas teza",
        });
        expect(judge).not.toHaveBeenCalled();
        expect(r.verdict).toBe("red");
        expect(r.status).toBe("BRAK_ZRODLA");
    });

    it("judgeReason NIE pojawia sie bez sedziego (kandydat PII tylko z etapu 3)", async () => {
        const r = await groundCascade(cite("oddalił powództwo"), SRC_ODDALIL);
        expect(r.judgeReason).toBeUndefined();
    });
});
