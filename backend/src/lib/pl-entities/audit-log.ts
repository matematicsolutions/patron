// Pseudonim audit log - plain-text logger "proves no PII leaves" dla Inspektora.
//
// Cherry-pick patternu z gregmos/PII-Shield (MIT, ADR-0013, pattern 5):
// osobny log file rownolegly do hash-chain audit_log (ADR-0001), zapisuje
// kazde zdarzenie warstwy pseudonimizacji w **czytelnej formie** ktora
// Inspektor RODO / kontroler kancelarii moze przeczytac bez deszyfrowania
// hash-chain ani uruchamiania `scripts/verify-audit-chain.ts`.
//
// AI Act art. 12 record-keeping + art. 13 instrukcje uzytkowania
// (Regulation (EU) 2024/1689, CELEX 32024R1689) wymagaja zrozumialych
// logow dla podmiotu wdrazajacego AI. Hash-chain (ADR-0001) sluzy maszynie
// (cryptographic proof tamper-evidence), pseudonim_audit.log sluzy
// czlowiekowi Inspektorowi (5-min audyt wizualny).
//
// Format linii (pipe-separated, sortowalny po timestamp):
//   2026-05-21T18:42:13.123Z | pseudonim-applied | doc_id=01HXY... | source_hash=sha256:abc... | entities={OSOBA:3,PESEL:1} | bytes_in=12450 | bytes_out=12180
//   2026-05-21T18:42:14.456Z | llm-call-out | bytes_out=8200 | pii_count=0
//
// Walidacja krytyczna: appendLlmCallOut() RZUCA wyjatek jezeli pseudonimizacja
// pominela ktorykolwiek "original" z mapy - LLM call jest ZATRZYMANY,
// audit log nie zapisuje sukcesu (PII zostalo w prompcie).
//
// UWAGA: log NIE zawiera pelnych tresci ani placeholderow z wartosciami -
// tylko liczniki, hashe i typy. Zgodne z Konstytucja Art. 7 (minimalnosc).
//
// Nie zastepuje hash-chain (ADR-0001) - jest **rownolegly**. Operacyjnie
// kazde zdarzenie pseudonimizacji generuje DWIE linie: jedna w audit_log
// (Postgres, hash-chained) i jedna w pseudonim_audit.log (plik, plain-text).

import { appendFile } from "fs/promises";

/**
 * Typ zdarzenia w pseudonim_audit.log. Lista zamknieta - nowe zdarzenia
 * wymagaja zmiany typu + ADR-NNN bumpa.
 */
export type PseudonimAuditEventType =
    | "pseudonim-applied"   // wrap() - tekst zostal spseudonimizowany przed LLM call
    | "pseudonim-reversed"  // unwrap() - LLM response zostal odzbrojony z tokenow
    | "llm-call-out"        // prompt poszedl do LLM (po wrap)
    | "llm-call-in"         // odpowiedz wrocila z LLM (przed unwrap)
    | "mapping-stored"      // mapowanie placeholder<->original zapisane do storu
    | "mapping-cleanup"     // TTL cleanup uruchomiony, N mappings usunieto (pattern 1 ADR-0013)
    | "docx-generated";     // .docx wygenerowany z session_id w custom properties (pattern 3 ADR-0013)

/**
 * Pojedyncze zdarzenie audit log. Wszystkie pola opcjonalne - kazdy
 * `event` ma sensowny podzbior:
 * - `pseudonim-applied`: doc_id, source_hash, entities, bytes_in, bytes_out
 * - `llm-call-out`: bytes_out, pii_count (POWINNO byc 0)
 * - `mapping-cleanup`: removed_sessions, expires_at
 */
export interface PseudonimAuditEvent {
    /** Typ zdarzenia. */
    event: PseudonimAuditEventType;
    /** ULID dokumentu w obrebie sesji (dla pseudonim-applied / docx-generated). */
    doc_id?: string;
    /** sha256:... oryginalnego pliku (dla pseudonim-applied, z patternem 2 ADR-0013). */
    source_hash?: string;
    /** Licznik wykrytych PII per kategoria - np. {OSOBA: 3, PESEL: 1, NIP: 2}. */
    entities?: Record<string, number>;
    /** Dla llm-call-out: ile PII zostalo w prompcie PO pseudonimizacji. POWINNO byc 0. */
    pii_count?: number;
    /** Rozmiar wejscia w bajtach (UTF-8). */
    bytes_in?: number;
    /** Rozmiar wyjscia w bajtach (UTF-8). */
    bytes_out?: number;
    /** Dla mapping-cleanup: ile sesji usunieto przez TTL job. */
    removed_sessions?: number;
    /** Dla mapping-cleanup / TTL events: kiedy mapping mial wygasnac. */
    expires_at?: Date;
}

/**
 * Wyjatek rzucany przez `appendLlmCallOut()` gdy pseudonimizacja przepuscila
 * PII do prompta. Caller MUSI zlapac i ZABLOKOWAC wyslanie LLM.
 *
 * Wzor blokady: lepiej zalogowac nieudana proba niz wyslac PII do US-SaaS.
 *
 * `.message` zawiera WYLACZNIE licznik PII bez wartosci - guarantee
 * "no PII leaves" obowiazuje tak samo dla audit log jak dla tresci
 * wyjatku (caller ktory zaloguje `err.message` przez console.error /
 * Sentry / winston NIE ujawni PII). Strukturyzowane sample sa w
 * polu `.samples` - caller decyduje co z nimi zrobic (np. zapis do
 * incident-only log z restricted access).
 */
export class ResidualPIIError extends Error {
    public readonly piiCount: number;
    public readonly samples: readonly string[];

    constructor(piiCount: number, samples: readonly string[]) {
        super(
            `Prompt zawiera ${piiCount} PII residual po pseudonimizacji - LLM call ZATRZYMANY. ` +
            `Wartosci dostepne w polu .samples (do incident-only log).`,
        );
        this.name = "ResidualPIIError";
        this.piiCount = piiCount;
        this.samples = samples;
    }
}

/**
 * Minimalna dlugosc oryginalu uwzglednianego w detekcji residual PII.
 * Originaly 1-znakowe (np. inicjaly "A", "J") daja masowe false-positives -
 * litery alfabetu wystepuja w niemal kazdym polskim slowie. PESEL/NIP/REGON
 * maja >= 9 cyfr, imiona/nazwiska >= 3 znaki, kody jednostek typu "PL" sa
 * 2-literowe i je traktujemy jako granice akceptowalna (raczej false-positive
 * na ryzyko klienta niz pominieta walidacja).
 */
const MIN_ORIGINAL_LENGTH = 2;

/**
 * Sprawdza czy KAZDY `original` z mapy placeholder<->original wystepuje
 * w wynikowym tekscie. Jezeli tak - pseudonimizacja go pominela i PII
 * zostalo w prompcie.
 *
 * `placeholders`: Map<original, token> (czyli `PseudonimMap.byOriginal`
 * z pseudonim/types.ts).
 *
 * Returns: liczba originalow ktore nadal sa w `text`, plus do 3 sampli
 * (dla wyjatku, nie dla logu - log nie zawiera wartosci).
 *
 * Granica `MIN_ORIGINAL_LENGTH` filtruje false-positives dla bardzo krotkich
 * originalow (1 znak). Fleksja imion/firm jest poza scope tej walidacji -
 * adresuje ja wyzsza warstwa wrap() w pseudonim/.
 */
export function detectResidualPII(
    text: string,
    placeholders: ReadonlyMap<string, string>,
): { count: number; samples: string[] } {
    let count = 0;
    const samples: string[] = [];
    for (const original of placeholders.keys()) {
        if (original.length < MIN_ORIGINAL_LENGTH) continue;
        if (text.includes(original)) {
            count += 1;
            if (samples.length < 3) {
                samples.push(original);
            }
        }
    }
    return { count, samples };
}

/**
 * Formatuje pole AuditEvent na "key=value" jezeli wartosc istnieje.
 *
 * Dla `entities` (jedyne pole obiektowe nie-Date w `PseudonimAuditEvent`)
 * format `{KEY:N,KEY:N}`. Inne pola obiektowe sa serializowane przez
 * `JSON.stringify` jako fallback - dodanie nowego pola obiektowego do
 * interfejsu wymaga decyzji czy zachowuje format `entities`-like czy raw JSON.
 */
function formatField(key: string, value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (value instanceof Date) return `${key}=${value.toISOString()}`;
    if (key === "entities" && typeof value === "object") {
        const entries = Object.entries(value as Record<string, number>);
        const formatted = entries.map(([k, v]) => `${k}:${v}`).join(",");
        return `${key}={${formatted}}`;
    }
    if (typeof value === "object") {
        return `${key}=${JSON.stringify(value)}`;
    }
    return `${key}=${String(value)}`;
}

/**
 * Serializuje zdarzenie do linii audit log. Eksportowany dla testow
 * (pozwala asercje na deterministyczny format bez dotykania plikow).
 */
export function formatAuditLine(
    timestamp: Date,
    event: PseudonimAuditEvent,
): string {
    const parts: string[] = [timestamp.toISOString(), event.event];
    // Stala kolejnosc pol - czytelnosc dla Inspektora.
    const orderedKeys: Array<keyof PseudonimAuditEvent> = [
        "doc_id",
        "source_hash",
        "entities",
        "bytes_in",
        "bytes_out",
        "pii_count",
        "removed_sessions",
        "expires_at",
    ];
    for (const key of orderedKeys) {
        const formatted = formatField(key, event[key]);
        if (formatted !== null) parts.push(formatted);
    }
    return parts.join(" | ");
}

/**
 * Logger plain-text dla zdarzen pseudonimizacji. Pisze synchronizowanie
 * appendFile - kazda linia kompletna lub blad caller widzi.
 *
 * Konstruktor przyjmuje logPath (Windows/Linux agnostic). Lokalizacja
 * docelowa Linux: `/var/lib/patron/audit/pseudonim_audit.log`. Windows
 * dev: `%PROGRAMDATA%\patron\audit\pseudonim_audit.log`.
 *
 * Retencja audit log: synchronizowana z polityka audit bundle (ADR-0006).
 * Patron nie ustala twardo "7 lat" - rozporzadzenie AI Act art. 12 nie
 * precyzuje liczby lat, ustala obowiazek "appropriate period".
 */
export class PseudonimAuditLog {
    private readonly logPath: string;
    private readonly clock: () => Date;

    /**
     * @param logPath absolutna sciezka do pliku log. Caller odpowiedzialny
     *                za stworzenie katalogu rodzica i ustawienie permissions.
     * @param clock   wstrzykiwalny zegar dla testow deterministycznych.
     *                Default: `() => new Date()`.
     */
    constructor(logPath: string, clock: () => Date = () => new Date()) {
        this.logPath = logPath;
        this.clock = clock;
    }

    /**
     * Appenduje pojedyncze zdarzenie do log. Linia zakonczona "\n".
     * Throws jezeli appendFile fails (caller decyduje).
     */
    async append(event: PseudonimAuditEvent): Promise<void> {
        const line = formatAuditLine(this.clock(), event) + "\n";
        await appendFile(this.logPath, line, { encoding: "utf8" });
    }

    /**
     * Wariant krytyczny dla event=llm-call-out. PRZED logowaniem waliduje
     * ze tekst prompta NIE zawiera zadnego "original" z mapy. Jezeli zawiera -
     * rzuca `ResidualPIIError`, log NIE zapisuje "llm-call-out".
     *
     * Caller (np. wrap() w pseudonim/wrap.ts) lapie wyjatek i przerywa
     * wyslanie do LLM. To bramka "no PII leaves".
     *
     * @param promptText  tekst po pseudonimizacji, gotowy do wyslania do LLM.
     * @param placeholders mapa original->token (`PseudonimMap.byOriginal`).
     */
    async appendLlmCallOut(
        promptText: string,
        placeholders: ReadonlyMap<string, string>,
    ): Promise<void> {
        const residual = detectResidualPII(promptText, placeholders);
        if (residual.count > 0) {
            throw new ResidualPIIError(residual.count, residual.samples);
        }
        await this.append({
            event: "llm-call-out",
            bytes_out: Buffer.byteLength(promptText, "utf8"),
            pii_count: 0,
        });
    }
}
