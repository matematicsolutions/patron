// Baner odpowiedzi niepelnej: widoczny dla obu powodow przerwania, niewidoczny
// dla odpowiedzi pelnej i dla braku informacji (starsze wiadomosci).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "@/i18n";
import { IncompleteBanner } from "./IncompleteBanner";

describe("IncompleteBanner", () => {
    it("limit krokow -> komunikat o limicie krokow", () => {
        const { container } = render(<IncompleteBanner reason="max_iterations" />);
        expect(container.textContent).toBe(t("chat.incompleteMaxIterations"));
    });

    it("limit dlugosci -> komunikat o ucieciu", () => {
        const { container } = render(<IncompleteBanner reason="max_tokens" />);
        expect(container.textContent).toBe(t("chat.incompleteMaxTokens"));
    });

    it("brak powodu -> nic (nie udajemy wiedzy o starszych wiadomosciach)", () => {
        const { container } = render(<IncompleteBanner />);
        expect(container.innerHTML).toBe("");
    });
});
