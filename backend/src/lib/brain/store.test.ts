// Testy brain store (Bibliotekarz, ADR-0057). Deterministyczne, FS w temp.

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";

let store: typeof import("./store");
const tmpBrain = path.join(os.tmpdir(), `patron-brain-test-${Date.now()}`);

beforeAll(async () => {
  process.env.PATRON_BRAIN_DIR = tmpBrain;
  store = await import("./store");
});

afterAll(() => {
  try {
    fs.rmSync(tmpBrain, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("brain store: saveMemory / upsert / index", () => {
  it("created -> updated po tym samym slug, created_at zachowany", () => {
    const r1 = store.saveMemory({
      scope: "case-1",
      slug: "preferencja-styl",
      type: "preferencja",
      title: "Styl pism",
      body: "Klient woli forme bezosobowa.",
    });
    expect(r1.action).toBe("created");
    const first = store.readMemory("case-1", "preferencja-styl");
    const created = first?.meta.created_at;

    const r2 = store.saveMemory({
      scope: "case-1",
      slug: "preferencja-styl",
      type: "preferencja",
      title: "Styl pism",
      body: "Klient woli forme bezosobowa i krotkie zdania.",
    });
    expect(r2.action).toBe("updated");
    const second = store.readMemory("case-1", "preferencja-styl");
    expect(second?.meta.created_at).toBe(created); // zachowany
    expect(second?.body).toContain("krotkie zdania");
  });

  it("INDEX.md powstaje i listuje wpisy", () => {
    store.saveMemory({
      scope: "case-1",
      slug: "termin-apelacja",
      type: "termin",
      title: "Termin apelacji",
      body: "14 dni od doreczenia wyroku.",
    });
    const idx = fs.readFileSync(
      path.join(tmpBrain, "case-1", "INDEX.md"),
      "utf8",
    );
    expect(idx).toContain("Termin apelacji");
    expect(idx).toContain("Styl pism");
    const list = store.listMemories("case-1");
    expect(list.length).toBe(2);
  });

  it("scope izolowany: personal != case-1", () => {
    store.saveMemory({
      scope: "personal",
      slug: "x",
      type: "notatka",
      title: "Osobista",
      body: "tylko personal",
    });
    expect(store.listMemories("personal").length).toBe(1);
    expect(store.listMemories("case-1").length).toBe(2);
  });

  it("sanitizeSegment: traversal i smieci -> bezpieczny slug", () => {
    expect(store.sanitizeSegment("../../etc/passwd", "x")).not.toContain("..");
    expect(store.sanitizeSegment("../../etc/passwd", "x")).not.toContain("/");
    expect(store.sanitizeSegment("Sprawa Kowalski!!!", "x")).toBe(
      "sprawa-kowalski",
    );
    expect(store.sanitizeSegment("", "fallback")).toBe("fallback");
  });

  it("forgetScope usuwa caly brain sprawy (RODO art. 17)", () => {
    store.saveMemory({
      scope: "case-del",
      slug: "a",
      type: "notatka",
      title: "A",
      body: "b",
    });
    expect(store.listMemories("case-del").length).toBe(1);
    expect(store.forgetScope("case-del")).toBe(true);
    expect(store.listMemories("case-del").length).toBe(0);
  });
});

describe("narzedzia remember/recall (dispatch)", () => {
  it("remember zapisuje, recall odczytuje (scope = projectId)", async () => {
    // Sciezka inline: karty zatwierdzen (ADR-0137) sa domyslnie wlaczone od
    // 2026-10-06, wiec ten test jawnie je wylacza (bramke testuje
    // tool-dispatch-gate-scope.test.ts).
    const prevApproval = process.env.PATRON_MUTATION_APPROVAL;
    process.env.PATRON_MUTATION_APPROVAL = "false";
    onTestFinished(() => {
      if (prevApproval === undefined) delete process.env.PATRON_MUTATION_APPROVAL;
      else process.env.PATRON_MUTATION_APPROVAL = prevApproval;
    });
    const { runToolCalls } = await import("../chat/tool-dispatch");
    // remember/recall nie dotykaja db - stub wystarczy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stubDb = {} as any;
    const save = await runToolCalls(
      [
        {
          id: "r1",
          function: {
            name: "remember",
            arguments: JSON.stringify({
              type: "fakt-sprawy",
              title: "Wartosc przedmiotu sporu",
              body: "WPS wynosi 50000 zl.",
              slug: "wps",
            }),
          },
        },
      ],
      new Map(),
      "u1",
      stubDb,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      "case-disp",
    );
    const saved = JSON.parse(
      (save.toolResults[0] as { content: string }).content,
    );
    expect(saved.ok).toBe(true);
    expect(saved.scope).toBe("case-disp");

    const recall = await runToolCalls(
      [
        {
          id: "r2",
          function: { name: "recall", arguments: JSON.stringify({}) },
        },
      ],
      new Map(),
      "u1",
      stubDb,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      "case-disp",
    );
    const recalled = JSON.parse(
      (recall.toolResults[0] as { content: string }).content,
    );
    expect(recalled.memories.length).toBe(1);
    expect(recalled.memories[0].title).toBe("Wartosc przedmiotu sporu");
  });
});

// Audyt 2026-09 B-05: pamiec osobista kluczowana uzytkownikiem.
describe("personalScope (B-05)", () => {
  it("UUID -> czytelny segment personal-<uuid>", () => {
    expect(store.personalScope("4f6c1a2e-0000-4000-8000-000000000001")).toBe(
      "personal-4f6c1a2e-0000-4000-8000-000000000001",
    );
  });

  it("rozni uzytkownicy -> rozne zakresy, rozne od historycznego 'personal'", () => {
    const a = store.personalScope("uzytkownik-a");
    const b = store.personalScope("uzytkownik-b");
    expect(a).not.toBe(b);
    expect(a).not.toBe(store.LEGACY_PERSONAL_SCOPE);
  });

  it("identyfikatory zlewajace sie po sanityzacji (wielkosc liter, znaki) -> rozne zakresy", () => {
    expect(store.personalScope("User@A")).not.toBe(store.personalScope("user-a"));
    expect(store.personalScope("ABC")).not.toBe(store.personalScope("abc"));
  });

  it("segment sciezki bezpieczny (bez wyjscia z katalogu) i zapis/odczyt dziala", () => {
    const scope = store.personalScope("../.." + "/etc");
    expect(scope).toMatch(/^personal-[a-z0-9_-]+$/);
    store.saveMemory({ scope, slug: "x", type: "notatka", title: "T", body: "B" });
    expect(store.readMemory(scope, "x")?.body).toBe("B");
  });
});
