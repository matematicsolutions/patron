// Zdarzenie SSE `error` po nieudanej turze czatu - jedno zrodlo dla czatu ogolnego
// (routes/chat.ts) i czatu sprawy (routes/projectChat.ts). Do 2026-10-06 czat sprawy
// - glowna powierzchnia mecenasa - dawal gluchy "Stream error", podczas gdy czat
// ogolny mowil, co padlo (brak klucza, model not found, 401, timeout). Zmierzone na
// spakowanej aplikacji: zgoda chmurowa sprawy bez klucza Gemini konczyla sie
// samym "Stream error".
//
// Komunikat to infrastrukturalny opis bledu providera/warstwy, nie tresc akt; mimo
// to tniemy do 240 znakow (ta sama granica co w logu).

export const STREAM_ERROR_MAX = 240;

export function streamErrorReason(err: unknown): string {
    const reason = err instanceof Error && err.message ? err.message : String(err);
    return `Blad generowania: ${reason}`.slice(0, STREAM_ERROR_MAX);
}

/** Gotowa linia SSE z typem `error`. */
export function streamErrorEvent(err: unknown): string {
    return `data: ${JSON.stringify({ type: "error", message: streamErrorReason(err) })}\n\n`;
}
