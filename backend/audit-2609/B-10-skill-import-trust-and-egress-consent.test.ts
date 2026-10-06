// B-10: Import paczki skilla (wektor "tresc skilla") - dwie bramki zaufania sa
// deklaratywne, a nie egzekwowane:
//  (1) `signed` = `signature !== null` (lib/skills/manifest.ts:234, store.ts:143) -
//      DOWOLNY napis w polu signature (podpis nie jest weryfikowany; ADR-0094: podpis
//      = rezerwacja) daje signed=true: panel chowa etykiete "niepodpisane"
//      (SkillLibraryPanel.tsx:72) i do audit hash-chain trafia signed=true
//      (routes/draft.ts custom_skills), a publisher "MateMatic" jest deklaracja autora.
//  (2) importSkill ustawia enabled=true (store.ts:67-79) takze dla egress
//      "cloud-allowed", omijajac bramke jawnej zgody confirm_egress, ktora PATCH
//      wymaga przy wlaczaniu (routes/skills.ts:97-103).
// Oczekiwane: (1) niezweryfikowany podpis => signed=false; (2) skill cloud-allowed po
// imporcie nie jest aktywny w pipeline draftu bez jawnej zgody na egress.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "audit-b10-"));
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DB_PATH = path.join(TMP, "patron.db");

let db: any;
let store: typeof import("../src/lib/skills/store");
let manifest: typeof import("../src/lib/skills/manifest");

beforeAll(async () => {
    db = (await import("../src/lib/supabase")).createServerSupabase();
    store = await import("../src/lib/skills/store");
    manifest = await import("../src/lib/skills/manifest");
});
afterAll(async () => {
    (await import("../src/lib/db/sqlite-connection")).closeDb();
    fs.rmSync(TMP, { recursive: true, force: true });
});

function paczka(id: string, extra: Record<string, unknown>) {
    const v = manifest.validateManifest({
        manifest_version: 1,
        id,
        name: "Styl pism",
        version: "1.0.0",
        surface: "draft-stage",
        prompt: { system: "Popraw styl pisma procesowego.", user: "{{text}}" },
        ...extra,
    });
    if (!v.ok) throw new Error(v.error);
    return v.manifest;
}

describe("B-10 import skilla: podpis i zgoda na egress", () => {
    it("niezweryfikowany napis w polu signature nie daje statusu 'podpisany'", async () => {
        const m = paczka("styl-pism-falszywy-podpis", { signature: "nie-jest-to-podpis", publisher: "MateMatic" });
        await store.importSkill(db, m);
        const zaladowane = await store.loadEnabledDraftStageSkills(db);
        const s = zaladowane.find((x) => x.id === m.id)!;
        expect(store.toSkillAuditRecord(s).signed, "audyt zapisuje signed=true bez weryfikacji").toBe(false);
    });

    it("skill cloud-allowed nie jest aktywny po imporcie bez confirm_egress", async () => {
        const m = paczka("styl-pism-chmura", { egress: "cloud-allowed" });
        await store.importSkill(db, m);
        const aktywne = (await store.loadEnabledDraftStageSkills(db)).map((x) => x.id);
        expect(aktywne, "import wlaczyl skill z egress do chmury bez zgody").not.toContain(m.id);
    });
});
