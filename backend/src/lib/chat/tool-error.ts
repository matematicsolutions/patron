// Blad narzedzia w wyniku dla MODELU (przeglad 2026-10-08). Komunikat bledu bywa
// nosnikiem schematu bazy (nazwy tabel i kolumn), sciezki z nazwa uzytkownika
// Windows albo fragmentu tresci pisma - a wynik narzedzia trafia do modelu, przy
// modelu chmurowym poza komputer. Model dostaje BIALA LISTE pol: staly kod,
// narzedzie i klase bledu (nazwa + kod, bez komunikatu). Pelny kontekst zostaje
// w lokalnym logu jako klasa bledu (R-CC-06).

import { logErrorClass } from "../log-error-class";

export interface BladNarzedzia {
    error: "tool_failed";
    tool: string;
    error_class: string;
    note: string;
}

export function bladNarzedziaDlaModelu(narzedzie: string, err: unknown): BladNarzedzia {
    const klasa = logErrorClass(err);
    console.warn(`[TOOL] ${narzedzie} failed:`, klasa);
    return {
        error: "tool_failed",
        tool: narzedzie,
        error_class: klasa,
        note: "Narzedzie nie powiodlo sie; szczegoly sa w logu aplikacji. Powiedz uzytkownikowi wprost, ze operacja sie nie udala.",
    };
}
