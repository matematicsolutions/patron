// Bramka zgodnosci weryfikatorow doreczanych odbiorcy (ADR-0142).
//
// Sedno: weryfikator ma dac ten sam werdykt co kod Patrona - na artefakcie
// zdrowym ORAZ na kazdym rodzaju manipulacji. Test nie sprawdza, czy pliki
// "sa" w archiwum (to sprawdza audit-export-archive.test.ts), tylko czy
// LICZA TO SAMO. Weryfikator, ktory istnieje i myli sie w werdykcie, jest
// grozniejszy niz jego brak.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GENESIS_HASH, computeAuditHash } from "./audit";
import { buildMerkleProof, buildMerkleRoot } from "./audit-merkle";
import { buildAuditPack, canonicalSha256, type AuditPackEvent } from "./audit-pack";
import { buildAuditBundle } from "./audit-bundle";
import { VERIFIER_HTML, VERIFIER_PY } from "./audit-verifier-assets";
import type { GroundingResult } from "./citation/grounding";

// --- material testowy: prawdziwy lancuch zbudowany kodem produkcyjnym -------

const SUROWE = [
    { event_type: "chat.message.sent", payload: { role: "user", matter: "Sprawa I C 1043/25 - Łódzkie Zakłady sp. z o.o." } },
    { event_type: "llm.request", payload: { model: "claude-opus-5", entities_masked: 3 } },
    { event_type: "llm.response", payload: { model: "claude-opus-5", chars: 2841 } },
    { event_type: "citation.grounding", payload: { total: 4, verified: 3, note: "art. 118 KC - sześć lat" } },
    { event_type: "document.indexed", payload: { doc: "pozew.docx", pages: 12 } },
    { event_type: "mcp_security.gateway", payload: { connector: "mcp-saos", decision: "allowed-clean" } },
    { event_type: "chat.message.sent", payload: { role: "assistant", chars: 2841 } },
];

function zbudujZdarzenia(): AuditPackEvent[] {
    let prev = GENESIS_HASH;
    return SUROWE.map((r, i) => {
        const ts = `2026-08-0${(i % 9) + 1}T09:${String(10 + i).padStart(2, "0")}:00.000Z`;
        const hash = computeAuditHash({
            prev_hash: prev,
            ts,
            event_type: r.event_type,
            actor_user_id: "adw-kowalska",
            chat_id: "chat-7f3a1b90",
            document_id: null,
            payload: r.payload,
        });
        const wpis: AuditPackEvent = {
            id: i + 1,
            event_type: r.event_type,
            ts,
            actor_user_id: "adw-kowalska",
            chat_id: "chat-7f3a1b90",
            document_id: null,
            hash,
            prev_hash: prev,
            payload_masked: r.payload,
        };
        prev = hash;
        return wpis;
    });
}

const ZDARZENIA = zbudujZdarzenia();
const LISCIE = ZDARZENIA.map((e) => e.hash);
const CEL = ZDARZENIA[3];

const PACK = buildAuditPack({
    exporter: { user_id: "adw-kowalska", email: "kowalska@kancelaria.example" },
    event: CEL,
    bundle: {
        event_id: CEL.id,
        event_hash: CEL.hash,
        proof: buildMerkleProof(CEL.hash, LISCIE),
        merkle_root_id: 1,
        merkle_root: buildMerkleRoot(LISCIE),
        chain_block_start: 1,
        chain_block_end: ZDARZENIA.length,
    },
    exportedAt: "2026-08-02T11:00:00.000Z",
});

const BUNDLE = buildAuditBundle({
    chatId: "chat-7f3a1b90",
    deliverableMd:
        "# Opinia prawna\n\nRoszczenie uległo przedawnieniu z upływem sześcioletniego terminu (art. 118 zd. 1 KC).\n",
    citations: [
        { decision: "verified", citation: "art. 118 KC" },
        { decision: "unverified", citation: "III CZP 41/22" },
    ] as unknown as GroundingResult[],
    auditLogExcerpt: ZDARZENIA,
    modelVersions: { model: "claude-opus-5", patron: "2.0.0", connectors: { "mcp-saos": "0.3.1" } },
    costLog: { available: false, event_count: ZDARZENIA.length },
    createdAt: "2026-08-02T11:00:00.000Z",
});

const kopia = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/** Przelicza manifest i integrity - udaje podmieniajacego, ktory zaciera slady. */
function przypieczetuj(dok: Record<string, unknown>): Record<string, unknown> {
    const wartosci: Record<string, unknown> = {
        deliverable: dok.deliverable,
        citation_verification: dok.citation_verification,
        audit_log_excerpt: dok.audit_log_excerpt,
        model_versions: dok.model_versions,
        cost_log: dok.cost_log,
    };
    const manifest = dok.manifest as { parts: Array<{ name: string; sha256: string }> };
    for (const cz of manifest.parts) cz.sha256 = canonicalSha256(wartosci[cz.name]);
    const { integrity: _pominiete, ...cialo } = dok;
    void _pominiete;
    (dok.integrity as { canonical_sha256: string }).canonical_sha256 = canonicalSha256(cialo);
    return dok;
}

// --- weryfikator przegladarkowy --------------------------------------------

const ZNACZNIK_PODZIALU = "/* === PODPIĘCIE DO STRONY ===";

interface RdzenHtml {
    kanonicznySha256: (v: unknown) => string;
    zweryfikuj: (dok: unknown) => { ok: boolean; kroki: Array<{ ok: boolean; tytul: string }> };
}

/**
 * Wycina z HTML czesc bez dostepu do DOM i uruchamia ja w Node. Testowany jest
 * DOKLADNIE ten kod, ktory trafia do odbiorcy - nie jego kopia.
 */
function zaladujRdzenHtml(): RdzenHtml {
    const skrypt = VERIFIER_HTML.slice(
        VERIFIER_HTML.indexOf("<script>") + "<script>".length,
        VERIFIER_HTML.lastIndexOf("</script>"),
    );
    const podzial = skrypt.indexOf(ZNACZNIK_PODZIALU);
    expect(podzial, "verify.html musi zawierac znacznik podzialu rdzen/DOM").toBeGreaterThan(0);
    const rdzen = skrypt.slice(0, podzial);
    const fabryka = new Function(`${rdzen}\nreturn { kanonicznySha256, zweryfikuj };`);
    return fabryka() as RdzenHtml;
}

describe("weryfikator przegladarkowy (SPRAWDZ-TEN-PLIK.html)", () => {
    const rdzen = zaladujRdzenHtml();

    it("liczy te sama sume kontrolna co kod Patrona", () => {
        const przypadki: unknown[] = [
            {},
            [],
            { s: "Zażółć gęślą jaźń - Łódź" },
            { a: 1, b: -0, c: 1e21, d: 1e-7, e: 0.1, f: 9007199254740991 },
            { tekst: 'cudzysłów " i \\ oraz \t tabulator' },
            { zagniezdzone: [{ x: [1, [2, { y: null }]] }] },
            PACK,
            BUNDLE,
        ];
        for (const p of przypadki) {
            const przezJson = JSON.parse(JSON.stringify(p)) as unknown;
            expect(rdzen.kanonicznySha256(przezJson)).toBe(canonicalSha256(przezJson));
        }
    });

    it("uznaje zdrowy pack i zdrowy bundle za nienaruszone", () => {
        expect(rdzen.zweryfikuj(kopia(PACK)).ok).toBe(true);
        expect(rdzen.zweryfikuj(kopia(BUNDLE)).ok).toBe(true);
    });

    it("wykrywa zmiane tresci zdarzenia w packu", () => {
        const d = kopia(PACK);
        (d.event.payload_masked as { verified: number }).verified = 99;
        expect(rdzen.zweryfikuj(d).ok).toBe(false);
    });

    it("wykrywa podmieniony krok dowodu Merkle", () => {
        const d = kopia(PACK);
        d.merkle_proof_bundle.proof[0].hash = "0".repeat(64);
        expect(rdzen.zweryfikuj(d).ok).toBe(false);
    });

    it("wykrywa zmiane opinii w bundlu", () => {
        const d = kopia(BUNDLE);
        d.deliverable.content_md = d.deliverable.content_md.replace("uległo", "NIE uległo");
        expect(d.deliverable.content_md, "mutacja testowa musi faktycznie zmienic tresc").not.toBe(
            BUNDLE.deliverable.content_md,
        );
        expect(rdzen.zweryfikuj(d).ok).toBe(false);
    });

    it("wykrywa wpis usuniety ze srodka TEZ gdy podmieniajacy przeliczyl manifest", () => {
        const d = kopia(BUNDLE) as unknown as Record<string, unknown>;
        (d.audit_log_excerpt as AuditPackEvent[]).splice(3, 1);
        const wynik = rdzen.zweryfikuj(przypieczetuj(d));
        expect(wynik.ok).toBe(false);
        // przeliczony manifest i integrity sie zgadzaja - lape musi zalozyc
        // wylacznie kontrola ciaglosci ogniw
        const ciaglosc = wynik.kroki.find((k) => k.tytul.includes("Ciągłość"));
        expect(ciaglosc?.ok).toBe(false);
    });

    it("wykrywa przestawione wpisy TEZ po przeliczeniu manifestu", () => {
        const d = kopia(BUNDLE) as unknown as Record<string, unknown>;
        const wpisy = d.audit_log_excerpt as AuditPackEvent[];
        [wpisy[2], wpisy[4]] = [wpisy[4], wpisy[2]];
        expect(rdzen.zweryfikuj(przypieczetuj(d)).ok).toBe(false);
    });

    it("odmawia werdyktu dla nieznanej wersji schematu zamiast zglosic OK", () => {
        const d = kopia(PACK) as unknown as Record<string, unknown>;
        d.schema_version = "2.0";
        expect(() => rdzen.zweryfikuj(d)).toThrow();
    });
});

// --- weryfikator wiersza polecen -------------------------------------------

function pythonDostepny(): string | null {
    for (const kandydat of ["python", "python3", "py"]) {
        try {
            execFileSync(kandydat, ["--version"], { stdio: "ignore" });
            return kandydat;
        } catch {
            /* nastepny kandydat */
        }
    }
    return null;
}

const PYTHON = pythonDostepny();

describe.skipIf(PYTHON === null)("weryfikator wiersza polecen (verify.py)", () => {
    const katalog = mkdtempSync(join(tmpdir(), "patron-verify-"));
    const sciezkaVerify = join(katalog, "verify.py");
    writeFileSync(sciezkaVerify, VERIFIER_PY, "utf8");

    function uruchom(artefakt: unknown, nazwa: string): number {
        const plik = join(katalog, `${nazwa}.json`);
        writeFileSync(plik, JSON.stringify(artefakt, null, 2), "utf8");
        const wynik = spawnSync(PYTHON as string, [sciezkaVerify, plik], { encoding: "utf8" });
        return wynik.status ?? -1;
    }

    it("konczy sie zerem na zdrowym packu i zdrowym bundlu", () => {
        expect(uruchom(PACK, "pack-czysty")).toBe(0);
        expect(uruchom(BUNDLE, "bundle-czysty")).toBe(0);
    });

    it("konczy sie jedynka na zmienionej tresci zdarzenia", () => {
        const d = kopia(PACK);
        (d.event.payload_masked as { verified: number }).verified = 99;
        expect(uruchom(d, "pack-zmieniony")).toBe(1);
    });

    it("konczy sie jedynka na podmienionym dowodzie Merkle", () => {
        const d = kopia(PACK);
        d.merkle_proof_bundle.proof[0].hash = "0".repeat(64);
        expect(uruchom(d, "pack-dowod")).toBe(1);
    });

    it("konczy sie jedynka na wpisie usunietym ze srodka po przeliczeniu manifestu", () => {
        const d = kopia(BUNDLE) as unknown as Record<string, unknown>;
        (d.audit_log_excerpt as AuditPackEvent[]).splice(3, 1);
        expect(uruchom(przypieczetuj(d), "bundle-usuniety")).toBe(1);
    });

    it("konczy sie dwojka na pliku, ktory nie jest JSON-em", () => {
        const plik = join(katalog, "smiec.json");
        writeFileSync(plik, "to nie jest json", "utf8");
        const wynik = spawnSync(PYTHON as string, [sciezkaVerify, plik], { encoding: "utf8" });
        expect(wynik.status).toBe(2);
    });

    it("daje ten sam werdykt co weryfikator przegladarkowy", () => {
        const rdzen = zaladujRdzenHtml();
        const warianty: Array<[string, unknown]> = [
            ["zdrowy-pack", kopia(PACK)],
            ["zdrowy-bundle", kopia(BUNDLE)],
        ];
        const zepsutyPack = kopia(PACK);
        (zepsutyPack.event.payload_masked as { total: number }).total = 77;
        warianty.push(["zepsuty-pack", zepsutyPack]);

        for (const [nazwa, artefakt] of warianty) {
            const zHtml = rdzen.zweryfikuj(artefakt).ok;
            const zPythona = uruchom(artefakt, `zgodnosc-${nazwa}`) === 0;
            expect(zPythona, `rozjazd werdyktow dla ${nazwa}`).toBe(zHtml);
        }
    });
});
