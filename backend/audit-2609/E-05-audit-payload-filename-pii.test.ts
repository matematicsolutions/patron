// E-05: Konstytucja 5.1 (governance/CONSTITUTION.md:264,270-272) obiecuje, ze payload
// input_security_scan to {document_id, security_status, findings[...]} i ze pola payload sa
// "celowo bez pelnej tresci - dlugosci, liczniki, identyfikatory", a lib/rodo/forget.ts:7-10
// uzasadnia pozostawienie audit_log po "zapomnij sprawe" tym, ze "payload to skroty, nie tresc".
// Faktycznie toAuditPayload (lib/input-security/ingest.ts:102-116) zapisuje file_name - oryginalna
// nazwe pliku klienta (documentIngest.ts:158-169, takze wersje documents.ts:454) - do
// append-only lancucha. Nazwy akt zwykle zawieraja nazwisko/PESEL/nazwe spolki; po RODO art. 17
// (forgetCase) zostaja w audit_log na zawsze (zmiana = zerwanie hash-chain) i trafiaja do
// eksportow audytowych.
// Oczekiwane: payload audytu skanu nie niesie danych osobowych z nazwy pliku (np. tylko
// document_id / rozszerzenie / hash nazwy).
import { describe, it, expect } from "vitest";
import { analyzeInput } from "../src/lib/input-security";
import { toAuditPayload } from "../src/lib/input-security/ingest";

describe("E-05 payload input_security_scan a dane osobowe w nazwie pliku", () => {
    it("audit payload nie zawiera nazwiska ani PESEL klienta z nazwy pliku", () => {
        const fileName = "Pozew_Jan_Testowy_PESEL_90010112349.pdf"; // dane syntetyczne
        const scan = analyzeInput({
            text: "Sad Rejonowy. Pozew o zaplate kwoty 10 000 zl.",
            fileName,
            declaredType: "application/pdf",
        });
        const serialized = JSON.stringify(toAuditPayload(scan));
        expect(serialized).not.toContain("Jan_Testowy");
        expect(serialized).not.toContain("90010112349");
    });
});
