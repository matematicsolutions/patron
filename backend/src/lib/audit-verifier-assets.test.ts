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
import {
    buildAuditPack,
    canonicalSha256,
    recomputePackEventHash,
    resolveLegalBreak,
    toVerifiablePackEvent,
    verifyAuditPack,
    verifyAuditPackIntegrity,
    verifyPackEventBinding,
    type AuditPackEvent,
} from "./audit-pack";
import { annotateExcerptLinks, buildAuditBundle, verifyAuditBundle } from "./audit-bundle";
import { verifyProofBundle } from "./audit-merkle-verifier";
import { maskPayload } from "./audit-pii-mask";
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
    // Format wydawcy (D-01): wpisy deklaruja, czy poprzednik jest w wyciagu.
    auditLogExcerpt: annotateExcerptLinks(ZDARZENIA),
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
        legal_break_declarations: dok.legal_break_declarations,
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

// --- wyciag NIECIAGLY i wpisy z przeliczalnym hashem (audyt 2026-09, D-01 / C-04) ---
//
// Realny pakiet deliverable to wpisy JEDNEJ sprawy: miedzy nimi leza zdarzenia
// innych spraw i systemowe. Weryfikator, ktory wymagal ogniwa do poprzedniego
// wpisu W PLIKU, nazywal autentyczny pakiet sfalszowanym. Ponizej: przypadki
// zdrowe i zmanipulowane, kazdy sprawdzany TRZEMA implementacjami naraz -
// produkcja (verifyAuditBundle / verifyPackEventBinding), HTML i verify.py.

interface WierszZrodlowy {
    id: number;
    ts: string;
    event_type: string;
    actor_user_id: string | null;
    chat_id: string | null;
    document_id: string | null;
    payload: Record<string, unknown>;
    prev_hash: string;
    hash: string;
}

const SPRAWA = "chat-7f3a1b90";
const INNA = "chat-0000aaaa";

/** Globalny dziennik 9 wpisow; sprawa ma 1, 2, 4, 5, 7, 9 (luki: 3, 6, 8). */
function zbudujDziennik(): WierszZrodlowy[] {
    const plan: Array<{ chat: string | null; event_type: string; payload: Record<string, unknown> }> = [
        { chat: SPRAWA, event_type: "chat.message.user", payload: { content_len: 20, file_count: 0, workflow_id: null } },
        { chat: SPRAWA, event_type: "chat.message.assistant", payload: { model: "gemini-3-flash-preview", full_text_len: 100 } },
        { chat: null, event_type: "input_security_scan", payload: { report_id: "r1", action: "allowed" } },
        // payload z adresem e-mail - maskowanie go zmienia, wiec hash NIE do przeliczenia z pliku
        { chat: SPRAWA, event_type: "chat.message.user", payload: { content_len: 30, kontakt: "jan.testowy@example.pl" } },
        { chat: SPRAWA, event_type: "chat.message.assistant", payload: { model: "gemini-3-flash-preview", full_text_len: 52, uwaga: "Łódź - zażółć" } },
        { chat: INNA, event_type: "chat.message.user", payload: { content_len: 7 } },
        { chat: SPRAWA, event_type: "chat.message.user", payload: { content_len: 11, kwota: 1.5 } },
        { chat: null, event_type: "llm_route", payload: { model: "gemini-3-flash-preview", decision: "allow" } },
        { chat: SPRAWA, event_type: "chat.message.assistant", payload: { model: "gemini-3-flash-preview", full_text_len: 9 } },
    ];
    let prev = GENESIS_HASH;
    return plan.map((r, i) => {
        const ts = `2026-09-1${i}T08:00:00.${String(100 + i)}Z`;
        const hash = computeAuditHash({
            prev_hash: prev,
            ts,
            event_type: r.event_type,
            actor_user_id: "u-lokalny",
            chat_id: r.chat,
            document_id: null,
            payload: r.payload,
        });
        const w: WierszZrodlowy = {
            id: i + 1,
            ts,
            event_type: r.event_type,
            actor_user_id: "u-lokalny",
            chat_id: r.chat,
            document_id: null,
            payload: r.payload,
            prev_hash: prev,
            hash,
        };
        prev = hash;
        return w;
    });
}

const DZIENNIK = zbudujDziennik();

/** Wyciag dokladnie tak, jak sklada go GET /api/audit/bundle/:messageId. */
function wyciagSprawy(wiersze: WierszZrodlowy[]): AuditPackEvent[] {
    return annotateExcerptLinks(
        wiersze
            .filter((w) => w.chat_id === SPRAWA)
            .map((w) => toVerifiablePackEvent(w, maskPayload(w.payload), w.ts)),
    );
}

function bundleZWyciagiem(wyciag: AuditPackEvent[]) {
    return buildAuditBundle({
        chatId: SPRAWA,
        deliverableMd: "Opinia testowa.",
        citations: [],
        auditLogExcerpt: wyciag,
        modelVersions: { model: "gemini-3-flash-preview", model_source: "chat.message.assistant" },
        costLog: { available: false, event_count: wyciag.length },
        createdAt: "2026-09-20T10:00:00.000Z",
    });
}

const BUNDLE_SPRAWY = bundleZWyciagiem(wyciagSprawy(DZIENNIK));

const LISCIE_DZ = DZIENNIK.map((w) => w.hash);
const CEL_DZ = DZIENNIK[1];
const PACK_PRZELICZALNY = buildAuditPack({
    exporter: { user_id: "u-lokalny", email: null },
    event: toVerifiablePackEvent(CEL_DZ, maskPayload(CEL_DZ.payload), CEL_DZ.ts),
    bundle: {
        event_id: CEL_DZ.id,
        event_hash: CEL_DZ.hash,
        proof: buildMerkleProof(CEL_DZ.hash, LISCIE_DZ),
        merkle_root_id: 1,
        merkle_root: buildMerkleRoot(LISCIE_DZ),
        chain_block_start: 1,
        chain_block_end: DZIENNIK.length,
    },
    exportedAt: "2026-09-20T10:00:00.000Z",
});

/** Przelicza integrity packa - udaje podmieniajacego, ktory zaciera slady. */
function przypieczetujPack(dok: Record<string, unknown>): Record<string, unknown> {
    const { integrity: _p, ...cialo } = dok;
    void _p;
    (dok.integrity as { canonical_sha256: string }).canonical_sha256 = canonicalSha256(cialo);
    return dok;
}

function werdyktProdukcji(dok: Record<string, unknown>): boolean {
    if (dok.bundle_kind === "deliverable_audit_bundle") {
        return verifyAuditBundle(dok as unknown as Parameters<typeof verifyAuditBundle>[0]).ok;
    }
    const pack = dok as unknown as Parameters<typeof verifyAuditPackIntegrity>[0];
    return (
        verifyAuditPackIntegrity(pack).ok &&
        verifyPackEventBinding(pack).ok &&
        verifyProofBundle(pack.merkle_proof_bundle).ok
    );
}

type Wariant = { nazwa: string; dok: Record<string, unknown>; oczekiwany: boolean };

function warianty(): Wariant[] {
    const out: Wariant[] = [];
    const b = () => kopia(BUNDLE_SPRAWY) as unknown as Record<string, unknown>;
    const wpisy = (d: Record<string, unknown>) => d.audit_log_excerpt as AuditPackEvent[];

    out.push({ nazwa: "zdrowy-wyciag-nieciagly", dok: b(), oczekiwany: true });

    {
        const d = b();
        const w = wpisy(d).find((e) => e.id === 2)!;
        expect(w.hash_inputs_complete).toBe(true);
        (w.payload_masked as Record<string, unknown>).model = "inny-model";
        out.push({ nazwa: "zmieniona-tresc-wpisu-przeliczalnego", dok: przypieczetuj(d), oczekiwany: false });
    }
    {
        const d = b();
        const w = wpisy(d).find((e) => e.id === 7)!;
        w.ts = "2026-09-01T00:00:00.000Z";
        out.push({ nazwa: "zmieniony-ts-wpisu", dok: przypieczetuj(d), oczekiwany: false });
    }
    {
        // usuniety wpis 4: wpis 5 deklaruje poprzednika w wyciagu
        const d = b();
        d.audit_log_excerpt = wpisy(d).filter((e) => e.id !== 4);
        out.push({ nazwa: "usuniety-wpis-z-wyciagu", dok: przypieczetuj(d), oczekiwany: false });
    }
    {
        const d = b();
        const ws = wpisy(d);
        [ws[1], ws[3]] = [ws[3], ws[1]];
        out.push({ nazwa: "przestawione-wpisy", dok: przypieczetuj(d), oczekiwany: false });
    }
    {
        // kolejne numery (1 -> 2), ogniwo podmienione na wpisie bez przeliczalnego hasha
        const d = b();
        const w = wpisy(d).find((e) => e.id === 2)!;
        w.hash_inputs_complete = false;
        w.prev_hash = "a".repeat(64);
        w.parent_in_excerpt = false;
        out.push({ nazwa: "przerwane-ogniwo-kolejnych-numerow", dok: przypieczetuj(d), oczekiwany: false });
    }
    {
        // wpis 4 udaje przeliczalny - wydawca by go tak nie oznaczyl
        const d = b();
        const w = wpisy(d).find((e) => e.id === 4)!;
        expect(w.hash_inputs_complete).toBe(false);
        w.hash_inputs_complete = true;
        out.push({ nazwa: "zamaskowany-oznaczony-jako-pelny", dok: przypieczetuj(d), oczekiwany: false });
    }
    {
        // GRANICA (jawna): zmiana tresci wpisu ZAMASKOWANEGO z przeliczonym
        // manifestem jest dla odbiorcy niewidoczna - hashu nie da sie przeliczyc
        // z pliku. Chroni przed tym wylacznie kontrola wydawcy przy eksporcie
        // (serwer odmawia pakietu z wpisem niezgodnym z hashem).
        const d = b();
        const w = wpisy(d).find((e) => e.id === 4)!;
        (w.payload_masked as Record<string, unknown>).content_len = 999;
        out.push({ nazwa: "granica-zmiana-wpisu-zamaskowanego", dok: przypieczetuj(d), oczekiwany: true });
    }
    {
        // rozwidlenie z wyscigu zapisow (ADR-0161): kolejne numery, ten sam poprzednik
        const d = b();
        const ws = wpisy(d);
        const a = ws.find((e) => e.id === 1)!;
        const sib = { ...ws.find((e) => e.id === 2)! };
        sib.prev_hash = a.prev_hash;
        sib.hash = recomputePackEventHash(sib)!;
        sib.parent_in_excerpt = false;
        d.audit_log_excerpt = [a, sib];
        out.push({ nazwa: "rozwidlenie-z-wyscigu", dok: przypieczetuj(d), oczekiwany: true });
    }

    out.push({
        nazwa: "pack-przeliczalny-zdrowy",
        dok: kopia(PACK_PRZELICZALNY) as unknown as Record<string, unknown>,
        oczekiwany: true,
    });
    {
        const d = kopia(PACK_PRZELICZALNY);
        (d.event.payload_masked as Record<string, unknown>).model = "inny-model";
        out.push({
            nazwa: "pack-zmieniona-tresc-po-przeliczeniu-integrity",
            dok: przypieczetujPack(d as unknown as Record<string, unknown>),
            oczekiwany: false,
        });
    }
    {
        // dowod Merkle zdrowy, ale dotyczy INNEGO wpisu niz zdarzenie w pliku
        const d = kopia(PACK_PRZELICZALNY);
        const inny = DZIENNIK[2];
        d.event = toVerifiablePackEvent(inny, maskPayload(inny.payload), inny.ts);
        out.push({
            nazwa: "pack-zdarzenie-nie-z-dowodu",
            dok: przypieczetujPack(d as unknown as Record<string, unknown>),
            oczekiwany: false,
        });
    }
    return out;
}

describe("wyciag nieciagly i hash z tresci (audyt 2026-09, D-01 / C-04)", () => {
    const rdzen = zaladujRdzenHtml();

    it("wydawca oznacza luki i przeliczalnosc tak, jak w realnym pakiecie", () => {
        const w = BUNDLE_SPRAWY.audit_log_excerpt;
        expect(w.map((e) => e.id)).toEqual([1, 2, 4, 5, 7, 9]);
        expect(w.map((e) => e.parent_in_excerpt)).toEqual([false, true, false, true, false, false]);
        // wpis 4 ma e-mail w payloadzie - maskowanie go zmienia
        expect(w.map((e) => e.hash_inputs_complete)).toEqual([true, true, false, true, true, true]);
        const v = verifyAuditBundle(BUNDLE_SPRAWY);
        expect(v.ok).toBe(true);
        expect(v.excerpt).toMatchObject({ entries: 6, links: 2, gaps: 3, recomputed: 5, masked: 1 });
    });

    it("produkcja i HTML daja ten sam werdykt, zgodny z oczekiwanym", () => {
        for (const { nazwa, dok, oczekiwany } of warianty()) {
            expect(werdyktProdukcji(kopia(dok)), `produkcja: ${nazwa}`).toBe(oczekiwany);
            expect(rdzen.zweryfikuj(kopia(dok)).ok, `HTML: ${nazwa}`).toBe(oczekiwany);
        }
    });

    it("HTML nazywa luki wprost: wyciag, nie pelny lancuch", () => {
        const wynik = rdzen.zweryfikuj(kopia(BUNDLE_SPRAWY)) as unknown as {
            kroki: Array<{ tytul: string; opis: string }>;
        };
        const krok = wynik.kroki.find((k) => k.tytul.includes("Ciągłość"));
        expect(krok?.opis).toContain("To wyciąg, nie pełny łańcuch");
        expect(krok?.opis).toContain("3 luk");
    });

    describe.skipIf(PYTHON === null)("verify.py", () => {
        const katalog = mkdtempSync(join(tmpdir(), "patron-verify-d01-"));
        const sciezkaVerify = join(katalog, "verify.py");
        writeFileSync(sciezkaVerify, VERIFIER_PY, "utf8");

        function uruchom(artefakt: unknown, nazwa: string): { kod: number; out: string } {
            const plik = join(katalog, `${nazwa}.json`);
            writeFileSync(plik, JSON.stringify(artefakt, null, 2), "utf8");
            const wynik = spawnSync(PYTHON as string, [sciezkaVerify, plik], { encoding: "utf8" });
            return { kod: wynik.status ?? -1, out: wynik.stdout };
        }

        it("ten sam werdykt co produkcja i HTML na kazdym wariancie", () => {
            for (const { nazwa, dok, oczekiwany } of warianty()) {
                const { kod, out } = uruchom(dok, nazwa);
                expect(kod, `verify.py: ${nazwa}\n${out}`).toBe(oczekiwany ? 0 : 1);
            }
        });

        it("zdrowy wyciag nieciagly: kod 0 i jawna informacja o lukach", () => {
            const { kod, out } = uruchom(BUNDLE_SPRAWY, "jawne-luki");
            expect(kod, out).toBe(0);
            expect(out).toContain("WYCIAG, NIE PELNY LANCUCH: 3 luk");
            expect(out).toContain("5 hashy przeliczonych z tresci");
        });
    });
});

// --- zerwanie z mocy prawa (ADR-0164, decyzja wlasciciela produktu 2026-10-06) ---
//
// Wpis zanonimizowany na podstawie RODO art. 17 wychodzi z eksportu ze znacznikiem
// legal_break i z wierszem deklaracji. Trzy implementacje (produkcja, HTML,
// verify.py) musza dac TEN SAM trojstan: ok / legal_break / tampered. Material
// budowany tak, jak robi to scripts/rodo-delete.ts: deklaracja z hashami PO
// anonimizacji, potem UPDATE actor_user_id = NULL bez przeliczenia hasha.

const OSOBA = "u-do-zapomnienia";
const LB_SPRAWA = "chat-lb-0001";

function zbudujDziennikZZerwaniem(): { wiersze: WierszZrodlowy[]; deklaracja: WierszZrodlowy } {
    const plan: Array<{ actor: string | null; chat: string | null; event_type: string; payload: Record<string, unknown> }> = [
        { actor: OSOBA, chat: LB_SPRAWA, event_type: "chat.message.user", payload: { content_len: 14 } },
        { actor: OSOBA, chat: LB_SPRAWA, event_type: "chat.message.assistant", payload: { model: "model-x", full_text_len: 40 } },
        { actor: null, chat: null, event_type: "ring_policy.decision", payload: { action: "allow" } },
        // payload z e-mailem: po maskowaniu hash nie do przeliczenia z pliku
        { actor: OSOBA, chat: LB_SPRAWA, event_type: "chat.message.user", payload: { content_len: 9, kontakt: "anna.testowa@example.pl" } },
        { actor: "u-inny", chat: LB_SPRAWA, event_type: "chat.message.assistant", payload: { model: "model-x", full_text_len: 12 } },
    ];
    let prev = GENESIS_HASH;
    const wiersze: WierszZrodlowy[] = plan.map((r, i) => {
        const ts = `2026-10-0${i + 1}T08:00:00.000Z`;
        const hash = computeAuditHash({
            prev_hash: prev,
            ts,
            event_type: r.event_type,
            actor_user_id: r.actor,
            chat_id: r.chat,
            document_id: null,
            payload: r.payload,
        });
        const w: WierszZrodlowy = {
            id: i + 1,
            ts,
            event_type: r.event_type,
            actor_user_id: r.actor,
            chat_id: r.chat,
            document_id: null,
            payload: r.payload,
            prev_hash: prev,
            hash,
        };
        prev = hash;
        return w;
    });
    const doZerwania = wiersze.filter((w) => w.actor_user_id === OSOBA);
    const hashePo = doZerwania.map((w) =>
        computeAuditHash({ ...w, actor_user_id: null, payload: w.payload }),
    );
    const payload = {
        reason: "rodo_art_17_anonymization",
        field: "actor_user_id",
        target_user_id_hash: "0f1e2d3c4b5a6978",
        affected_count: doZerwania.length,
        first_id: doZerwania[0].id,
        last_id: doZerwania[doZerwania.length - 1].id,
        part: 1,
        parts: 1,
        affected_ids: doZerwania.map((w) => w.id),
        affected_hashes_after: hashePo,
        affected_ids_truncated: false,
    };
    const ts = "2026-10-09T08:00:00.000Z";
    const deklaracja: WierszZrodlowy = {
        id: wiersze.length + 1,
        ts,
        event_type: "audit.chain.legal_break",
        actor_user_id: null,
        chat_id: null,
        document_id: null,
        payload,
        prev_hash: prev,
        hash: computeAuditHash({
            prev_hash: prev,
            ts,
            event_type: "audit.chain.legal_break",
            actor_user_id: null,
            chat_id: null,
            document_id: null,
            payload,
        }),
    };
    wiersze.push(deklaracja);
    // anonimizacja: UPDATE actor_user_id = NULL, hash bez zmian (jak rodo-delete)
    for (const w of wiersze) if (w.actor_user_id === OSOBA) w.actor_user_id = null;
    return { wiersze, deklaracja };
}

const LB = zbudujDziennikZZerwaniem();
const LB_LISCIE = LB.wiersze.map((w) => w.hash);

/** Zdarzenie paczki tak, jak sklada je serwer: resolveLegalBreak + znacznik. */
function zdarzenieZZerwaniem(w: WierszZrodlowy): AuditPackEvent {
    const r = resolveLegalBreak(w, LB.wiersze);
    expect(r.status, `resolveLegalBreak dla wpisu ${w.id}`).toBe("verified");
    if (r.status !== "verified") throw new Error("nieoczekiwane");
    return { ...toVerifiablePackEvent(w, maskPayload(w.payload), r.ts), legal_break: r.marker };
}

const LB_DEKLARACJA = toVerifiablePackEvent(LB.deklaracja, maskPayload(LB.deklaracja.payload), LB.deklaracja.ts);

function packZZerwaniem(w: WierszZrodlowy) {
    return buildAuditPack({
        exporter: { user_id: "u-admin", email: null },
        event: zdarzenieZZerwaniem(w),
        bundle: {
            event_id: w.id,
            event_hash: w.hash,
            proof: buildMerkleProof(w.hash, LB_LISCIE),
            merkle_root_id: 1,
            merkle_root: buildMerkleRoot(LB_LISCIE),
            chain_block_start: 1,
            chain_block_end: LB_LISCIE.length,
        },
        exportedAt: "2026-10-10T10:00:00.000Z",
        legalBreakDeclaration: LB_DEKLARACJA,
    });
}

const PACK_LB = packZZerwaniem(LB.wiersze[1]);
const PACK_LB_ZAMASKOWANY = packZZerwaniem(LB.wiersze[3]);

const BUNDLE_LB = buildAuditBundle({
    chatId: LB_SPRAWA,
    deliverableMd: "Opinia testowa po anonimizacji.",
    citations: [],
    auditLogExcerpt: annotateExcerptLinks(
        LB.wiersze
            .filter((w) => w.chat_id === LB_SPRAWA)
            .map((w) =>
                w.actor_user_id === null
                    ? zdarzenieZZerwaniem(w)
                    : toVerifiablePackEvent(w, maskPayload(w.payload), w.ts),
            ),
    ),
    modelVersions: { model: "model-x", model_source: "chat.message.assistant" },
    costLog: { available: false, event_count: 4 },
    createdAt: "2026-10-10T10:00:00.000Z",
    legalBreakDeclarations: [LB_DEKLARACJA],
});

type Werdykt = "ok" | "legal_break" | "tampered";

function werdyktProdukcji3(dok: Record<string, unknown>): Werdykt {
    if (dok.bundle_kind === "deliverable_audit_bundle") {
        return verifyAuditBundle(dok as unknown as Parameters<typeof verifyAuditBundle>[0]).verdict;
    }
    return verifyAuditPack(dok as unknown as Parameters<typeof verifyAuditPack>[0]).verdict;
}

function wariantyZerwania(): Array<{ nazwa: string; dok: Record<string, unknown>; oczekiwany: Werdykt }> {
    const out: Array<{ nazwa: string; dok: Record<string, unknown>; oczekiwany: Werdykt }> = [];
    const p = () => kopia(PACK_LB) as unknown as Record<string, unknown>;
    const ev = (d: Record<string, unknown>) => d.event as AuditPackEvent;
    const dek = (d: Record<string, unknown>) => d.legal_break_declaration as AuditPackEvent;
    const dp = (e: AuditPackEvent) => e.payload_masked as Record<string, unknown>;

    out.push({ nazwa: "pack-zerwanie-wazne", dok: p(), oczekiwany: "legal_break" });
    out.push({
        nazwa: "pack-zerwanie-wazne-tresc-zamaskowana",
        dok: kopia(PACK_LB_ZAMASKOWANY) as unknown as Record<string, unknown>,
        oczekiwany: "legal_break",
    });
    {
        // zmiana payloadu PO anonimizacji (R-AC-01), integrity przeliczone
        const d = p();
        dp(ev(d)).model = "inny-model";
        out.push({ nazwa: "pack-zmieniona-tresc-po-anonimizacji", dok: przypieczetujPack(d), oczekiwany: "tampered" });
    }
    {
        // znacznik podaje inny hash po zerwaniu niz deklaracja
        const d = p();
        ev(d).legal_break!.hash_after = "b".repeat(64);
        out.push({ nazwa: "pack-hash-after-niezgodny-z-deklaracja", dok: przypieczetujPack(d), oczekiwany: "tampered" });
    }
    {
        // podmieniajacy zmienia tresc i "dopasowuje" znacznik oraz deklaracje -
        // lape zaklada wylacznie hash samej deklaracji
        const d = p();
        dp(ev(d)).model = "inny-model";
        const nowy = recomputePackEventHash(ev(d))!;
        ev(d).legal_break!.hash_after = nowy;
        const pl = dp(dek(d));
        const i = (pl.affected_ids as number[]).indexOf(ev(d).id);
        (pl.affected_hashes_after as string[])[i] = nowy;
        out.push({ nazwa: "pack-zmieniona-deklaracja", dok: przypieczetujPack(d), oczekiwany: "tampered" });
    }
    {
        // deklaracja w starym formacie (bez affected_hashes_after), z wlasnym
        // poprawnym hashem - serwer takiej paczki nie wyda; gdyby ja ktos zlozyl,
        // weryfikator nie uznaje zerwania
        const d = p();
        const D = dek(d);
        delete dp(D).affected_hashes_after;
        D.hash = recomputePackEventHash(D)!;
        out.push({ nazwa: "pack-deklaracja-stary-format", dok: przypieczetujPack(d), oczekiwany: "tampered" });
    }
    {
        const d = p();
        delete d.legal_break_declaration;
        out.push({ nazwa: "pack-bez-deklaracji", dok: przypieczetujPack(d), oczekiwany: "tampered" });
    }
    {
        // deklaracja nie wymienia wpisu
        const d = p();
        const D = dek(d);
        const pl = dp(D);
        const i = (pl.affected_ids as number[]).indexOf(ev(d).id);
        (pl.affected_ids as number[]).splice(i, 1);
        (pl.affected_hashes_after as string[]).splice(i, 1);
        D.hash = recomputePackEventHash(D)!;
        out.push({ nazwa: "pack-deklaracja-nie-wymienia-wpisu", dok: przypieczetujPack(d), oczekiwany: "tampered" });
    }
    {
        // pole przywrocone (znacznik bez pokrycia)
        const d = p();
        ev(d).actor_user_id = OSOBA;
        out.push({ nazwa: "pack-pole-niewyzerowane", dok: przypieczetujPack(d), oczekiwany: "tampered" });
    }
    {
        // usuniety znacznik: tresc po anonimizacji nie zgadza sie z oryginalnym hashem
        const d = p();
        delete ev(d).legal_break;
        out.push({ nazwa: "pack-usuniety-znacznik", dok: przypieczetujPack(d), oczekiwany: "tampered" });
    }
    {
        // deklaracja starsza od wpisu
        const d = p();
        ev(d).legal_break!.declaration_event_id = 1;
        dek(d).id = 1;
        out.push({ nazwa: "pack-deklaracja-starsza-od-wpisu", dok: przypieczetujPack(d), oczekiwany: "tampered" });
    }

    const b = () => kopia(BUNDLE_LB) as unknown as Record<string, unknown>;
    const wpisy = (d: Record<string, unknown>) => d.audit_log_excerpt as AuditPackEvent[];
    out.push({ nazwa: "bundle-zerwanie-wazne", dok: b(), oczekiwany: "legal_break" });
    {
        const d = b();
        dp(wpisy(d).find((e) => e.id === 2)!).model = "inny-model";
        out.push({ nazwa: "bundle-zmieniona-tresc-po-anonimizacji", dok: przypieczetuj(d), oczekiwany: "tampered" });
    }
    {
        const d = b();
        const D = (d.legal_break_declarations as AuditPackEvent[])[0];
        dp(D).reason = "inny_powod";
        out.push({ nazwa: "bundle-zmieniona-deklaracja", dok: przypieczetuj(d), oczekiwany: "tampered" });
    }
    {
        const d = b();
        const D = (d.legal_break_declarations as AuditPackEvent[])[0];
        delete dp(D).affected_hashes_after;
        D.hash = recomputePackEventHash(D)!;
        out.push({ nazwa: "bundle-deklaracja-stary-format", dok: przypieczetuj(d), oczekiwany: "tampered" });
    }
    {
        const d = b();
        delete d.legal_break_declarations;
        (d.manifest as { parts: Array<{ name: string }> }).parts = (
            d.manifest as { parts: Array<{ name: string }> }
        ).parts.filter((x) => x.name !== "legal_break_declarations");
        out.push({ nazwa: "bundle-bez-deklaracji", dok: przypieczetuj(d), oczekiwany: "tampered" });
    }
    return out;
}

const STAN_HTML: Record<string, Werdykt> = { ok: "ok", legal_break: "legal_break", naruszony: "tampered" };
const KOD_PY: Record<number, Werdykt> = { 0: "ok", 3: "legal_break", 1: "tampered" };

describe("zerwanie z mocy prawa w artefakcie (ADR-0164, decyzja 2026-10-06)", () => {
    const rdzen = zaladujRdzenHtml() as unknown as {
        zweryfikuj: (d: unknown) => {
            ok: boolean;
            stan: string;
            zerwanie: { deklaracje: number[]; powody: string[] } | null;
            kroki: Array<{ ok: boolean; tytul: string; opis: string }>;
        };
    };

    it("material: wpis 2 przeliczalny, wpis 4 zamaskowany, dowod Merkle dla ORYGINALNEGO hasha", () => {
        expect(PACK_LB.event.legal_break).toEqual({
            declaration_event_id: LB.deklaracja.id,
            reason: "rodo_art_17_anonymization",
            field: "actor_user_id",
            hash_after: expect.stringMatching(/^[0-9a-f]{64}$/),
        });
        expect(PACK_LB.event.hash_inputs_complete).toBe(true);
        expect(PACK_LB.event.hash).toBe(PACK_LB.merkle_proof_bundle.event_hash);
        expect(PACK_LB.event.legal_break!.hash_after).not.toBe(PACK_LB.event.hash);
        expect(PACK_LB_ZAMASKOWANY.event.hash_inputs_complete).toBe(false);
        expect(PACK_LB.legal_break_declaration?.hash_inputs_complete).toBe(true);
        expect(verifyProofBundle(PACK_LB.merkle_proof_bundle).ok).toBe(true);
        expect(BUNDLE_LB.manifest.parts.map((x) => x.name)).toContain("legal_break_declarations");
    });

    it("serwer (resolveLegalBreak): stary format, zmiana po anonimizacji i niewyzerowane pole to nie zerwanie z mocy prawa", () => {
        const wiersz = { ...LB.wiersze[1] };
        const stara = { ...LB.deklaracja, payload: { ...LB.deklaracja.payload } };
        delete (stara.payload as Record<string, unknown>).affected_hashes_after;
        stara.hash = computeAuditHash({ ...stara, payload: stara.payload });
        expect(resolveLegalBreak(wiersz, [stara]).status).toBe("old_format");
        expect(resolveLegalBreak({ ...wiersz, payload: { model: "inny", full_text_len: 40 } }, LB.wiersze).status).toBe(
            "content_differs",
        );
        expect(resolveLegalBreak({ ...wiersz, actor_user_id: "ktos" }, LB.wiersze).status).toBe("field_not_null");
        // deklaracja ze zmieniona trescia (zly wlasny hash) nie wybiela niczego
        const zmieniona = { ...LB.deklaracja, payload: { ...LB.deklaracja.payload, reason: "inny" } };
        expect(resolveLegalBreak(wiersz, [zmieniona]).status).toBe("none");
        expect(resolveLegalBreak(LB.wiersze[4], LB.wiersze).status).toBe("none");
    });

    it("produkcja i HTML: ten sam trojstan, zgodny z oczekiwanym", () => {
        for (const { nazwa, dok, oczekiwany } of wariantyZerwania()) {
            expect(werdyktProdukcji3(kopia(dok)), `produkcja: ${nazwa}`).toBe(oczekiwany);
            const h = rdzen.zweryfikuj(kopia(dok));
            expect(STAN_HTML[h.stan], `HTML: ${nazwa}`).toBe(oczekiwany);
            expect(h.ok, `HTML ok: ${nazwa}`).toBe(oczekiwany !== "tampered");
        }
    });

    it("HTML nazywa stan: zerwanie z mocy prawa, RODO art. 17, numer deklaracji", () => {
        const h = rdzen.zweryfikuj(kopia(PACK_LB));
        expect(h.zerwanie).toEqual({ deklaracje: [LB.deklaracja.id], powody: ["RODO art. 17"] });
        const krok = h.kroki.find((k) => k.tytul === "Zerwanie z mocy prawa");
        expect(krok?.opis).toContain(`zerwanie z mocy prawa (RODO art. 17), zadeklarowane zdarzeniem #${LB.deklaracja.id}`);
        const hb = rdzen.zweryfikuj(kopia(BUNDLE_LB));
        expect(hb.stan).toBe("legal_break");
        expect(hb.zerwanie?.deklaracje).toEqual([LB.deklaracja.id]);
    });

    it("zdrowe artefakty bez zerwania nadal daja czyste ok we wszystkich implementacjach", () => {
        for (const d of [PACK, BUNDLE, PACK_PRZELICZALNY, BUNDLE_SPRAWY]) {
            const dok = kopia(d) as unknown as Record<string, unknown>;
            expect(werdyktProdukcji3(dok)).toBe("ok");
            expect(rdzen.zweryfikuj(kopia(dok)).stan).toBe("ok");
        }
    });

    describe.skipIf(PYTHON === null)("verify.py", () => {
        const katalog = mkdtempSync(join(tmpdir(), "patron-verify-lb-"));
        const sciezkaVerify = join(katalog, "verify.py");
        writeFileSync(sciezkaVerify, VERIFIER_PY, "utf8");

        function uruchom(artefakt: unknown, nazwa: string): { kod: number; out: string } {
            const plik = join(katalog, `${nazwa}.json`);
            writeFileSync(plik, JSON.stringify(artefakt, null, 2), "utf8");
            const wynik = spawnSync(PYTHON as string, [sciezkaVerify, plik], { encoding: "utf8" });
            return { kod: wynik.status ?? -1, out: wynik.stdout + wynik.stderr };
        }

        it("ten sam trojstan co produkcja i HTML (kody 0 / 3 / 1)", () => {
            for (const { nazwa, dok, oczekiwany } of wariantyZerwania()) {
                const { kod, out } = uruchom(dok, nazwa);
                expect(KOD_PY[kod], `verify.py: ${nazwa} (kod ${kod})\n${out}`).toBe(oczekiwany);
            }
        });

        it("wazne zerwanie: kod 3 i werdykt slowami", () => {
            const { kod, out } = uruchom(PACK_LB, "lb-slowa");
            expect(kod, out).toBe(3);
            expect(out).toContain(
                `WYNIK: OK - zerwanie z mocy prawa (RODO art. 17), zadeklarowane zdarzeniem #${LB.deklaracja.id}.`,
            );
            const b = uruchom(BUNDLE_LB, "lb-bundle-slowa");
            expect(b.kod, b.out).toBe(3);
            expect(b.out).toContain("ZERWANIE Z MOCY PRAWA: 3 wpisow");
        });
    });
});
