// B-10: import paczki skilla w panelu - zgoda na egress przy imporcie i jawny
// stan podpisu. API zamockowane, zero sieci. Dane syntetyczne.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillEntry, SkillsList } from "@/app/lib/patronApi";
import { t } from "@/i18n";

const api = vi.hoisted(() => ({
    list: { builtin: [], installed: [] } as SkillsList,
    importSkill: vi.fn(),
}));

vi.mock("@/app/lib/patronApi", () => ({
    listSkills: async () => api.list,
    importSkill: (...a: unknown[]) => api.importSkill(...a),
    setSkillEnabled: vi.fn(),
    removeSkill: vi.fn(),
}));

import { SkillLibraryPanel } from "./SkillLibraryPanel";

function wpis(over: Partial<SkillEntry>): SkillEntry {
    return {
        id: "styl",
        name: "Styl pism",
        description: "",
        version: "1.0.0",
        surface: "draft-stage",
        source: "local-file",
        egress: "no-egress",
        publisher: null,
        signed: false,
        signature_status: "absent",
        builtin: false,
        enabled: true,
        ...over,
    };
}

function plik(manifest: Record<string, unknown>): File {
    const f = new File([JSON.stringify(manifest)], "skill.json", { type: "application/json" });
    // jsdom nie implementuje File.text() we wszystkich wersjach.
    Object.defineProperty(f, "text", { value: async () => JSON.stringify(manifest) });
    return f;
}

async function wybierz(manifest: Record<string, unknown>) {
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [plik(manifest)] } });
}

describe("SkillLibraryPanel - B-10 import paczki", () => {
    beforeEach(() => {
        api.list = { builtin: [], installed: [] };
        api.importSkill.mockReset();
        vi.restoreAllMocks();
    });

    it("paczka cloud-allowed: pyta o zgode; odmowa = import bez zgody i jawna informacja o wylaczeniu", async () => {
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
        api.importSkill.mockResolvedValue({ ...wpis({ egress: "cloud-allowed", enabled: false }), requires_egress_consent: true });
        render(<SkillLibraryPanel open onClose={() => {}} />);
        await wybierz({ id: "styl", egress: "cloud-allowed" });
        await waitFor(() => expect(api.importSkill).toHaveBeenCalled());
        expect(confirm).toHaveBeenCalledWith(t("skillLibrary.importTrust.egressConfirm"));
        expect(api.importSkill.mock.calls[0][1]).toBe(false);
        expect(await screen.findByText(t("skillLibrary.importTrust.importedDisabled"))).toBeTruthy();
    });

    it("paczka cloud-allowed: zgoda idzie do API jako confirm_egress=true", async () => {
        vi.spyOn(window, "confirm").mockReturnValue(true);
        api.importSkill.mockResolvedValue({ ...wpis({ egress: "cloud-allowed" }), requires_egress_consent: false });
        render(<SkillLibraryPanel open onClose={() => {}} />);
        await wybierz({ id: "styl", egress: "cloud-allowed" });
        await waitFor(() => expect(api.importSkill).toHaveBeenCalled());
        expect(api.importSkill.mock.calls[0][1]).toBe(true);
        expect(screen.queryByText(t("skillLibrary.importTrust.importedDisabled"))).toBeNull();
    });

    it("paczka no-egress: bez pytania o zgode", async () => {
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
        api.importSkill.mockResolvedValue({ ...wpis({}), requires_egress_consent: false });
        render(<SkillLibraryPanel open onClose={() => {}} />);
        await wybierz({ id: "styl" });
        await waitFor(() => expect(api.importSkill).toHaveBeenCalled());
        expect(confirm).not.toHaveBeenCalled();
    });

    it("pole podpisu bez weryfikacji: etykieta 'podpis niezweryfikowany', nie znika jak przy signed", async () => {
        api.list = {
            builtin: [],
            installed: [
                wpis({ id: "a", name: "Z napisem", signature_status: "unverified", publisher: "Wydawca" }),
                wpis({ id: "b", name: "Bez podpisu", signature_status: "absent" }),
            ],
        };
        render(<SkillLibraryPanel open onClose={() => {}} />);
        expect(await screen.findByText(t("skillLibrary.importTrust.signatureUnverified"))).toBeTruthy();
        expect(screen.getByText(t("skillLibrary.unsigned"))).toBeTruthy();
    });
});
