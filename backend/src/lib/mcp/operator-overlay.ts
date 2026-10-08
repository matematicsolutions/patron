// Nakladka konfiguracji konektorow MCP poza katalogiem instalacji (ADR-0166).
//
// `mcp-servers.json` lezy w katalogu instalacji (resources/backend) i jest
// generowany przez instalator. Aktualizacja NSIS KASUJE katalog instalacji
// (electron-builder, installUtil.nsh `uninstallOldVersion`), wiec wszystko, co
// Operator dopisal albo przelaczyl w tym pliku, ginelo przy kazdym update:
// konektor 3rd-party (np. weryfikator powolan, ADR-0157), jego zatwierdzenie
// bramy (ADR-0158) i przelaczniki pickera (ADR-0133). Po cichu.
//
// Nakladka zyje w katalogu uzytkownika, obok baseline bramy, ktory aktualizacje
// juz przezywa. Zasady scalania:
//   - konektor z instalatora: z nakladki bierzemy TYLKO `enabled` i
//     `gatewayApproval` (zatwierdzenie jest przypiete do hasha definicji, wiec
//     nie przepusci zmienionej definicji); command/args/url/operatorApproved
//     pochodza wylacznie z instalatora - nakladka nie podmieni konektora
//     zaufanego na inny proces;
//   - konektor spoza instalatora: caly wpis z nakladki (dalej Ring 2: brama
//     przy starcie - nieznana nazwa = `human_review` do zatwierdzenia
//     `gatewayApproval`, B-08 - + ring-policy przy kazdym wywolaniu, ktora
//     dopuszcza zgodne `gatewayApproval` albo `operatorApproved`);
//   - wpis bez nazwy albo w zlym ksztalcie jest pomijany Z OSTRZEZENIEM.
// Kazdy wpis wynikowy niesie `configSource` ("installer" | "operator-overlay"),
// ustawiany TUTAJ, nie czytany z plikow (pole o tej nazwie w pliku jest
// nadpisywane). Ring 1 (ring-policy) i zaufanie manifestu (ADR-0162) wymagaja
// "installer" - wpis z nakladki pod nazwa z APPROVED_PATRON_CONNECTORS zostaje
// Ring 2 (B-06 / R-MCP-01).

import fs from "fs";
import os from "os";
import path from "path";
import type { McpServerConfig } from "./index";

/** Pola, ktore nakladka moze ustawic konektorowi z instalatora. */
const POLA_DLA_ZAUFANYCH = ["enabled", "gatewayApproval"] as const;

export function operatorOverlayPath(): string {
    const env = process.env.PATRON_MCP_OPERATOR_CONFIG;
    if (env && env.trim()) return env.trim();
    return path.join(os.homedir(), ".patron", "mcp-servers.operator.json");
}

function czytajTablice(p: string, etykieta: string, ostrzezenia: string[]): unknown[] {
    if (!fs.existsSync(p)) return [];
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(p, "utf-8"));
        if (Array.isArray(parsed)) return parsed;
        ostrzezenia.push(`${etykieta}: plik nie jest tablica JSON - pominiety`);
    } catch (err) {
        ostrzezenia.push(`${etykieta}: blad parsowania - pominiety (${String(err)})`);
    }
    return [];
}

function maNazwe(x: unknown): x is McpServerConfig {
    return !!x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string"
        && (x as { name: string }).name.length > 0;
}

/**
 * Scala konfiguracje instalatora z nakladka Operatora. Czysta funkcja -
 * kolejnosc: konektory instalatora w ich kolejnosci, potem nowe z nakladki.
 */
export function mergeOperatorOverlay(
    bundled: readonly unknown[],
    overlay: readonly unknown[],
): { configs: McpServerConfig[]; warnings: string[] } {
    const warnings: string[] = [];
    const configs: McpServerConfig[] = [];
    const indeks = new Map<string, number>();
    for (const b of bundled) {
        if (!maNazwe(b)) {
            warnings.push("mcp-servers.json: wpis bez nazwy - pominiety");
            continue;
        }
        if (indeks.has(b.name)) continue;
        indeks.set(b.name, configs.length);
        configs.push({ ...b, configSource: "installer" });
    }
    const widziane = new Set<string>();
    for (const o of overlay) {
        if (!maNazwe(o)) {
            warnings.push("nakladka: wpis bez nazwy - pominiety");
            continue;
        }
        if (widziane.has(o.name)) {
            warnings.push(`nakladka: "${o.name}" wystepuje wiecej niz raz - liczy sie pierwszy wpis`);
            continue;
        }
        widziane.add(o.name);
        const i = indeks.get(o.name);
        if (i !== undefined) {
            const cel = { ...configs[i] } as Record<string, unknown>;
            const zrodlo = o as unknown as Record<string, unknown>;
            for (const pole of POLA_DLA_ZAUFANYCH) {
                const v = zrodlo[pole];
                if (v === undefined) continue;
                // Walidacja ksztaltu (przeglad 2026-10-02, R-MCP-04): "false", null
                // albo 0 nadpisywaly enabled:false instalatora, a loadConfig wylacza
                // tylko przy === false - konektor startowal bez ostrzezenia.
                const ok =
                    pole === "enabled"
                        ? typeof v === "boolean"
                        : !!v && typeof v === "object" && !Array.isArray(v);
                if (!ok) {
                    warnings.push(`nakladka: "${o.name}" pole ${pole} ma zly typ - zignorowane`);
                    continue;
                }
                cel[pole] = v;
            }
            const zignorowane = Object.keys(zrodlo).filter(
                (k) => k !== "name" && !(POLA_DLA_ZAUFANYCH as readonly string[]).includes(k),
            );
            if (zignorowane.length)
                warnings.push(
                    `nakladka: "${o.name}" pochodzi z instalatora - zignorowano pola ${zignorowane.join(", ")} (dozwolone: enabled, gatewayApproval)`,
                );
            configs[i] = cel as unknown as McpServerConfig;
            continue;
        }
        const t = (o as { transport?: unknown }).transport;
        if (t !== "stdio" && t !== "http") {
            warnings.push(`nakladka: "${o.name}" bez poprawnego transport (stdio|http) - pominiety`);
            continue;
        }
        indeks.set(o.name, configs.length);
        configs.push({ ...o, configSource: "operator-overlay" });
    }
    return { configs, warnings };
}

/** Odczyt instalator + nakladka (z jawnymi sciezkami - testowalne). */
export function readMergedConfig(
    bundledPath: string,
    overlayPath: string,
): { configs: McpServerConfig[]; warnings: string[] } {
    const ostrzezenia: string[] = [];
    const bundled = czytajTablice(bundledPath, "mcp-servers.json", ostrzezenia);
    const przedNakladka = ostrzezenia.length;
    let overlay = czytajTablice(overlayPath, "nakladka", ostrzezenia);
    if (fs.existsSync(overlayPath) && ostrzezenia.length > przedNakladka) {
        // Nakladka istnieje, ale jest nieczytelna (przeglad 2026-10-02, R-MCP-03).
        // Wylaczenia z pickera zyja TYLKO w niej - pusta nakladka przywracala po
        // cichu konektory wylaczone przez mecenasa. Najpierw ostatnia dobra kopia,
        // a bez niej fail-closed: konektory instalatora startuja wylaczone.
        const kopia = `${overlayPath}.bak`;
        const zKopii: string[] = [];
        const odczyt = fs.existsSync(kopia) ? czytajTablice(kopia, "nakladka.bak", zKopii) : null;
        if (odczyt && zKopii.length === 0) {
            overlay = odczyt;
            ostrzezenia.push(`nakladka nieczytelna - uzyto ostatniej dobrej kopii ${kopia}; popraw ${overlayPath}`);
        } else {
            const wynik = mergeOperatorOverlay(bundled, []);
            return {
                configs: wynik.configs.map((c) => ({ ...c, enabled: false })),
                warnings: [
                    ...ostrzezenia,
                    ...wynik.warnings,
                    `nakladka nieczytelna i brak dobrej kopii - wszystkie konektory WYLACZONE do czasu naprawy pliku ${overlayPath} (stanu przelacznikow Operatora nie da sie ustalic)`,
                ],
            };
        }
    }
    const wynik = mergeOperatorOverlay(bundled, overlay);
    return { configs: wynik.configs, warnings: [...ostrzezenia, ...wynik.warnings] };
}

/**
 * Zapis flagi `enabled` do NAKLADKI (upsert po nazwie, atomowo tmp+rename).
 * Pozostale pola wpisu nakladki zostaja nietkniete.
 */
export function writeEnabledToOverlay(
    overlayPath: string,
    name: string,
    enabled: boolean,
): { ok: boolean; error?: string } {
    return upsertOverlayEntry(overlayPath, name, { enabled });
}

/**
 * Zapis zatwierdzenia bramy (`gatewayApproval`, ADR-0158) do NAKLADKI - ta sama
 * procedura co przelacznik pickera (B-08: przycisk "Zatwierdz" zamiast recznej
 * edycji JSON). Wartosc musi przyjsc z biezacego skanu bramy; ksztalt pilnuje
 * tu tylko tego, zeby do pliku nie trafilo nic, czego resolveOperatorApproval
 * i tak nie uzna (fail-closed przy odczycie zostaje).
 */
export function writeGatewayApprovalToOverlay(
    overlayPath: string,
    name: string,
    approval: { hash: string; origin: string; approvedAt: string; approvedBy: string },
): { ok: boolean; error?: string } {
    const hex64 = /^[0-9a-f]{64}$/;
    if (!hex64.test(approval.hash) || !hex64.test(approval.origin))
        return { ok: false, error: "zatwierdzenie w zlym ksztalcie (hash/origin: 64 znaki hex)" };
    return upsertOverlayEntry(overlayPath, name, { gatewayApproval: { ...approval } });
}

/**
 * ADR-0167: wpis Repertorium (przelacznik "Repertorium w czacie"). Adres MCP niesie
 * klucz instalacji, wiec pilnujemy KSZTALTU: tylko https, tylko sciezka /mcp/<klucz>.
 * Zapisujemy wylacznie pola przelacznika - zatwierdzenie bramy (gatewayApproval)
 * i reszta wpisu Operatora zostaja nietkniete (upsert).
 */
export function writeRepertoriumToOverlay(
    overlayPath: string,
    name: string,
    patch: { url?: string; enabled: boolean; chatTools: boolean },
): { ok: boolean; error?: string } {
    const pola: Record<string, unknown> = { enabled: patch.enabled, chatTools: patch.chatTools };
    if (patch.url !== undefined) {
        if (!/^https:\/\/[a-z0-9.-]+\/mcp\/[A-Za-z0-9_-]{20,128}$/.test(patch.url))
            return { ok: false, error: "adres Repertorium w zlym ksztalcie" };
        pola.transport = "http";
        pola.url = patch.url;
    }
    return upsertOverlayEntry(overlayPath, name, pola);
}

function upsertOverlayEntry(
    overlayPath: string,
    name: string,
    patch: Record<string, unknown>,
): { ok: boolean; error?: string } {
    let lista: unknown[] = [];
    if (fs.existsSync(overlayPath)) {
        try {
            const parsed: unknown = JSON.parse(fs.readFileSync(overlayPath, "utf-8"));
            if (!Array.isArray(parsed))
                return { ok: false, error: "nakladka nie jest tablica JSON - nie nadpisuje" };
            lista = parsed;
        } catch (err) {
            // Uszkodzonej nakladki NIE nadpisujemy - moze niesc wpis Operatora.
            return { ok: false, error: `nakladka nieczytelna - nie nadpisuje (${String(err)})` };
        }
    }
    const i = lista.findIndex((x) => maNazwe(x) && x.name === name);
    if (i === -1) lista.push({ name, ...patch });
    else lista[i] = { ...(lista[i] as object), ...patch };
    try {
        fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
        // Nakladka moze niesc URL z kluczem weryfikatora - nowy plik dziedziczy
        // tryb oryginalu, a bez oryginalu 0600 (przeglad 2026-10-02, R-MCP-05).
        const tryb = fs.existsSync(overlayPath) ? fs.statSync(overlayPath).mode & 0o777 : 0o600;
        const tmp = `${overlayPath}.tmp`;
        const tresc = `${JSON.stringify(lista, null, 2)}\n`;
        fs.writeFileSync(tmp, tresc, { encoding: "utf-8", mode: tryb });
        fs.chmodSync(tmp, tryb);
        fs.renameSync(tmp, overlayPath);
        // Ostatnia dobra kopia na wypadek recznej edycji, ktora zepsuje plik (R-MCP-03).
        const kopia = `${overlayPath}.bak`;
        fs.writeFileSync(kopia, tresc, { encoding: "utf-8", mode: tryb });
        fs.chmodSync(kopia, tryb);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: `write error: ${String(err)}` };
    }
}
