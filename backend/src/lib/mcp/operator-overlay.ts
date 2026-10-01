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
//     przy starcie + ring-policy z `operatorApproved` przy kazdym wywolaniu);
//   - wpis bez nazwy albo w zlym ksztalcie jest pomijany Z OSTRZEZENIEM.

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
        configs.push({ ...b });
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
            for (const pole of POLA_DLA_ZAUFANYCH)
                if (zrodlo[pole] !== undefined) cel[pole] = zrodlo[pole];
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
        configs.push({ ...o });
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
    const overlay = czytajTablice(overlayPath, "nakladka", ostrzezenia);
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
    if (i === -1) lista.push({ name, enabled });
    else lista[i] = { ...(lista[i] as object), enabled };
    try {
        fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
        const tmp = `${overlayPath}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(lista, null, 2)}\n`, "utf-8");
        fs.renameSync(tmp, overlayPath);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: `write error: ${String(err)}` };
    }
}
