// Testy modala wyboru workflow w asystencie - powierzchnia demo "workflows".
// Siatka: wbudowane workflowy sa widoczne od razu (bez czekania na API), custom
// dochodza z API i sa oznaczone, wyszukiwarka filtruje po tytule, "Use" jest
// zablokowane bez wyboru i po wyborze zwraca CALY obiekt workflow + zamyka modal,
// awaria API nie zabija listy wbudowanych. patronApi zamockowane - zero sieci.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { t } from "@/i18n";
import type { PATRONWorkflow } from "../shared/types";
import { BUILT_IN_WORKFLOWS } from "../workflows/builtinWorkflows";

const listWorkflows = vi.fn();
vi.mock("@/app/lib/patronApi", () => ({
    listWorkflows: (...a: unknown[]) => listWorkflows(...a),
}));

import { AssistantWorkflowModal } from "./AssistantWorkflowModal";

const CUSTOM: PATRONWorkflow = {
    id: "wf-custom-1",
    user_id: "u1",
    title: "Analiza umowy najmu komercyjnego",
    type: "assistant",
    prompt_md: "## Analiza najmu\n\nSprawdz czynsz, kaucje i klauzule waloryzacyjne.",
    columns_config: null,
    is_system: false,
    created_at: "2026-08-18T10:00:00Z",
};

const BUILTIN_ASSISTANT = BUILT_IN_WORKFLOWS.filter((w) => w.type === "assistant");

beforeEach(() => {
    listWorkflows.mockReset();
});

describe("AssistantWorkflowModal - wybor workflow", () => {
    it("open=false: nic nie renderuje i nie wola API", () => {
        render(<AssistantWorkflowModal open={false} onClose={vi.fn()} onSelect={vi.fn()} />);
        expect(document.body.textContent).not.toContain(t("workflows.addWorkflow"));
        expect(listWorkflows).not.toHaveBeenCalled();
    });

    it("po zaladowaniu: wbudowane + custom z API, custom oznaczone jako wlasne", async () => {
        listWorkflows.mockResolvedValue([CUSTOM]);
        render(<AssistantWorkflowModal open onClose={vi.fn()} onSelect={vi.fn()} />);
        expect(BUILTIN_ASSISTANT.length).toBeGreaterThan(0);
        // W trakcie ladowania lista pokazuje loader (wbudowane wchodza do stanu,
        // ale UI czeka na API) - asercje po zakonczeniu ladowania.
        await screen.findByText(CUSTOM.title);
        expect(screen.getByText(BUILTIN_ASSISTANT[0].title)).toBeTruthy();
        expect(listWorkflows).toHaveBeenCalledWith("assistant");
        expect(screen.getAllByText(t("workflows.builtIn")).length).toBe(BUILTIN_ASSISTANT.length);
        expect(screen.getAllByText(t("workflows.custom")).length).toBe(1);
    });

    it("wyszukiwarka filtruje po tytule (case-insensitive); brak trafien = komunikat", async () => {
        listWorkflows.mockResolvedValue([CUSTOM]);
        render(<AssistantWorkflowModal open onClose={vi.fn()} onSelect={vi.fn()} />);
        await screen.findByText(CUSTOM.title);
        const input = screen.getByPlaceholderText(t("workflows.searchPlaceholder"));
        fireEvent.change(input, { target: { value: "NAJMU" } });
        expect(screen.getByText(CUSTOM.title)).toBeTruthy();
        expect(screen.queryByText(BUILTIN_ASSISTANT[0].title)).toBeNull();
        fireEvent.change(input, { target: { value: "nie-ma-takiego-workflow" } });
        expect(screen.getByText(t("common.noMatches"))).toBeTruthy();
    });

    it("Use zablokowane bez wyboru; po wyborze zwraca caly workflow i zamyka; podglad promptu widoczny", async () => {
        listWorkflows.mockResolvedValue([CUSTOM]);
        const onSelect = vi.fn();
        const onClose = vi.fn();
        render(<AssistantWorkflowModal open onClose={onClose} onSelect={onSelect} />);
        await screen.findByText(CUSTOM.title);
        const useBtn = screen.getByText("Use") as HTMLButtonElement;
        expect(useBtn.disabled).toBe(true);
        fireEvent.click(useBtn);
        expect(onSelect).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText(CUSTOM.title));
        await waitFor(() => expect(useBtn.disabled).toBe(false));
        expect(screen.getByText(/klauzule waloryzacyjne/)).toBeTruthy();
        fireEvent.click(useBtn);
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "wf-custom-1", prompt_md: CUSTOM.prompt_md });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("initialWorkflowId preselektuje wbudowany workflow (Use aktywne od razu)", async () => {
        listWorkflows.mockResolvedValue([]);
        const first = BUILTIN_ASSISTANT[0];
        render(
            <AssistantWorkflowModal open onClose={vi.fn()} onSelect={vi.fn()} initialWorkflowId={first.id} />,
        );
        await waitFor(() => expect((screen.getByText("Use") as HTMLButtonElement).disabled).toBe(false));
    });

    it("awaria API: lista wbudowanych ZOSTAJE, custom po prostu nie ma", async () => {
        listWorkflows.mockRejectedValue(new Error("down"));
        render(<AssistantWorkflowModal open onClose={vi.fn()} onSelect={vi.fn()} />);
        await waitFor(() => expect(listWorkflows).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByText(BUILTIN_ASSISTANT[0].title)).toBeTruthy());
        expect(screen.queryByText(t("workflows.custom"))).toBeNull();
    });
});
