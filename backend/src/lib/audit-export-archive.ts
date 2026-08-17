// Archiwum eksportu audytowego doreczane DRUGIEJ STRONIE (ADR-0142).
//
// Problem, ktory to rozwiazuje: Patron potrafil zbudowac artefakt audytowy
// (audit pack ADR-0047, audit bundle ADR-0066) i zweryfikowac go WLASNYM
// skryptem z katalogu backend/. Odbiorca - sad, regulator, klient kancelarii -
// dostawal sam plik JSON z instrukcja "uruchom z katalogu backend/", ktorego
// nie posiada. Zeby ja wykonac, musialby sklonowac repozytorium na AGPL-3.0
// i zainstalowac kilkaset pakietow npm. W praktyce nie weryfikowal niczego.
//
// Rozwiazanie: eksport zwraca archiwum ZIP, w ktorym obok artefaktu jada dwa
// samodzielne weryfikatory (audit-verifier-assets.ts) i instrukcja. Odbiorca
// potrzebuje przegladarki albo Pythona 3 - nic wiecej, zero sieci, zero
// dostepu do systemu kancelarii.
//
// Wzorzec: weryfikator W PACZCE eksportu - b1rdmania/legalise (MIT),
// `backend/app/core/export_chain_verifier.py`. Podniesiony sam wzorzec,
// implementacja MateMatic od zera. Patrz THIRD_PARTY_INSPIRATIONS.md.

import JSZip from "jszip";

import {
    VERIFIER_HTML,
    VERIFIER_HTML_FILENAME,
    VERIFIER_PY,
    VERIFIER_PY_FILENAME,
    VERIFIER_README,
    VERIFIER_README_FILENAME,
} from "./audit-verifier-assets";

/** Nazwy plikow, ktore MUSZA znalezc sie w kazdym archiwum eksportu. */
export const ARCHIVE_ENTRIES = [
    VERIFIER_HTML_FILENAME,
    VERIFIER_PY_FILENAME,
    VERIFIER_README_FILENAME,
] as const;

export interface BuildExportArchiveArgs {
    /** Artefakt audytowy (audit pack albo audit bundle) - serializowany do JSON. */
    artifact: unknown;
    /** Nazwa pliku JSON w archiwum, np. `audit-pack-event-4-20260802.json`. */
    artifactFilename: string;
    /**
     * Znacznik czasu wpisywany do naglowkow ZIP. Caller podaje wprost (zamiast
     * Date.now() wewnatrz), zeby archiwum bylo deterministyczne - te same dane
     * wejsciowe daja bajt w bajt to samo archiwum, wiec da sie je porownac.
     */
    timestamp: Date;
}

/**
 * Sklada archiwum ZIP: artefakt + oba weryfikatory + instrukcja.
 *
 * Artefakt zapisujemy z wcieciem 2 - odbiorca ma prawo otworzyc plik w
 * notatniku i przeczytac, co podpisuje. Wciecie nie wplywa na weryfikacje,
 * bo suma kontrolna liczona jest z serializacji kanonicznej, nie z bajtow
 * pliku.
 */
export async function buildAuditExportArchive(
    args: BuildExportArchiveArgs,
): Promise<Buffer> {
    if (!args.artifactFilename.endsWith(".json")) {
        throw new Error(
            `audit-export-archive: artifactFilename musi konczyc sie na .json, dostano ${args.artifactFilename}`,
        );
    }

    const zip = new JSZip();
    const date = args.timestamp;

    zip.file(args.artifactFilename, JSON.stringify(args.artifact, null, 2), { date });
    zip.file(VERIFIER_README_FILENAME, VERIFIER_README, { date });
    zip.file(VERIFIER_HTML_FILENAME, VERIFIER_HTML, { date });
    zip.file(VERIFIER_PY_FILENAME, VERIFIER_PY, { date });

    return zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        // Poziom 6: archiwum ma wazyc malo w zalaczniku mailowym, ale czas
        // pakowania nie moze blokowac odpowiedzi HTTP przy kazdym eksporcie.
        compressionOptions: { level: 6 },
    });
}

/** Zamienia `audit-pack-event-4-20260802.json` na `...zip`. */
export function toArchiveFilename(jsonFilename: string): string {
    return jsonFilename.replace(/\.json$/, ".zip");
}
