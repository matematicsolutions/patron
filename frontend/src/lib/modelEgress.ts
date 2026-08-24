// Czy WYBRANY model jest lokalny (no-egress) - warstwa frontu.
//
// Lustro `backend/src/lib/routing/egress.ts` (`egressForModel` / `isLocalModel`),
// ktore pozostaje ZRODLEM PRAWDY: backend BLOKUJE wyjscie, front tylko OPISUJE
// stan. Front i backend nie dziela kodu (osobne tsconfig i bundle), wiec prefiks
// jest tu powtorzony - `modelEgress.test.ts` pilnuje, zeby powtorka nie rozjechala
// sie z pickerem modeli (grupa "Lokalny" w ModelToggle).
//
// Regula jest waska CELOWO: lokalny jest wylacznie model z prefiksem "ollama/",
// czyli po TRANSPORCIE, nigdy po nazwie. "openrouter/speakleash/bielik-11b"
// wyglada polsko i lokalnie, a fizycznie wychodzi do infrastruktury OpenRoutera
// w USA. Wszystko, czego nie rozpoznajemy, jest chmura (fail-closed) - dokladnie
// jak `egressForModel`, ktore nieznany model mapuje na `us-with-dpa`.

export const OLLAMA_PREFIX = "ollama/";

/** True tylko dla modeli, ktorych ruch nie opuszcza maszyny mecenasa. */
export function isLocalModel(model: string): boolean {
    return model.startsWith(OLLAMA_PREFIX);
}
