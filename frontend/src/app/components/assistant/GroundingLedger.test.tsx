// Rejestr kontroli cytatu rozmowy: bez przywolan NIE renderuje sie wcale
// (pusta dekoracja klamie), a zolty "nie potwierdzam" nigdy nie znika
// w zbiorczym "ok" - to jedyne miejsce, w ktorym produkt mowi prawnikowi
// cos, czego ten nie chce uslyszec.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
    GroundingLedger,
    sumGroundingVerdicts,
} from "./GroundingLedger";
import type { PATRONMessage } from "@/app/components/shared/types";
import { t } from "@/i18n";

function msgWith(summary: {
    green: number;
    yellow: number;
    red: number;
}): PATRONMessage {
    return {
        role: "assistant",
        content: "x",
        mcpGrounding: {
            quotes: [],
            summary: { quotes: 0, sources: 0, cards: 0, ...summary },
        },
    };
}

describe("GroundingLedger", () => {
    it("sumuje werdykty ze wszystkich odpowiedzi rozmowy", () => {
        const c = sumGroundingVerdicts([
            msgWith({ green: 2, yellow: 1, red: 0 }),
            { role: "user", content: "pytanie" },
            msgWith({ green: 1, yellow: 0, red: 1 }),
        ]);
        expect(c).toEqual({ green: 3, yellow: 1, red: 1 });
    });

    it("bez przywolan nie renderuje sie wcale", () => {
        render(<GroundingLedger messages={[{ role: "user", content: "q" }]} />);
        expect(screen.queryByTestId("grounding-ledger")).toBeNull();
    });

    it("zolty 'nie potwierdzam' jest widoczny z liczba i slowem, nie samym kolorem", () => {
        render(
            <GroundingLedger
                messages={[msgWith({ green: 2, yellow: 1, red: 0 })]}
            />,
        );
        const ledger = screen.getByTestId("grounding-ledger");
        expect(ledger.textContent).toContain(`1 ${t("citations.ledgerYellow")}`);
        expect(ledger.textContent).toContain(`2 ${t("citations.ledgerGreen")}`);
        expect(ledger.textContent).not.toContain(t("citations.ledgerRed"));
    });
});
