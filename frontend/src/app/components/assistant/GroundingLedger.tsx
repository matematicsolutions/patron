// Rejestr kontroli cytatu na poziomie ROZMOWY (ADR-0146, rozszerzenie
// "Awers i rewers" 2026-08-21).
//
// Werdykty groundingu zyja przy pojedynczych odpowiedziach - prawnik, ktory
// przewinal rozmowe, nie widzi, czy gdzies wyzej zostal zolty "nie
// potwierdzam". Ten pasek sumuje werdykty CALEJ rozmowy i wisi przy polu
// pytania, czyli w jedynym miejscu, na ktore patrzy sie zawsze. Zaden
// zmierzony konkurent nie pokazuje niepewnosci na poziomie rozmowy.
//
// Zasady: bez przywolan nie renderuje sie wcale (zloto sie zarabia - pusta
// dekoracja klamie); kolor nigdy nie idzie sam (kropka + liczba + slowo);
// zolty i czerwony NIGDY nie znikaja w zbiorczym "ok".

"use client";

import type { ReactElement } from "react";
import type { PATRONMessage } from "@/app/components/shared/types";
import { t } from "@/i18n";

export interface LedgerCounts {
    green: number;
    yellow: number;
    red: number;
}

/** Suma werdyktow z raportow groundingu wszystkich odpowiedzi rozmowy. */
export function sumGroundingVerdicts(messages: PATRONMessage[]): LedgerCounts {
    const acc: LedgerCounts = { green: 0, yellow: 0, red: 0 };
    for (const msg of messages) {
        const s = msg.mcpGrounding?.summary;
        if (!s) continue;
        acc.green += s.green;
        acc.yellow += s.yellow;
        acc.red += s.red;
    }
    return acc;
}

function Item({
    tone,
    dot,
    count,
    label,
}: {
    tone: string;
    dot: string;
    count: number;
    label: string;
}) {
    return (
        <span className={`inline-flex items-baseline gap-1 font-semibold ${tone}`}>
            <span
                className={`h-[6px] w-[6px] shrink-0 translate-y-[-1px] rounded-full ${dot}`}
                aria-hidden="true"
            />
            {count} {label}
        </span>
    );
}

/**
 * `bar` - poziomy pasek nad polem pytania (uzywany ponizej xl, gdy nie ma
 * marginesu). `margin` - naglowek trzeciej strefy: etykieta i werdykty jedno
 * pod drugim, bez ramki, bo kolumne wyznacza juz kreska marginesu.
 */
export function GroundingLedger({
    messages,
    variant = "bar",
}: {
    messages: PATRONMessage[];
    variant?: "bar" | "margin";
}): ReactElement | null {
    const c = sumGroundingVerdicts(messages);
    const total = c.green + c.yellow + c.red;
    if (total === 0) return null;

    const items = (
        <>
            {c.green > 0 ? (
                <Item
                    tone="text-grounded"
                    dot="bg-grounded"
                    count={c.green}
                    label={t("citations.ledgerGreen")}
                />
            ) : null}
            {c.yellow > 0 ? (
                <Item
                    tone="text-unverified"
                    dot="bg-unverified"
                    count={c.yellow}
                    label={t("citations.ledgerYellow")}
                />
            ) : null}
            {c.red > 0 ? (
                <Item
                    tone="text-ungrounded"
                    dot="bg-ungrounded"
                    count={c.red}
                    label={t("citations.ledgerRed")}
                />
            ) : null}
        </>
    );

    if (variant === "margin") {
        return (
            <div
                role="status"
                data-testid="grounding-ledger"
                aria-label={t("citations.ledgerAriaLabel")}
                className="flex flex-col gap-1 text-[11px] leading-tight text-gray-500"
            >
                <span className="uppercase tracking-[0.1em] text-gray-400">
                    {t("citations.ledgerLabel")}
                </span>
                {items}
            </div>
        );
    }

    return (
        <div
            role="status"
            data-testid="grounding-ledger"
            aria-label={t("citations.ledgerAriaLabel")}
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-gray-200 px-4 pb-1.5 pt-2 text-[11px] leading-tight text-gray-500"
        >
            <span className="uppercase tracking-[0.08em]">
                {t("citations.ledgerLabel")}
            </span>
            {items}
        </div>
    );
}
