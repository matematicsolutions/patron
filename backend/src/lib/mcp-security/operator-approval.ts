// Zatwierdzenie werdyktu `human_review` przez Operatora (ADR-0158, rozszerza ADR-0028).
//
// Do tej pory `human_review` blokowal rejestracje konektora BEZ sciezki decyzji:
// czlowiek nie mial jak zdecydowac, wiec werdykt dzialal jak `denied`. Teraz
// Operator moze zatwierdzic KONKRETNA definicje konektora, wpisujac w
// mcp-servers.json `gatewayApproval.hash`. Zasady:
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
// Modul jest czysty - bez IO, bez logowania.

import { computeDefinitionHash } from "./detectors/drift";
import type { McpAction, McpServerDefinition } from "./types";

export interface GatewayApproval {
    /** Hash zatwierdzonej definicji (computeApprovalHash), 64 znaki hex. */
    hash: string;
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
}

export function computeApprovalHash(server: McpServerDefinition): string {
    return computeDefinitionHash(server);
}

function isValidApproval(a: unknown): a is GatewayApproval {
    return (
        !!a &&
        typeof a === "object" &&
        typeof (a as GatewayApproval).hash === "string" &&
        /^[0-9a-f]{64}$/.test((a as GatewayApproval).hash)
    );
}

export function resolveOperatorApproval(
    action: McpAction,
    server: McpServerDefinition,
    approval: unknown,
): OperatorApprovalDecision {
    const approvalHash = computeApprovalHash(server);
    if (action === "allowed" || action === "audit")
        return { status: "not_needed", register: true, approvalHash };
    if (action === "denied")
        return { status: "not_overridable", register: false, approvalHash };
    // human_review
    if (!isValidApproval(approval))
        return { status: "missing", register: false, approvalHash };
    if (approval.hash !== approvalHash)
        return { status: "hash_mismatch", register: false, approvalHash };
    return { status: "approved", register: true, approvalHash };
}
