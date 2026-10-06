// Zdarzenie `error` czatu mowi, co padlo - w czacie sprawy tez (weryfikacja 2026-10-06).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { STREAM_ERROR_MAX, streamErrorEvent, streamErrorReason } from "./stream-error";

describe("streamErrorEvent", () => {
    it("niesie realny powod (brak klucza), nie gluchy 'Stream error'", () => {
        const e = new Error("Gemini API key is not configured. Set GEMINI_API_KEY or add a user Gemini key.");
        const linia = streamErrorEvent(e);
        expect(linia.startsWith("data: ")).toBe(true);
        expect(linia.endsWith("\n\n")).toBe(true);
        const ev = JSON.parse(linia.slice(6)) as { type: string; message: string };
        expect(ev.type).toBe("error");
        expect(ev.message).toContain("Gemini API key is not configured");
        expect(ev.message).not.toBe("Stream error");
    });

    it("tnie do granicy i radzi sobie z nie-Errorem", () => {
        expect(streamErrorReason(new Error("x".repeat(1000))).length).toBe(STREAM_ERROR_MAX);
        expect(streamErrorReason("timeout")).toBe("Blad generowania: timeout");
        expect(streamErrorReason(new Error(""))).toBe("Blad generowania: Error");
    });

    it("obie trasy czatu uzywaja tego samego zdarzenia (zadna nie wraca do 'Stream error')", () => {
        for (const plik of ["chat.ts", "projectChat.ts"]) {
            const src = fs.readFileSync(path.join(__dirname, "..", "..", "routes", plik), "utf-8");
            expect(src, plik).toContain("streamErrorEvent(err)");
            expect(src, plik).not.toMatch(/message:\s*"Stream error"/);
        }
    });
});
