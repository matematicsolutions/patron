// Testy pipeline obrony (ADR-0058). Buildery promptow (pure) + orkiestrator
// z fake-LLM (bez prawdziwych wywolan modelu).

import { describe, expect, it } from "vitest";
import {
  ALL_STAGES,
  buildAdwokatPrompt,
  buildPiszPoLudzkuPrompt,
  buildRecenzentPrompt,
  runDefensePipeline,
  type LlmCompleteFn,
} from "./defense";

describe("buildery promptow (pure)", () => {
  it("recenzent: rola + draft + regula zwrotu", () => {
    const p = buildRecenzentPrompt("TRESC PISMA");
    expect(p.system).toContain("radca prawny");
    expect(p.user).toContain("TRESC PISMA");
    expect(p.system).toContain("WYLACZNIE poprawiona wersje");
  });

  it("adwokat: tryby maja rozne role", () => {
    expect(buildAdwokatPrompt("d", "strona-przeciwna").system).toContain(
      "strony PRZECIWNEJ",
    );
    expect(buildAdwokatPrompt("d", "sad").system).toContain("sklad orzekajacy");
    expect(buildAdwokatPrompt("d", "prokurator").system).toContain(
      "prokuratora",
    );
  });

  it("pisz-po-ludzku: usuwa AI-slop, zachowuje precyzje", () => {
    const p = buildPiszPoLudzkuPrompt("d");
    expect(p.system).toContain("AI-slop");
    expect(p.system).toContain("precyzje");
  });

  it("kontekst wstrzykiwany w user prompt", () => {
    const p = buildRecenzentPrompt("d", "apelacja cywilna");
    expect(p.user).toContain("Kontekst sprawy: apelacja cywilna");
  });
});

describe("runDefensePipeline (fake LLM)", () => {
  function recordingLlm(): { fake: LlmCompleteFn; calls: { user: string; system?: string }[] } {
    const calls: { user: string; system?: string }[] = [];
    const fake: LlmCompleteFn = async (p) => {
      calls.push({ user: p.user, system: p.systemPrompt });
      return `OUT${calls.length}`;
    };
    return { fake, calls };
  }

  it("3 etapy w kolejnosci, output lancuchuje sie, final = ostatni", async () => {
    const { fake, calls } = recordingLlm();
    const r = await runDefensePipeline("DRAFT0", { model: "m" }, fake);
    expect(calls.length).toBe(3);
    expect(r.stages.map((s) => s.stage)).toEqual(ALL_STAGES);
    expect(calls[0].user).toContain("DRAFT0");
    expect(calls[1].user).toContain("OUT1"); // wejscie etapu 2 = output etapu 1
    expect(calls[2].user).toContain("OUT2");
    expect(r.final).toBe("OUT3");
  });

  it("domyslny tryb adwokata = strona-przeciwna", async () => {
    const { fake } = recordingLlm();
    const r = await runDefensePipeline("d", { model: "m" }, fake);
    expect(r.stages.find((s) => s.stage === "adwokat")?.mode).toBe(
      "strona-przeciwna",
    );
  });

  it("tryb adwokata respektowany (sad)", async () => {
    const { fake, calls } = recordingLlm();
    const r = await runDefensePipeline(
      "d",
      { model: "m", adwokatMode: "sad" },
      fake,
    );
    expect(r.stages.find((s) => s.stage === "adwokat")?.mode).toBe("sad");
    expect(calls[1].system).toContain("sklad orzekajacy");
  });

  it("subset etapow: tylko recenzent", async () => {
    const { fake, calls } = recordingLlm();
    const r = await runDefensePipeline(
      "d",
      { model: "m", stages: ["recenzent"] },
      fake,
    );
    expect(calls.length).toBe(1);
    expect(r.stages.map((s) => s.stage)).toEqual(["recenzent"]);
  });

  it("pusta odpowiedz etapu nie kasuje draftu", async () => {
    const empty: LlmCompleteFn = async () => "   ";
    const r = await runDefensePipeline(
      "ORIGINAL",
      { model: "m", stages: ["recenzent"] },
      empty,
    );
    expect(r.final).toBe("ORIGINAL");
  });
});
