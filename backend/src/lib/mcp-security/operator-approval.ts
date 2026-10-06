// Zatwierdzenie werdyktu `human_review` przez Operatora (ADR-0158, rozszerza ADR-0028).
//
// Do tej pory `human_review` blokowal rejestracje konektora BEZ sciezki decyzji:
// czlowiek nie mial jak zdecydowac, wiec werdykt dzialal jak `denied`. Teraz
// Operator moze zatwierdzic KONKRETNA definicje konektora, wpisujac w
// wpisie konektora w nakladce Operatora (~/.patron/mcp-servers.operator.json,
// ADR-0166) `gatewayApproval.hash`. Zasady:
//   - zatwierdzenie jest przypiete do hasha definicji - kazda zmiana narzedzi
//     (nazwa, opis, schemat wejscia) daje inny hash i konektor wraca do przegladu;
//   - `denied` (poziom krytyczny) NIE jest do zatwierdzenia;
//   - `allowed` / `audit` zatwierdzenia nie potrzebuja i go nie czytaja.
//
// Hash zatwierdzenia obejmuje nazwe serwera i pelne definicje narzedzi (nazwa,
// opis, schemat wejscia) - inaczej serwer moglby po zatwierdzeniu dopisac
// narzedziu parametr wejscia (np. `token`) i zatwierdzenie by to przepuscilo.
// To ta sama formula co hash detektora dryfu v2 (ADR-0159), wiec liczymy ja w
// JEDNYM miejscu: zatwierdzenie i baseline dryfu pokazuja ten sam hash. Adres
// konektora (moze niesc klucz dostepu) do hasha nie wchodzi.
//
// Pochodzenie konektora (B-06 / R-MCP-01). Hash definicji nie obejmuje komendy
// ani adresu, wiec zatwierdzenie samej definicji przepuscilaby podmiane procesu
// albo hosta z tymi samymi narzedziami. Dlatego zatwierdzenie niesie tez
// `origin` = odcisk pochodzenia (computeOriginFingerprint, bez sekretow):
//   - `origin` podany -> musi byc rowny biezacemu odciskowi;
//   - `origin` brak (zatwierdzenia wpisane przed ta zmiana) -> wystarcza, dopoki
//     pochodzenie NIE zmienilo sie wzgledem baseline; przy dryfie pochodzenia
//     takie zatwierdzenie nie dziala (hash_mismatch) i Operator wpisuje nowe.
// `hash` zostaje hashem definicji bit w bit (zatwierdzenia juz wpisane dalej
// pasuja - test przypiecia w operator-approval.test.ts).
//
// Modul jest czysty - bez IO, bez logowania.

import { computeDefinitionHash, computeOriginFingerprint } from "./detectors/drift";
import type { McpAction, McpServerDefinition } from "./types";

export interface GatewayApproval {
    /** Hash zatwierdzonej definicji (computeApprovalHash), 64 znaki hex. */
    hash: string;
    /**
     * Odcisk pochodzenia zatwierdzonego konektora (computeOriginFingerprint),
     * 64 znaki hex. Wymagany, gdy werdykt wynika ze zmiany pochodzenia.
     */
    origin?: string;
    /** Informacyjne - dla audytora w pliku i w dzienniku. */
    approvedAt?: string;
    approvedBy?: string;
}

export type OperatorApprovalStatus =
    /** Werdykt nie wymaga decyzji (allowed / audit). */
    | "not_needed"
    /** human_review + zgodny hash - konektor rejestrowany. */
    | "approved"
    /** human_review bez zatwierdzenia - konektor zablokowany. */
    | "missing"
    /** human_review + zatwierdzenie INNEJ definicji - zablokowany, wymaga ponownej decyzji. */
    | "hash_mismatch"
    /** denied - zatwierdzenie nie dziala, nawet jesli jest wpisane. */
    | "not_overridable";

export interface OperatorApprovalDecision {
    status: OperatorApprovalStatus;
    /** Czy konektor ma zostac zarejestrowany. */
    register: boolean;
    /** Hash, ktory Operator wpisuje po przegladzie (pokazywany w logu). */
    approvalHash: string;
    /** Odcisk pochodzenia, ktory Operator wpisuje razem z hashem (`origin`). */
    approvalOrigin: string;
}

export interface ResolveApprovalOptions {
    /** Skan wykazal dryf pochodzenia (isOriginDriftFinding). */
    originChanged?: boolean;
}

export function computeApprovalHash(server: McpServerDefinition): string {
    return computeDefinitionHash(server);
}

const HEX64 = /^[0-9a-f]{64}$/;

function isValidApproval(a: unknown): a is GatewayApproval {
    if (!a || typeof a !== "object") return false;
    const { hash, origin } = a as { hash?: unknown; origin?: unknown };
    if (typeof hash !== "string" || !HEX64.test(hash)) return false;
    // Odcisk w zlym ksztalcie = zatwierdzenie nieczytelne (fail-closed), a nie
    // "zatwierdzenie bez odcisku".
    return origin === undefined || (typeof origin === "string" && HEX64.test(origin));
}

export function resolveOperatorApproval(
    action: McpAction,
    server: McpServerDefinition,
    approval: unknown,
    options: ResolveApprovalOptions = {},
): OperatorApprovalDecision {
    const approvalHash = computeApprovalHash(server);
    const approvalOrigin = computeOriginFingerprint(server);
    const base = { approvalHash, approvalOrigin };
    if (action === "allowed" || action === "audit")
        return { status: "not_needed", register: true, ...base };
    if (action === "denied")
        return { status: "not_overridable", register: false, ...base };
    // human_review
    if (!isValidApproval(approval))
        return { status: "missing", register: false, ...base };
    if (approval.hash !== approvalHash)
        return { status: "hash_mismatch", register: false, ...base };
    if (approval.origin !== undefined ? approval.origin !== approvalOrigin : options.originChanged === true)
        return { status: "hash_mismatch", register: false, ...base };
    return { status: "approved", register: true, ...base };
}
