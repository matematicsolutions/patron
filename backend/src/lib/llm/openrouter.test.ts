// Testy OpenRouter (ADR-0059) - routing modeli + czyste helpery (bez sieci).

import { describe, expect, it } from "vitest";
import {
  isOpenRouterModel,
  openRouterModelId,
  providerForModel,
  resolveModel,
} from "./models";
import {
  accumulateToolCallDeltas,
  buildChatBody,
  buildMessages,
} from "./openrouter";

describe("routing modeli OpenRouter", () => {
  it("providerForModel: prefix openrouter/ -> openrouter", () => {
    expect(
      providerForModel("openrouter/anthropic/claude-3.7-sonnet"),
    ).toBe("openrouter");
    expect(providerForModel("openrouter/speakleash/bielik-11b-v2.3")).toBe(
      "openrouter",
    );
  });

  it("providerForModel: modele natywne bez regresji", () => {
    expect(providerForModel("claude-sonnet-4-6")).toBe("claude");
    expect(providerForModel("gemini-3-flash-preview")).toBe("gemini");
    expect(providerForModel("gpt-5.5")).toBe("openai");
  });

  it("isOpenRouterModel / openRouterModelId strip prefiksu", () => {
    expect(isOpenRouterModel("openrouter/x/y")).toBe(true);
    expect(isOpenRouterModel("claude-sonnet-4-6")).toBe(false);
    expect(openRouterModelId("openrouter/anthropic/claude-3.7-sonnet")).toBe(
      "anthropic/claude-3.7-sonnet",
    );
    expect(openRouterModelId("gpt-5.5")).toBe("gpt-5.5");
  });

  it("resolveModel: przepuszcza openrouter/, waliduje natywne", () => {
    expect(resolveModel("openrouter/meta-llama/llama-3.3-70b", "fb")).toBe(
      "openrouter/meta-llama/llama-3.3-70b",
    );
    expect(resolveModel("gpt-5.5", "fb")).toBe("gpt-5.5");
    expect(resolveModel("nieznany-model", "fb")).toBe("fb");
    expect(resolveModel(null, "fb")).toBe("fb");
  });
});

describe("buildMessages / buildChatBody (pure)", () => {
  it("buildMessages: system na poczatku, potem tury", () => {
    const msgs = buildMessages("SYS", [
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
    ]);
    expect(msgs[0]).toEqual({ role: "system", content: "SYS" });
    expect(msgs[1]).toEqual({ role: "user", content: "U1" });
    expect(msgs.length).toBe(3);
  });

  it("buildMessages: pusty system pomijany", () => {
    const msgs = buildMessages("  ", [{ role: "user", content: "U" }]);
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe("user");
  });

  it("buildChatBody: model zdjety z prefiksu, stream, tools", () => {
    const body = buildChatBody({
      model: "openrouter/anthropic/claude-3.7-sonnet",
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          type: "function",
          function: { name: "t", description: "d", parameters: {} },
        },
      ],
      stream: true,
    }) as Record<string, unknown>;
    expect(body.model).toBe("anthropic/claude-3.7-sonnet");
    expect(body.stream).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("buildChatBody: brak tools -> pole undefined (nie pusta tablica)", () => {
    const body = buildChatBody({
      model: "openrouter/x/y",
      messages: [],
      stream: false,
    }) as Record<string, unknown>;
    expect(body.tools).toBeUndefined();
  });
});

describe("accumulateToolCallDeltas (pure)", () => {
  it("skleja id + dokleja arguments po index", () => {
    const acc = new Map();
    accumulateToolCallDeltas(acc, [
      { index: 0, id: "call_1", function: { name: "search", arguments: '{"q":' } },
    ]);
    accumulateToolCallDeltas(acc, [
      { index: 0, function: { arguments: '"zachowek"}' } },
    ]);
    const c = acc.get(0);
    expect(c.id).toBe("call_1");
    expect(c.name).toBe("search");
    expect(c.arguments).toBe('{"q":"zachowek"}');
  });

  it("obsluguje rownolegle wywolania po roznym index", () => {
    const acc = new Map();
    accumulateToolCallDeltas(acc, [
      { index: 0, id: "a", function: { name: "f0", arguments: "{}" } },
      { index: 1, id: "b", function: { name: "f1", arguments: "{}" } },
    ]);
    expect(acc.size).toBe(2);
    expect(acc.get(1).name).toBe("f1");
  });
});
