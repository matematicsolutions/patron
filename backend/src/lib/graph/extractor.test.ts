// Testy graph extractora - orchestracja ekstrakcji + propozycja krawedzi
// grafu cytowan.

import { describe, expect, it } from "vitest";
import { extractEntitiesAndEdges } from "./extractor";

describe("extractEntitiesAndEdges - smoke", () => {
    it("zwraca pusta liste dla pustego tekstu", () => {
        const r = extractEntitiesAndEdges("doc-1", "");
        expect(r.docId).toBe("doc-1");
        expect(r.entities).toHaveLength(0);
        expect(r.edges).toHaveLength(0);
        expect(r.sourceTextLength).toBe(0);
    });

    it("zwraca docId i dlugosc tekstu", () => {
        const r = extractEntitiesAndEdges("doc-2", "tekst kontrolny");
        expect(r.docId).toBe("doc-2");
        expect(r.sourceTextLength).toBe("tekst kontrolny".length);
    });

    it("durationMs jest skonczone i nieujemne", () => {
        const r = extractEntitiesAndEdges("doc-3", "Wyrok SN III CZP 11/13");
        expect(r.durationMs).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(r.durationMs)).toBe(true);
    });
});

describe("extractEntitiesAndEdges - encje PII bez krawedzi", () => {
    it("PESEL i NIP NIE generuja krawedzi grafu (sa w tabeli extracted_entities)", () => {
        const text = "PESEL 44051401458, NIP 5252287009.";
        const r = extractEntitiesAndEdges("doc-pii", text);
        const types = r.entities.map((e) => e.type);
        expect(types).toContain("PESEL");
        expect(types).toContain("NIP");
        // Krawedzi PII brak (relationForEntity zwraca null)
        const piiEdges = r.edges.filter(
            (e) => e.relation === "wspomina_firme" || e.relation === "wspomina_osobe",
        );
        expect(piiEdges).toHaveLength(0);
    });
});

describe("extractEntitiesAndEdges - sygnatury orzeczen", () => {
    it("sygnatura SN z slowem-trigger dostaje boost confidence", () => {
        const text = "Wyrok SN, sygn. akt III CZP 11/13, dotyczyl...";
        const r = extractEntitiesAndEdges("doc-sn", text);
        const sig = r.entities.find((e) => e.type === "SYGNATURA_ORZECZENIA");
        expect(sig).toBeDefined();
        // base 0.85 + boost trigger 0.2 + prefix znany 0.1 = 1.0 (clamped)
        expect(sig!.confidence).toBeCloseTo(1.0, 1);
        expect(sig!.metadata?.court).toBe("sn");
        expect(sig!.metadata?.department).toContain("cywilna");
    });

    it("sygnatura WSA rozszyfrowuje sigPrefix miasta na konkretny WSA", () => {
        const text = "Wyrok II SA/Wa 1234/24";
        const r = extractEntitiesAndEdges("doc-wsa", text);
        const sig = r.entities.find((e) => e.type === "SYGNATURA_ORZECZENIA");
        expect(sig).toBeDefined();
        expect(sig!.metadata?.court).toBe("wsa-warszawa");
        expect(sig!.metadata?.city).toBe("Warszawa");
    });

    it("sygnatura SN bez slow-trigger ma base confidence + boost prefix", () => {
        const text = "Cytat: III CZP 11/13 jest istotny.";
        const r = extractEntitiesAndEdges("doc-noctx", text);
        const sig = r.entities.find((e) => e.type === "SYGNATURA_ORZECZENIA");
        expect(sig).toBeDefined();
        // base 0.85 + tylko boost prefix 0.1 = 0.95 (brak trigger)
        expect(sig!.confidence).toBeCloseTo(0.95, 1);
    });

    it("kazda sygnatura SYGNATURA_ORZECZENIA generuje krawedz cytuje_orzeczenie", () => {
        const text = "Wyrok sygn. akt III CZP 11/13 i II FSK 1234/22.";
        const r = extractEntitiesAndEdges("doc-multi-sig", text);
        const sigEdges = r.edges.filter((e) => e.relation === "cytuje_orzeczenie");
        expect(sigEdges.length).toBeGreaterThanOrEqual(2);
    });

    it("sygnatura sadu powszechnego (I C 100/26) generuje encje - regresja pustej tabeli", () => {
        // Regresja: wczesniej kod jednoliterowy "I C" nie byl lapany (SN_RE
        // wymaga 2-4 wielkich liter), wiec extracted_entities pozostawalo puste.
        const text = "Sygn. akt I C 100/26 - pozew o zaplate przeciwko pozwanemu.";
        const r = extractEntitiesAndEdges("doc-sr", text);
        const sig = r.entities.find((e) => e.type === "SYGNATURA_ORZECZENIA");
        expect(sig).toBeDefined();
        expect(sig!.value).toBe("I C 100/26");
        expect(sig!.ruleId).toBe("signature-sad-powszechny");
        // slowo-trigger "sygn. akt" w sasiedztwie -> krawedz cytuje_orzeczenie
        const edge = r.edges.find((e) => e.relation === "cytuje_orzeczenie");
        expect(edge).toBeDefined();
    });

    it("sygnatura apelacyjna (I ACa) wzbogaca metadata o sad apelacyjny z gazetteera", () => {
        const text = "Wyrok SA, sygn. akt I ACa 1234/23, oddalil apelacje.";
        const r = extractEntitiesAndEdges("doc-sa", text);
        const sig = r.entities.find((e) => e.type === "SYGNATURA_ORZECZENIA");
        expect(sig).toBeDefined();
        expect(sig!.metadata?.prefix).toBe("I ACa");
        expect(sig!.metadata?.court).toBe("sa-*");
    });
});

describe("extractEntitiesAndEdges - akty prawne CELEX/ELI", () => {
    it("CELEX generuje krawedz cytuje_przepis", () => {
        const text = "Zgodnie z 32024R1689 art. 12...";
        const r = extractEntitiesAndEdges("doc-celex", text);
        const e = r.entities.find((e) => e.ruleId === "celex-eu-act");
        expect(e).toBeDefined();
        const edge = r.edges.find((edge) => edge.relation === "cytuje_przepis");
        expect(edge).toBeDefined();
    });
});

describe("extractEntitiesAndEdges - firmy", () => {
    it("firma z forma prawna generuje krawedz wspomina_firme", () => {
        const text = "Acme sp. z o.o. zlozyla pozew.";
        const r = extractEntitiesAndEdges("doc-firma", text);
        const e = r.entities.find((e) => e.type === "FIRMA");
        expect(e).toBeDefined();
        // base confidence dla firmy 0.75 - jest >= 0.6 default minEdgeConfidence
        const edge = r.edges.find((edge) => edge.relation === "wspomina_firme");
        expect(edge).toBeDefined();
    });
});

describe("extractEntitiesAndEdges - opcje", () => {
    it("minEdgeConfidence=0.99 odsiewa wszystkie edges ponizej (TK low confidence)", () => {
        const text = "K 12/19 to wyrok TK.";
        const r = extractEntitiesAndEdges("doc-tk", text, { minEdgeConfidence: 0.99 });
        const sig = r.entities.find((e) => e.ruleId === "signature-tk");
        expect(sig).toBeDefined(); // encja jest
        // ale krawedz nie - TK base confidence 0.6, max boost +0.2 trigger - nadal <0.99
        const tkEdge = r.edges.find((e) => e.relation === "cytuje_orzeczenie");
        // moglo bys byc innych sig edges (np. K 12 w innym znaczeniu lapie inne reguly)
        // sprawdzamy tylko ze konkretny edge z TK signaturem nie istnieje
        if (tkEdge) {
            expect(tkEdge.confidence).toBeGreaterThanOrEqual(0.99);
        }
    });

    it("contextBoost=false nie podnosi confidence sygnatury", () => {
        const text = "sygn. akt III CZP 11/13";
        const rNoBoost = extractEntitiesAndEdges("a", text, { contextBoost: false });
        const rBoost = extractEntitiesAndEdges("b", text, { contextBoost: true });
        const sigNoBoost = rNoBoost.entities.find((e) => e.type === "SYGNATURA_ORZECZENIA")!;
        const sigBoost = rBoost.entities.find((e) => e.type === "SYGNATURA_ORZECZENIA")!;
        expect(sigBoost.confidence).toBeGreaterThan(sigNoBoost.confidence);
    });
});

describe("extractEntitiesAndEdges - integracja", () => {
    it("kompletny tekst z mixed encjami daje spojny ExtractionResult", () => {
        const text = `Pozew Acme sp. z o.o. (NIP 525-228-70-09, KRS: 0000028860)
przeciwko klientowi PESEL 44051401458. Powolujemy sie na wyrok SN
sygn. akt III CZP 11/13 oraz na wyrok II SA/Wa 1234/24. Regulacja
32024R1689 ma zastosowanie.`;
        const r = extractEntitiesAndEdges("doc-complex", text);
        // co najmniej: PESEL, NIP, KRS, 2 sygnatury, 1 firma, 1 CELEX
        expect(r.entities.length).toBeGreaterThanOrEqual(7);
        // krawedzi: nie PESEL/NIP/KRS, ale firma + 2 sygnatury + celex = 4
        expect(r.edges.length).toBeGreaterThanOrEqual(4);
        // duration > 0
        expect(r.durationMs).toBeGreaterThanOrEqual(0);
    });
});
