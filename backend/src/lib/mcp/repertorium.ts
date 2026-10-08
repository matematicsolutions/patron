// ADR-0167: przelacznik "Repertorium w czacie" (edycja PL).
//
// Wlaczenie: gdy w nakladce Operatora nie ma jeszcze adresu Repertorium, Patron
// prosi Repertorium o klucz instalacji (`POST /wydaj-patron`, bez sekretu - klasa
// `patron`, `zapis: false`, limity po stronie Repertorium) i zapisuje adres MCP
// w nakladce (ADR-0166). Potem ustawia `chatTools: true`: do czatu wchodza
// wylacznie narzedzia odczytu z VERIFIER_CHAT_TOOLS (verifier.ts).
// Wylaczenie: `chatTools: false`. Konektor zostaje dla przycisku "Sprawdz
// powolania", ktory wysyla tylko liste powolan i tylko na klikniecie (ADR-0157).
//
// Klucz (adres MCP) nie wraca w odpowiedzi API i nie trafia do logu ani audytu.
// Zmiana wchodzi w zycie po restarcie, jak kazdy przelacznik konektora; nowa
// definicja przechodzi brame (human_review) i zatwierdzenie Operatora (ADR-0158).

import { getAgentLocale } from "../chat/prompts";
import { listConnectorConfigs } from "./index";
import { operatorOverlayPath, writeRepertoriumToOverlay } from "./operator-overlay";
import { verifierServerName } from "./verifier";

export const REPERTORIUM_ADRES = "https://repertorium.matematicsolutions.com";

export type WynikKlucza =
    | { ok: true; mcp: string }
    | { ok: false; status: number; powod: string; szczegol: string; retryAfterS?: number };

/** Klucz instalacji z Repertorium. Nigdy nie rzuca; adres MCP tylko w wyniku. */
export async function pobierzKluczPatrona(
    fetchImpl: typeof fetch = fetch,
    adres: string = REPERTORIUM_ADRES,
): Promise<WynikKlucza> {
    let r: Response;
    try {
        r = await fetchImpl(`${adres}/wydaj-patron`, {
            method: "POST",
            headers: { "content-type": "application/json", "user-agent": "patron-desktop" },
            body: "{}",
            signal: AbortSignal.timeout(15_000),
        });
    } catch {
        return { ok: false, status: 503, powod: "repertorium_unreachable",
                 szczegol: "Nie udalo sie polaczyc z Repertorium. Sprawdz internet i sprobuj ponownie." };
    }
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) {
        return {
            ok: false,
            status: r.status,
            powod: typeof j.error === "string" ? j.error : "issuance_failed",
            szczegol: typeof j.detail === "string" ? j.detail : "Repertorium nie wydalo klucza.",
            ...(typeof j.retry_after_s === "number" ? { retryAfterS: j.retry_after_s } : {}),
        };
    }
    const mcp = typeof j.mcp === "string" ? j.mcp : "";
    if (!mcp.startsWith(`${adres}/mcp/`)) {
        return { ok: false, status: 502, powod: "issuance_bad_response",
                 szczegol: "Repertorium oddalo odpowiedz bez adresu konektora." };
    }
    return { ok: true, mcp };
}

export type WynikPrzelacznika =
    | { ok: true; enabled: boolean; kluczWydany: boolean }
    | { ok: false; status: number; detail: string; powod?: string; retryAfterS?: number };

/** Przelacza Repertorium w czacie. Wylacznie edycja PL. */
export async function przelaczRepertoriumWCzacie(
    enabled: boolean,
    deps: {
        pobierzKlucz?: () => Promise<WynikKlucza>;
        overlayPath?: string;
        konfiguracje?: () => { name: string; url?: string }[];
        locale?: () => string;
    } = {},
): Promise<WynikPrzelacznika> {
    if ((deps.locale ?? getAgentLocale)() !== "pl")
        return { ok: false, status: 404, detail: "Repertorium w czacie jest dostepne w edycji PL." };
    const nazwa = verifierServerName();
    const sciezka = deps.overlayPath ?? operatorOverlayPath();
    const obecny = (deps.konfiguracje ?? listConnectorConfigs)().find((c) => c.name === nazwa);

    if (!enabled) {
        // Bez wpisu nie ma czego wylaczac - pusty wpis bez adresu zasmiecalby nakladke.
        if (!obecny) return { ok: true, enabled: false, kluczWydany: false };
        const zapis = writeRepertoriumToOverlay(sciezka, nazwa, { enabled: true, chatTools: false });
        return zapis.ok
            ? { ok: true, enabled: false, kluczWydany: false }
            : { ok: false, status: 500, detail: `Nie zapisano ustawienia: ${zapis.error}` };
    }

    let url: string | undefined;
    let kluczWydany = false;
    if (!obecny?.url) {
        const k = await (deps.pobierzKlucz ?? (() => pobierzKluczPatrona()))();
        if (!k.ok) {
            return {
                ok: false,
                status: k.status === 429 ? 429 : 502,
                detail: k.szczegol,
                powod: k.powod,
                ...(k.retryAfterS !== undefined ? { retryAfterS: k.retryAfterS } : {}),
            };
        }
        url = k.mcp;
        kluczWydany = true;
    }
    const zapis = writeRepertoriumToOverlay(sciezka, nazwa, { url, enabled: true, chatTools: true });
    return zapis.ok
        ? { ok: true, enabled: true, kluczWydany }
        : { ok: false, status: 500, detail: `Nie zapisano ustawienia: ${zapis.error}` };
}
