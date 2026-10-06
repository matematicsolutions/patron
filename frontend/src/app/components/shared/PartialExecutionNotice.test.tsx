// Wykonanie czesciowe edycji / komentarzy DOCX (audyt C-08 / D-10): UI ma
// jawnie powiedziec "zastosowano N z M" i wymienic, czego nie zastosowano -
// zarowno w inboxie kart zatwierdzen, jak i w panelu edycji w czacie.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "@/i18n";
import {
    PartialExecutionNotice,
    partialFromApprovalResult,
    readFailures,
} from "./PartialExecutionNotice";

describe("partialFromApprovalResult", () => {
    it("pelny sukces -> null (brak ostrzezenia)", () => {
        expect(
            partialFromApprovalResult(true, { applied: 2, requested: 2, failed: 0, errors: [] }),
        ).toBeNull();
    });

    it("wykonanie nieudane w calosci -> null (to obsluguje execution_error)", () => {
        expect(partialFromApprovalResult(false, null)).toBeNull();
    });

    it("1 z 2 -> liczby i powody", () => {
        const info = partialFromApprovalResult(true, {
            applied: 1,
            requested: 2,
            failed: 1,
            errors: [{ index: 1, reason: "Nie znaleziono." }],
        });
        expect(info).toEqual({ applied: 1, total: 2, failures: [{ index: 1, reason: "Nie znaleziono." }] });
    });

    it("stary ksztalt wyniku (bez requested) -> total = applied + bledy", () => {
        const info = partialFromApprovalResult(true, {
            applied: 3,
            errors: [{ index: 0, reason: "a" }, { index: 4, reason: "b" }],
        });
        expect(info?.total).toBe(5);
    });
});

describe("readFailures", () => {
    it("odrzuca smieci z niezaufanego JSON-a", () => {
        expect(readFailures([null, 1, { reason: 5 }, { index: 2, reason: "ok" }, { reason: "bez indeksu" }])).toEqual([
            { index: 2, reason: "ok" },
            { index: -1, reason: "bez indeksu" },
        ]);
        expect(readFailures(undefined)).toEqual([]);
    });
});

describe("PartialExecutionNotice", () => {
    it("pokazuje 'zastosowano N z M' i liste niezastosowanych zmian", () => {
        render(
            <PartialExecutionNotice
                filename="umowa.docx"
                note={t("partialExecution.chatNote")}
                info={{
                    applied: 1,
                    total: 2,
                    failures: [{ index: 1, reason: "Kwota $1 nie znaleziona" }],
                }}
            />,
        );
        expect(screen.getByRole("alert")).toBeTruthy();
        expect(
            screen.getByText(
                t("partialExecution.summary").replace("{applied}", "1").replace("{total}", "2"),
            ),
        ).toBeTruthy();
        expect(screen.getByText(t("partialExecution.notAppliedLabel"))).toBeTruthy();
        // Numer pozycji 1-based; "$1" w powodzie zostaje doslownie.
        expect(screen.getByText(/nr 2: Kwota \$1 nie znaleziona|no\. 2: Kwota \$1 nie znaleziona/)).toBeTruthy();
        expect(screen.getByText(/umowa\.docx/)).toBeTruthy();
    });
});
