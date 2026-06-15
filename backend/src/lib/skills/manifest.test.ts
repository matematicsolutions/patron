import { describe, it, expect } from "vitest";
import {
  validateManifest,
  manifestToEntry,
  BUILTIN_SKILLS,
  BUILTIN_IDS,
  MANIFEST_VERSION,
} from "./manifest";

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifest_version: MANIFEST_VERSION,
    id: "streszczenie-pisma",
    name: "Streszczenie pisma",
    description: "Skraca pismo do tezy.",
    version: "1.0.0",
    surface: "draft-stage",
    prompt: { system: "Jestes redaktorem.", user: "Streszcz:" },
    ...over,
  };
}

describe("validateManifest (ADR-0094)", () => {
  it("akceptuje poprawny manifest i domyslnie ustawia no-egress + local-file", () => {
    const r = validateManifest(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.egress).toBe("no-egress");
      expect(r.manifest.source).toBe("local-file");
      expect(r.manifest.signature).toBeNull();
    }
  });

  it("odrzuca zla wersje manifestu", () => {
    const r = validateManifest(base({ manifest_version: 99 }));
    expect(r.ok).toBe(false);
  });

  it("wymaga id w kebab-case", () => {
    expect(validateManifest(base({ id: "Zle ID" })).ok).toBe(false);
    expect(validateManifest(base({ id: "dobre-id-2" })).ok).toBe(true);
  });

  it("wymaga semver w version", () => {
    expect(validateManifest(base({ version: "1.0" })).ok).toBe(false);
  });

  it("odrzuca nieznana powierzchnie (surface)", () => {
    expect(validateManifest(base({ surface: "nieznana" })).ok).toBe(false);
  });

  it("wymaga prompt.system i prompt.user jako tekstu", () => {
    expect(validateManifest(base({ prompt: { system: "x" } })).ok).toBe(false);
    expect(validateManifest(base({ prompt: "tekst" })).ok).toBe(false);
  });

  it("egress domyslnie no-egress, ale cloud-allowed jest dozwolony jawnie", () => {
    const r = validateManifest(base({ egress: "cloud-allowed" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.egress).toBe("cloud-allowed");
    expect(validateManifest(base({ egress: "internet" })).ok).toBe(false);
  });

  it("odrzuca prompt przekraczajacy limit znakow", () => {
    const big = "a".repeat(20_001);
    expect(validateManifest(base({ prompt: { system: big, user: "x" } })).ok).toBe(
      false,
    );
  });

  it("manifestToEntry oznacza signed wg obecnosci podpisu", () => {
    const r = validateManifest(base({ signature: "deadbeef" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const entry = manifestToEntry(r.manifest, true);
      expect(entry.signed).toBe(true);
      expect(entry.builtin).toBe(false);
      expect(entry.enabled).toBe(true);
    }
  });
});

describe("BUILTIN_SKILLS", () => {
  it("zawiera 3 etapy obrony jako wbudowane, wlaczone, read-only", () => {
    expect(BUILTIN_SKILLS).toHaveLength(3);
    for (const s of BUILTIN_SKILLS) {
      expect(s.builtin).toBe(true);
      expect(s.enabled).toBe(true);
      expect(s.source).toBe("builtin");
      expect(s.surface).toBe("draft-stage");
    }
    expect([...BUILTIN_IDS].sort()).toEqual(["adwokat", "pisz-po-ludzku", "recenzent"]);
  });
});
