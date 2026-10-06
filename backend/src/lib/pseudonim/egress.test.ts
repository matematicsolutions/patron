import { describe, it, expect } from "vitest";
import {
    wrapConversation,
    PseudonimStreamUnwrapper,
} from "./egress";
import { unwrap } from "./wrap";
import { plEntityDetector } from "./plDetector";

// PESEL z poprawna checksuma (walidator je sprawdza). 44051401458 to znany
// testowy PESEL przechodzacy walidacje.
const PESEL = "44051401458";
const NIP = "1234563218"; // poprawny NIP (checksuma)

describe("wrapConversation - wspolna mapa", () => {
    it("maskuje PESEL w wiadomosci i pozwala odwrocic", async () => {
        const { messages, map } = await wrapConversation("System.", [
            { role: "user", content: `Klient ma PESEL ${PESEL}.` },
        ]);
        expect(messages[0].content).not.toContain(PESEL);
        expect(messages[0].content).toContain("[PESEL_1]");
        // unwrap odwraca
        expect(unwrap(messages[0].content, map)).toContain(PESEL);
    });

    it("ten sam identyfikator w roznych wiadomosciach -> ten sam token", async () => {
        const { messages } = await wrapConversation("Sys.", [
            { role: "user", content: `PESEL ${PESEL}` },
            { role: "assistant", content: "ok" },
            { role: "user", content: `znowu ${PESEL}` },
        ]);
        expect(messages[0].content).toContain("[PESEL_1]");
        expect(messages[2].content).toContain("[PESEL_1]");
    });

    it("maskuje PII takze w system prompt", async () => {
        const { systemPrompt, map } = await wrapConversation(
            `Dane: NIP ${NIP}`,
            [{ role: "user", content: "x" }],
        );
        expect(systemPrompt).not.toContain(NIP);
        expect(unwrap(systemPrompt, map)).toContain(NIP);
    });

    it("brak PII -> tekst niezmieniony", async () => {
        const { messages } = await wrapConversation("Sys", [
            { role: "user", content: "Jaka jest stawka VAT?" },
        ]);
        expect(messages[0].content).toBe("Jaka jest stawka VAT?");
    });
});

// Audyt 2026-09 A-03: oryginal rozpoznany raz (po kotwicy) jest maskowany w
// CALEJ konwersacji - takze tam, gdzie stoi bez kotwicy, w obie strony.
describe("wrapConversation - propagacja znanych oryginalow (A-03)", () => {
    const opts = { llmDetector: plEntityDetector };

    it("osoba z kotwica w 1. wiadomosci nie wychodzi jawnie w kolejnej", async () => {
        const w = await wrapConversation(
            "Jestes asystentem kancelarii.",
            [
                { role: "user", content: "Klientem jest Pan Jan Testowy." },
                { role: "assistant", content: "Rozumiem." },
                { role: "user", content: "Czy Jan Testowy moze zlozyc apelacje?" },
            ],
            opts,
        );
        expect(w.messages[0]!.content).not.toContain("Jan Testowy");
        expect(w.messages[2]!.content).not.toContain("Jan Testowy");
        const token = w.map.byOriginal.get("Jan Testowy")!;
        expect(w.messages[2]!.content).toContain(token);
        expect(unwrap(w.messages[2]!.content, w.map)).toBe(
            "Czy Jan Testowy moze zlozyc apelacje?",
        );
    });

    it("propagacja wstecz: osoba bez kotwicy WCZESNIEJ niz z kotwica, takze w system prompcie i historii asystenta", async () => {
        const w = await wrapConversation(
            "Sprawa dotyczy Jan Testowy.",
            [
                { role: "user", content: "Co z Jan Testowy?" },
                // historia asystenta zapisywana po odmaskowaniu (bez kotwic)
                { role: "assistant", content: "Jan Testowy ma termin do piatku." },
                { role: "user", content: "Mocodawca to Pan Jan Testowy." },
            ],
            opts,
        );
        expect(w.systemPrompt).not.toContain("Jan Testowy");
        for (const m of w.messages) expect(m.content).not.toContain("Jan Testowy");
        expect(new Set(w.map.tokens.map((t) => t.token)).size).toBe(w.map.tokens.length);
    });

    it("kontrola negatywna: brak kotwicy nigdzie -> bez propagacji (nie wymysla encji)", async () => {
        const w = await wrapConversation(
            "Sys.",
            [{ role: "user", content: "Czy Jan Testowy moze zlozyc apelacje?" }],
            opts,
        );
        expect(w.map.tokens).toHaveLength(0);
        expect(w.messages[0]!.content).toBe("Czy Jan Testowy moze zlozyc apelacje?");
    });

    it("oryginal wewnatrz innego slowa nie wyzwala maskowania (granica slowa)", async () => {
        const w = await wrapConversation(
            "Sys.",
            [
                { role: "user", content: "Klientem jest Pan Jan Testowy." },
                { role: "user", content: "Spolka XJan TestowyX nie jest strona." },
            ],
            opts,
        );
        expect(w.messages[1]!.content).toBe("Spolka XJan TestowyX nie jest strona.");
    });
});

describe("PseudonimStreamUnwrapper - strumien", () => {
    it("odwraca token przychodzacy w jednym kawalku", async () => {
        const { map } = await wrapConversation("", [
            { role: "user", content: `PESEL ${PESEL}` },
        ]);
        const u = new PseudonimStreamUnwrapper(map);
        let out = u.push("Pan [PESEL_1] zaplaci.");
        out += u.flush();
        expect(out).toBe(`Pan ${PESEL} zaplaci.`);
    });

    it("odwraca token ROZCIETY na granicy chunkow", async () => {
        const { map } = await wrapConversation("", [
            { role: "user", content: `PESEL ${PESEL}` },
        ]);
        const u = new PseudonimStreamUnwrapper(map);
        let out = "";
        out += u.push("Numer to [PES"); // token rozciety
        out += u.push("EL_1] gotowe"); // domkniecie
        out += u.flush();
        expect(out).toBe(`Numer to ${PESEL} gotowe`);
        // W trakcie rozciecia NIE wyemitowano polowki tokenu
        expect(out).not.toContain("[PES");
    });

    it("wstrzymuje ogon z niezamknietym nawiasem; token domkniety pozniej -> odwrocony", async () => {
        const { map } = await wrapConversation("", [
            { role: "user", content: `PESEL ${PESEL}` },
        ]);
        const u = new PseudonimStreamUnwrapper(map);
        const mid = u.push("tekst [PESEL_1");
        // nie ma `]`, wiec token wstrzymany - nie emitujemy go polowicznie
        expect(mid).toBe("tekst ");
        let end = u.push("]"); // domkniecie tokenu
        end += u.flush();
        expect(end).toBe(`${PESEL}`);
    });

    it("token NIGDY nie domkniety -> emitowany doslownie na flush (bez wycieku oryginalu)", async () => {
        const { map } = await wrapConversation("", [
            { role: "user", content: `PESEL ${PESEL}` },
        ]);
        const u = new PseudonimStreamUnwrapper(map);
        const mid = u.push("tekst [PESEL_1");
        expect(mid).toBe("tekst ");
        const end = u.flush();
        // Niekompletny token nie jest znany unwrap() - zostaje doslownie.
        // Najwazniejsze: oryginalny PESEL NIE wyciekl.
        expect(end).toBe("[PESEL_1");
        expect(end).not.toContain(PESEL);
    });

    it("zwykly tekst w nawiasach (np. przypis [1]) przechodzi bez zmian", async () => {
        const { map } = await wrapConversation("", [
            { role: "user", content: `PESEL ${PESEL}` },
        ]);
        const u = new PseudonimStreamUnwrapper(map);
        let out = u.push("Zobacz przypis [1] oraz [2].");
        out += u.flush();
        expect(out).toBe("Zobacz przypis [1] oraz [2].");
    });

    it("nieznany token zostaje (bezpieczne - bez ujawnienia)", async () => {
        const { map } = await wrapConversation("", [
            { role: "user", content: `PESEL ${PESEL}` },
        ]);
        const u = new PseudonimStreamUnwrapper(map);
        let out = u.push("[PERSON_99] nieznany");
        out += u.flush();
        expect(out).toBe("[PERSON_99] nieznany");
    });
});
