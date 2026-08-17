// Test pure buildera posture egress (route config.ts, Faza 2 audytu Fable5).
// Gwarantuje kontrakt: same booleany odzwierciedlajace flagi env, ZERO PII -
// w szczegolnosci nazwa modelu lokalnego NIE wycieka do payloadu.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildEgressConfigPayload } from "./config";

const FLAGS = [
  "ALLOW_US_PROVIDERS",
  "PATRON_ALLOW_PRIVILEGED_CLOUD",
  "PATRON_LOCAL_MODEL",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const f of FLAGS) {
    saved[f] = process.env[f];
    delete process.env[f];
  }
});

afterEach(() => {
  for (const f of FLAGS) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f];
  }
});

describe("buildEgressConfigPayload", () => {
  it("fail-closed: brak env = wszystkie flagi false", () => {
    expect(buildEgressConfigPayload()).toEqual({
      us_providers: { allowed: false },
      privileged_cloud: { allowed: false },
      local_model_configured: false,
    });
  });

  it("odzwierciedla wlaczone flagi egress", () => {
    process.env.ALLOW_US_PROVIDERS = "true";
    process.env.PATRON_ALLOW_PRIVILEGED_CLOUD = "true";
    process.env.PATRON_LOCAL_MODEL = "ollama/llama3.3:70b";
    expect(buildEgressConfigPayload()).toEqual({
      us_providers: { allowed: true },
      privileged_cloud: { allowed: true },
      local_model_configured: true,
    });
  });

  it("nazwa modelu lokalnego NIE wycieka - tylko bool czy skonfigurowany", () => {
    process.env.PATRON_LOCAL_MODEL = "ollama/llama3.3:70b";
    const payload = buildEgressConfigPayload();
    expect(payload.local_model_configured).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("ollama");
  });

  it("flaga inna niz dokladnie 'true' = false (fail-closed)", () => {
    process.env.ALLOW_US_PROVIDERS = "1";
    process.env.PATRON_ALLOW_PRIVILEGED_CLOUD = "TRUE";
    const payload = buildEgressConfigPayload();
    expect(payload.us_providers.allowed).toBe(false);
    expect(payload.privileged_cloud.allowed).toBe(false);
  });
});
