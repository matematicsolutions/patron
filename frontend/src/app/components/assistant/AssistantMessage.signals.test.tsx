// Audyt 2026-09, D-14 i D-07: zgubione przypisy i awaria konektora MCP sa
// pokazywane w odpowiedzi jako jawne ostrzezenie (takze po przeladowaniu czatu -
// zdarzenia sa utrwalane w events), a nie przepadaja po cichu.
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
    supabase: {
        auth: {
            getSession: async () => ({ data: { session: null } }),
            onAuthStateChange: () => ({
                data: { subscription: { unsubscribe: () => {} } },
            }),
        },
    },
}));

import { AssistantMessage } from "./AssistantMessage";
import type { AssistantEvent } from "../shared/types";

function notices(events: AssistantEvent[]) {
    const { container } = render(<AssistantMessage content="" events={events} />);
    return Array.from(container.querySelectorAll('[data-testid="chat-signal-notice"]'));
}

describe("AssistantMessage - jawne sygnaly D-14 / D-07", () => {
    it("citations_parse_failed -> ostrzezenie o nieczytelnych przypisach", () => {
        const n = notices([
            { type: "content", text: "Kara umowna [1]." },
            { type: "citations_parse_failed", reason: "invalid_json", dropped: 0 },
        ]);
        expect(n).toHaveLength(1);
        expect(n[0].getAttribute("data-signal")).toBe("citations_parse_failed");
        expect(n[0].textContent).toMatch(/przypisy/i);
    });

    it("invalid_records -> ostrzezenie z liczba zgubionych przypisow", () => {
        const n = notices([
            { type: "content", text: "Tekst [1] [2]." },
            { type: "citations_parse_failed", reason: "invalid_records", dropped: 2 },
        ]);
        expect(n[0].textContent).toContain("(2)");
    });

    it("mcp_error -> ostrzezenie z nazwa konektora i narzedzia", () => {
        const n = notices([
            { type: "mcp_error", server: "saos", tool: "search_judgments" },
            { type: "content", text: "Sad Najwyzszy wskazal..." },
        ]);
        expect(n).toHaveLength(1);
        expect(n[0].textContent).toContain("saos");
        expect(n[0].textContent).toContain("search_judgments");
    });

    it("mcp_error z reason input_security (B-03) -> ostrzezenie o wstrzymaniu, nie o awarii", () => {
        const n = notices([
            { type: "mcp_error", server: "saos", tool: "search_judgments", reason: "input_security" },
        ]);
        expect(n).toHaveLength(1);
        expect(n[0].textContent).toMatch(/wstrzymany/);
        expect(n[0].textContent).not.toMatch(/nie odpowiedział/);
    });

    it("bez sygnalow -> brak ostrzezen", () => {
        expect(notices([{ type: "content", text: "Odpowiedz." }])).toHaveLength(0);
    });
});
