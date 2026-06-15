// Smoke test integracyjny warstwy pseudonim PII - realny fragment pisma
// procesowego z PESEL/NIP/imionami. Demonstruje wrap -> simulated LLM
// -> unwrap okraglosc na zbudowanym dist/. Uruchamiac PO npm run build.
//
// node scripts/smoke-pseudonim.mjs
//
// Skrypt jednorazowy weryfikacyjny - nie czesc produkcyjnej dystrybucji.
import { wrap, unwrap } from "../dist/lib/pseudonim/index.js";

const fragmentPisma = `
POZEW O ZAPLATE

W imieniu powoda Jana Kowalskiego (PESEL 44051401359), zamieszkalego
przy ulicy Marszalkowskiej 1 w Warszawie, wnoszacego o:

1) zasadzenie od pozwanej ABC sp. z o.o. (NIP 526-000-12-46, KRS 0000028860)
   na rzecz Jana Kowalskiego kwoty 50000 zlotych;
2) zasadzenie od pozwanej kosztow postepowania.

Powod Jan Kowalski wyjasnia, ze pozwana ABC sp. z o.o. zawarla z nim
umowe w dniu 15 marca 2025 roku. Mail kontaktowy powoda:
jan.kowalski@kancelaria.pl, telefon +48 123 456 789.
`.trim();

console.log("=== INPUT (co prawnik wkleja do Patrona) ===");
console.log(fragmentPisma);

// Symulujemy LLM-detektor. W produkcji to byloby Ollama qwen3.5:4b z
// promptem POLISH_DETECTION_PROMPT (prompts.pl.ts). Tu hardcoded hits.
const stubLlm = {
    async detect() {
        return [
            { span: "Jan Kowalski", category: "PERSON" },
            { span: "Jana Kowalskiego", category: "PERSON" },  // celownik fleksja
            { span: "ABC sp. z o.o.", category: "ORG" },
        ];
    },
};

const { prompt, map } = await wrap(fragmentPisma, { llmDetector: stubLlm });

console.log("\n=== PROMPT WYSYLANY DO GEMINI/CLAUDE/OPENAI ===");
console.log(prompt);

console.log("\n=== MAPA TOKENOW (zostaje w Postgresie kancelarii) ===");
for (const t of map.tokens) {
    console.log(`  ${t.token.padEnd(12)} = ${t.category.padEnd(8)} -> "${t.original}"`);
}

// Symulacja: LLM odpowiada uzywajac tokenow zwrotnie
const symLlmAnswer = `
Wedlug zalozonego stanu faktycznego, powod [PERSON_1] (PESEL [PESEL_1])
ma prawo dochodzic od pozwanej [ORG_1] (NIP [NIP_1], KRS [KRS_1]) kwoty
50000 zlotych. Rekomenduje skontaktowac sie z [PERSON_1] pod adresem
[EMAIL_1] lub telefonem [PHONE_1] w celu doprecyzowania stanowiska.
Dodatkowo [PERSON_2] (forma celownikowa imienia powoda) powinien byc
informowany o przebiegu postepowania.
`.trim();

console.log("\n=== SYMULOWANA ODPOWIEDZ LLM (zawiera tylko tokeny) ===");
console.log(symLlmAnswer);

const final = unwrap(symLlmAnswer, map);

console.log("\n=== OUTPUT KONCOWY (po unwrap, widzi prawnik) ===");
console.log(final);

// Walidacje krytyczne
console.log("\n=== WALIDACJE BEZPIECZENSTWA ===");
const checks = [
    ["prompt NIE zawiera PESEL 44051401359", !prompt.includes("44051401359")],
    ["prompt NIE zawiera 'Jan Kowalski'", !prompt.includes("Jan Kowalski")],
    ["prompt NIE zawiera NIP 526-000-12-46", !prompt.includes("526-000-12-46")],
    ["prompt NIE zawiera 'ABC sp. z o.o.'", !prompt.includes("ABC sp. z o.o.")],
    ["prompt NIE zawiera 'jan.kowalski@kancelaria.pl'", !prompt.includes("jan.kowalski@kancelaria.pl")],
    ["prompt NIE zawiera '+48 123 456 789'", !prompt.includes("+48 123 456 789")],
    ["output zawiera 'Jan Kowalski' po unwrap", final.includes("Jan Kowalski")],
    ["output zawiera PESEL 44051401359 po unwrap", final.includes("44051401359")],
    ["output zawiera NIP 526-000-12-46 po unwrap", final.includes("526-000-12-46")],
    ["mapa ma >= 5 tokenow", map.tokens.length >= 5],
];
for (const [name, ok] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}
const allPass = checks.every(([, ok]) => ok);
console.log(`\n${allPass ? "ALL GREEN - warstwa dziala koncepcyjnie" : "FAIL - sprawdz powyzej"}`);
process.exit(allPass ? 0 : 1);
