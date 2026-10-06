import type { PATRONMessage } from "../shared/types";

/**
 * Model, ktorym powstala odpowiedz asystenta pod indeksem `index` (audyt
 * 2026-09, A-05): wlasne `model` wiadomosci, a gdy go nie ma - `model`
 * najblizszej wczesniejszej wiadomosci uzytkownika (z nia poszedl wybor
 * Operatora do /chat). Wiadomosci wczytane z bazy nie niosa modelu; wtedy
 * zwraca null, a panel draftu bierze biezacy wybor selektora czatu
 * (DraftRefinePanel), nigdy domyslny model chmurowy backendu.
 */
export function modelOfTurn(
    messages: readonly PATRONMessage[],
    index: number,
): string | null {
    const own = messages[index]?.model;
    if (own) return own;
    for (let i = index - 1; i >= 0; i--) {
        const m = messages[i];
        if (m?.role === "user") return m.model || null;
    }
    return null;
}
