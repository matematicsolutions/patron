// Bramka synchronizacji: front powtarza prefiks transportu za backendem, wiec
// powtorka musi byc pilnowana mechanicznie. Sprawdzamy ja o picker modeli - to
// jedyna lista, ktora widzi mecenas.

import { describe, expect, it } from "vitest";
import { MODELS } from "@/app/components/assistant/ModelToggle";
import { isLocalModel } from "./modelEgress";

describe("isLocalModel - lustro rejestru egress backendu", () => {
    it("kazda pozycja grupy 'Lokalny' w pickerze jest faktycznie lokalna", () => {
        const local = MODELS.filter((m) => m.group === "Lokalny");
        // Pusta lista przechodzi zawsze - bramka bez mianownika nie jest bramka.
        expect(local.length).toBeGreaterThan(0);
        for (const m of local) {
            expect(isLocalModel(m.id), m.id).toBe(true);
        }
    });

    it("zadna pozycja spoza grupy 'Lokalny' nie udaje lokalnej", () => {
        const cloud = MODELS.filter((m) => m.group !== "Lokalny");
        expect(cloud.length).toBeGreaterThan(0);
        for (const m of cloud) {
            expect(isLocalModel(m.id), m.id).toBe(false);
        }
    });

    it("model 'polski' routowany przez OpenRouter NIE jest lokalny", () => {
        expect(
            isLocalModel("openrouter/speakleash/bielik-11b-v2.3-instruct"),
        ).toBe(false);
    });

    it("nieznany model nie awansuje na lokalny (fail-closed)", () => {
        expect(isLocalModel("")).toBe(false);
        expect(isLocalModel("llama3:latest")).toBe(false);
        expect(isLocalModel("gemini-3-flash-preview")).toBe(false);
    });
});
