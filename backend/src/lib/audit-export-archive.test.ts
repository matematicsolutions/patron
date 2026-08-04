// Archiwum eksportu audytowego (ADR-0142) - zawartosc i determinizm.

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
    ARCHIVE_ENTRIES,
    buildAuditExportArchive,
    toArchiveFilename,
} from "./audit-export-archive";
import {
    VERIFIER_HTML_FILENAME,
    VERIFIER_PY_FILENAME,
    VERIFIER_README_FILENAME,
} from "./audit-verifier-assets";

const ARTEFAKT = {
    schema_version: "1.0",
    pack_kind: "audit_event_export",
    exported_at: "2026-08-02T11:00:00.000Z",
    event: { id: 4, note: "art. 118 KC - sześć lat, Łódzkie Zakłady sp. z o.o." },
    integrity: { algorithm: "SHA-256", canonical_sha256: "a".repeat(64) },
};
const NAZWA_JSON = "audit-pack-event-4-20260802.json";
const ZNACZNIK = new Date("2026-08-02T11:00:00.000Z");

async function zbudujIRozpakuj() {
    const bufor = await buildAuditExportArchive({
        artifact: ARTEFAKT,
        artifactFilename: NAZWA_JSON,
        timestamp: ZNACZNIK,
    });
    return { bufor, zip: await JSZip.loadAsync(bufor) };
}

describe("buildAuditExportArchive", () => {
    it("pakuje artefakt razem z obydwoma weryfikatorami i instrukcja", async () => {
        const { zip } = await zbudujIRozpakuj();
        const nazwy = Object.keys(zip.files).sort();
        expect(nazwy).toEqual(
            [NAZWA_JSON, VERIFIER_HTML_FILENAME, VERIFIER_PY_FILENAME, VERIFIER_README_FILENAME].sort(),
        );
    });

    it("kazda pozycja z ARCHIVE_ENTRIES jest niepusta", async () => {
        const { zip } = await zbudujIRozpakuj();
        for (const nazwa of ARCHIVE_ENTRIES) {
            const plik = zip.file(nazwa);
            expect(plik, `brak ${nazwa} w archiwum`).not.toBeNull();
            const tresc = await plik!.async("string");
            expect(tresc.length, `${nazwa} jest puste`).toBeGreaterThan(200);
        }
    });

    it("weryfikatory w archiwum to dzialajace programy, nie zaslepki", async () => {
        const { zip } = await zbudujIRozpakuj();
        const html = await zip.file(VERIFIER_HTML_FILENAME)!.async("string");
        expect(html).toContain("<!doctype html>");
        expect(html).toContain("function sha256Hex");
        expect(html).toContain("function zweryfikuj");

        const py = await zip.file(VERIFIER_PY_FILENAME)!.async("string");
        expect(py).toContain("def canonical_sha256");
        expect(py).toContain("def verify_merkle_proof");
        expect(py).toContain("def verify_chain_links");
    });

    it("zachowuje polskie znaki w artefakcie po przejsciu przez archiwum", async () => {
        const { zip } = await zbudujIRozpakuj();
        const odczytany = JSON.parse(await zip.file(NAZWA_JSON)!.async("string")) as typeof ARTEFAKT;
        expect(odczytany.event.note).toBe(ARTEFAKT.event.note);
        expect(odczytany).toEqual(ARTEFAKT);
    });

    it("jest deterministyczne - te same dane daja bajt w bajt to samo archiwum", async () => {
        const a = await buildAuditExportArchive({
            artifact: ARTEFAKT,
            artifactFilename: NAZWA_JSON,
            timestamp: ZNACZNIK,
        });
        const b = await buildAuditExportArchive({
            artifact: ARTEFAKT,
            artifactFilename: NAZWA_JSON,
            timestamp: ZNACZNIK,
        });
        expect(a.equals(b)).toBe(true);
    });

    it("odrzuca nazwe artefaktu bez rozszerzenia .json", async () => {
        await expect(
            buildAuditExportArchive({
                artifact: ARTEFAKT,
                artifactFilename: "audit-pack-event-4",
                timestamp: ZNACZNIK,
            }),
        ).rejects.toThrow(/\.json/);
    });
});

describe("toArchiveFilename", () => {
    it("zamienia rozszerzenie json na zip", () => {
        expect(toArchiveFilename("audit-pack-event-4-20260802.json")).toBe(
            "audit-pack-event-4-20260802.zip",
        );
        expect(toArchiveFilename("audit-bundle-chat-7f3-20260802.json")).toBe(
            "audit-bundle-chat-7f3-20260802.zip",
        );
    });
});
