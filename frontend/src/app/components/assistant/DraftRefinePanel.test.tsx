// Audyt 2026-09, A-05: panel "Draft odpowiedzi" wysylal /draft/refine bez
// `model` i bez `project_id`. Backend bral wtedy chmurowy DEFAULT_MAIN_MODEL,
// a straznik egress klasyfikowal tresc jako "internal" (brak sprawy) - odpowiedz
// z rozmowy prowadzonej modelem lokalnym w sprawie objetej tajemnica szla do
// chmury jednym kliknieciem.
//
// Pilnujemy trzech warstw:
//  1. panel wysyla model i sprawe, ktore dostal od rodzica;
//  2. bez modelu od rodzica bierze BIEZACY wybor selektora czatu (nigdy nie
//     zostawia pola pustego, bo wtedy decyduje cichy domyslny backendu);
//  3. kazde miejsce montowania przekazuje model tury, a w sprawie - projectId
//     (skan zrodel z kontrola mianownika, wzorzec no-relative-api.test.ts).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import type React from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refineDraft } = vi.hoisted(() => ({
    refineDraft: vi.fn(async (_p: Record<string, unknown>) => ({ final: "ok", stages: [] })),
}));
vi.mock("@/app/lib/patronApi", () => ({ refineDraft }));

import { DraftRefinePanel } from "./DraftRefinePanel";
import { MODELS } from "./ModelToggle";
import { modelOfTurn } from "./turnModel";
import type { PATRONMessage } from "../shared/types";
import { t } from "@/i18n";

vi.setConfig({ testTimeout: 60_000 });

const LOCAL = MODELS.find((m) => m.id.startsWith("ollama/"))!.id;
const TEXT = "Pan Jan Testowy wnosi o oddalenie powodztwa.";

function lastPayload(): Record<string, unknown> {
    const calls = refineDraft.mock.calls;
    return calls[calls.length - 1]![0] as Record<string, unknown>;
}

beforeEach(() => {
    refineDraft.mockClear();
    try {
        window.localStorage.clear();
    } catch {
        /* jsdom bez storage - test i tak sprawdza fallback */
    }
});

describe("DraftRefinePanel - model i sprawa (A-05)", () => {
    it("wysyla model rozmowy i project_id od rodzica", async () => {
        render(
            <DraftRefinePanel
                open
                onClose={() => {}}
                initialText={TEXT}
                model="ollama/llama3.3:70b"
                projectId="p-tajemnica-1"
            />,
        );
        fireEvent.click(screen.getByText(t("draft.refine")));
        await waitFor(() => expect(refineDraft).toHaveBeenCalled());
        expect(lastPayload().model).toBe("ollama/llama3.3:70b");
        expect(lastPayload().project_id).toBe("p-tajemnica-1");
    });

    it("bez modelu od rodzica: biezacy wybor selektora czatu, nie pole puste", async () => {
        window.localStorage.setItem("patron.selectedModel", LOCAL);
        render(<DraftRefinePanel open onClose={() => {}} initialText={TEXT} />);
        fireEvent.click(screen.getByText(t("draft.refine")));
        await waitFor(() => expect(refineDraft).toHaveBeenCalled());
        expect(lastPayload().model).toBe(LOCAL);
    });

    it("czat poza sprawa: brak project_id w zadaniu (nie pusty napis)", async () => {
        render(
            <DraftRefinePanel open onClose={() => {}} initialText={TEXT} model={LOCAL} />,
        );
        fireEvent.click(screen.getByText(t("draft.refine")));
        await waitFor(() => expect(refineDraft).toHaveBeenCalled());
        expect("project_id" in lastPayload()).toBe(false);
        expect(lastPayload().model).toBe(LOCAL);
    });

    it("panel pokazuje, jakim modelem pojdzie tekst i czy jest sprawa", () => {
        const label = MODELS.find((m) => m.id === LOCAL)!.label;
        const { rerender } = render(
            <DraftRefinePanel open onClose={() => {}} initialText={TEXT} model={LOCAL} projectId="p1" />,
        );
        const line = () => screen.getByTestId("draft-routing").textContent ?? "";
        expect(line()).toContain(label);
        expect(line()).toContain(t("draft.routing.caseScoped"));
        rerender(<DraftRefinePanel open onClose={() => {}} initialText={TEXT} model={LOCAL} />);
        expect(line()).toContain(t("draft.routing.noCase"));
    });
});

describe("modelOfTurn", () => {
    const msgs: PATRONMessage[] = [
        { role: "user", content: "a", model: "ollama/a" },
        { role: "assistant", content: "A" },
        { role: "user", content: "b", model: "openrouter/x/y" },
        { role: "assistant", content: "B" },
        { role: "user", content: "c" },
        { role: "assistant", content: "C" },
    ];
    it("bierze model najblizszej wczesniejszej wiadomosci uzytkownika", () => {
        expect(modelOfTurn(msgs, 1)).toBe("ollama/a");
        expect(modelOfTurn(msgs, 3)).toBe("openrouter/x/y");
    });
    it("nie przeskakuje na starsza ture, gdy ostatnia nie niesie modelu (czat z bazy)", () => {
        expect(modelOfTurn(msgs, 5)).toBeNull();
    });
    it("wlasny model wiadomosci ma pierwszenstwo", () => {
        expect(modelOfTurn([{ role: "assistant", content: "x", model: "ollama/z" }], 0)).toBe("ollama/z");
    });
});

// --- 3. miejsca montowania ---------------------------------------------------

const SRC_DIR = join(__dirname, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
    }
    return out;
}
const rel = (p: string) => p.slice(SRC_DIR.length + 1).split(sep).join("/");

/** Zwraca tekst kazdego elementu JSX `<Tag ... />` / `<Tag ...>` w pliku. */
function jsxOpenings(src: string, tag: string): string[] {
    const out: string[] = [];
    const re = new RegExp(`<${tag}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
        // Koniec otwarcia: pierwsze "/>" albo ">" na glebokosci 0 nawiasow {}.
        let depth = 0;
        let i = m.index + tag.length + 1;
        for (; i < src.length; i++) {
            const ch = src[i];
            if (ch === "{") depth++;
            else if (ch === "}") depth--;
            else if (depth === 0 && ch === ">") break;
        }
        out.push(src.slice(m.index, i + 1));
    }
    return out;
}

/**
 * Miejsca montowania. Mianownik jest NAZWANY: nowe miejsce montowania musi tu
 * trafic swiadomie (z decyzja, czy ma sprawe), inaczej test jest czerwony.
 */
const MONTAZE_ODPOWIEDZI: Record<string, "sprawa" | "bez-sprawy"> = {
    // czat w sprawie - projectId z adresu
    "app/(pages)/projects/[id]/assistant/chat/[chatId]/page.tsx": "sprawa",
    // czat poza sprawa (/assistant) - czaty spraw sa kierowane na strone sprawy
    "app/components/assistant/ChatView.tsx": "bez-sprawy",
};

describe("miejsca montowania panelu draftu", () => {
    const files = walk(SRC_DIR).map((p) => ({ p: rel(p), src: readFileSync(p, "utf8") }));

    it("mianownik: skan widzi zrodla i definicje panelu", () => {
        expect(files.length).toBeGreaterThan(50);
        expect(files.some((f) => f.p === "app/components/assistant/DraftRefinePanel.tsx")).toBe(true);
    });

    it("DraftRefinePanel montowany tylko w AssistantMessage, z model i projectId", () => {
        const mounts = files.filter((f) => jsxOpenings(f.src, "DraftRefinePanel").length > 0);
        expect(mounts.map((f) => f.p)).toEqual(["app/components/assistant/AssistantMessage.tsx"]);
        for (const el of jsxOpenings(mounts[0]!.src, "DraftRefinePanel")) {
            expect(el).toMatch(/\bmodel=\{/);
            expect(el).toMatch(/\bprojectId=\{/);
        }
    });

    it("kazdy montaz AssistantMessage przekazuje model tury, a w sprawie - projectId", () => {
        const mounts = files.filter((f) => jsxOpenings(f.src, "AssistantMessage").length > 0);
        expect(mounts.map((f) => f.p).sort()).toEqual(Object.keys(MONTAZE_ODPOWIEDZI).sort());
        for (const f of mounts) {
            for (const el of jsxOpenings(f.src, "AssistantMessage")) {
                expect(el, f.p).toMatch(/\bmodel=\{/);
                if (MONTAZE_ODPOWIEDZI[f.p] === "sprawa") expect(el, f.p).toMatch(/\bprojectId=\{/);
            }
        }
    });

    it("kontrola pozytywna parsera: element bez propa jest wykrywany", () => {
        const [el] = jsxOpenings(`<AssistantMessage a={x > 1 ? {b: 2} : null} />`, "AssistantMessage");
        expect(el).toBe(`<AssistantMessage a={x > 1 ? {b: 2} : null} />`);
        expect(el).not.toMatch(/\bmodel=\{/);
    });
});

// Typ: panel przyjmuje propsy bez rzutowania (A-05 test audytu rzutowal).
const _typeCheck: React.ComponentProps<typeof DraftRefinePanel> = {
    open: true,
    onClose: () => {},
    initialText: "",
    model: null,
    projectId: null,
};
void _typeCheck;
