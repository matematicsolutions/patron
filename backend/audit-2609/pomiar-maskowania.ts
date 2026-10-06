// Audyt 2026-09, pomiar A-02: ile zlotych spanow PII wychodzi niezamaskowanych
// sciezka czatu (wrapConversation + plEntityDetector, jak lib/chat/stream.ts:371).
// Zestawy: repo matematic-anonimizacja-pl, katalog ewaluacja/ (format {{TYP|wartosc}}).
// Uruchomienie (z backend/): ZESTAWY=<sciezka do ewaluacja/> npx tsx audit-2609/pomiar-maskowania.ts
// Wypisuje tylko liczby per klasa - nigdy wartosci PII.
import { readFileSync } from "node:fs";
import path from "node:path";
import { wrapConversation } from "../src/lib/pseudonim/egress";
import { plEntityDetector } from "../src/lib/pseudonim";

const RE = /\{\{([A-Z_]+)\|([^{}]*)\}\}/g;

(async () => {
    const dir = process.env.ZESTAWY;
    if (!dir) throw new Error("ustaw ZESTAWY=<katalog ewaluacja/>");
    const tot: Record<string, [number, number]> = {};
    for (const n of [2, 3, 4, 5]) {
        const lines = readFileSync(path.join(dir, `zestaw_ukryty_${n}.txt`), "utf8")
            .split(/\r?\n/)
            .filter((l) => l.trim() && !l.startsWith("#"));
        for (const l of lines) {
            const gold = [...l.matchAll(RE)].map((m) => ({ t: m[1], v: m[2] }));
            const text = l.replace(RE, (_m, _t, v: string) => v);
            const w = await wrapConversation("", [{ role: "user", content: text }] as never, {
                llmDetector: plEntityDetector,
            });
            const out = JSON.stringify(w.messages);
            for (const g of gold) {
                if (g.t === "NIE") continue;
                tot[g.t] ??= [0, 0];
                tot[g.t][1]++;
                if (out.includes(g.v)) tot[g.t][0]++;
            }
        }
    }
    let a = 0;
    let b = 0;
    for (const [k, [x, y]] of Object.entries(tot)) {
        a += x;
        b += y;
        console.log(`${k} niezamaskowane ${x}/${y}`);
    }
    console.log(`SUMA ${a}/${b} (${((100 * a) / b).toFixed(1)}%)`);
})();
