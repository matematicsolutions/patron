// R-TI-01: bramka egress-surface-parity.test.ts (src/lib/routing/) deklaruje, ze
// "nowa powierzchnia dodana bez straznika zapala test" (naglowek, l. 6-9; REJESTR
// l. 63-70). Mechanizm liczy jednak TEKSTOWO, per PLIK: (a) referencje do funkcji
// egress z lib/llm (nie do wewnetrznych wrapperow), (b) wystapienia
// `enforceEgressGuard(` i `appendLlmRouteEvent(` - takze w komentarzach (policz-
// Straznikow l. 196-198), (c) importy wylacznie w ksztalcie `import { ... } from`
// (IMPORT_RE l. 158). Sonda: kopia backend/src w katalogu tymczasowym, mutacja
// WYLACZNIE kopii, uruchomienie TEJ SAMEJ bramki na kopii. Oczekiwane: kazda z
// mutacji (nowa niestrzezona sciezka egressu) zapala bramke (exit != 0).
// Kod produkcyjny nie jest modyfikowany.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BACKEND = path.resolve(__dirname, "..");
const TEST_REL = "src/lib/routing/egress-surface-parity.test.ts";
let tmp = "";

function kopia(): string {
    const dir = fs.mkdtempSync(path.join(tmp, "src-"));
    fs.cpSync(path.join(BACKEND, "src"), path.join(dir, "src"), { recursive: true });
    for (const f of ["package.json", "tsconfig.json", "vitest.config.ts"])
        fs.copyFileSync(path.join(BACKEND, f), path.join(dir, f));
    fs.symlinkSync(path.join(BACKEND, "node_modules"), path.join(dir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    return dir;
}

/** exit code bramki parytetu uruchomionej na kopii (0 = zielona). */
function bramka(dir: string): number {
    try {
        execFileSync("npx", ["vitest", "run", TEST_REL], { cwd: dir, stdio: "pipe", timeout: 120_000, shell: process.platform === "win32" });
        return 0;
    } catch (e) {
        return (e as { status?: number }).status ?? 1;
    }
}

beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r-ti-01-"));
});
afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("R-TI-01 egress-surface-parity przepuszcza niestrzezony egress", () => {
    it("kontrola: niezmieniona kopia -> bramka zielona", () => {
        expect(bramka(kopia())).toBe(0);
    }, 180_000);

    it("kontrola pozytywna: nowe bezposrednie completeText bez straznika -> bramka czerwona", () => {
        const dir = kopia();
        fs.appendFileSync(
            path.join(dir, "src/routes/tabular.ts"),
            `\ntabularRouter.post("/prompt-v2", requireAuth, async (req, res) => {\n` +
                `    const { title_model, api_keys } = await getUserModelSettings(res.locals.userId as string);\n` +
                `    res.json({ raw: await completeText({ model: title_model, user: String(req.body.title), maxTokens: 64, apiKeys: api_keys }) });\n});\n`,
        );
        expect(bramka(dir)).not.toBe(0);
    }, 180_000);

    it("nowa trasa przez istniejacy wrapper queryTabularCell (pelna tresc dokumentu), bez straznika i audytu", () => {
        const dir = kopia();
        fs.appendFileSync(
            path.join(dir, "src/routes/tabular.ts"),
            `\ntabularRouter.post("/:reviewId/quick-cell", requireAuth, async (req, res) => {\n` +
                `    const { tabular_model, api_keys } = await getUserModelSettings(res.locals.userId as string);\n` +
                `    res.json(await queryTabularCell(tabular_model, "akta.pdf", String(req.body.text), String(req.body.prompt), "text", [], api_keys));\n});\n`,
        );
        expect(bramka(dir), "bramka zielona mimo nowej powierzchni egressu bez straznika").not.toBe(0);
    }, 180_000);

    it("straznik regenerate-cell zakomentowany (wywolanie w komentarzu dalej liczy sie jako straznik)", () => {
        const dir = kopia();
        const p = path.join(dir, "src/routes/tabular.ts");
        const src = fs.readFileSync(p, "utf8");
        const stary =
            "        const guard = await enforceEgressGuard({\n" +
            "            db,\n" +
            "            model: tabular_model,\n" +
            "            projectId: tabularProjectId,\n" +
            "            actorUserId: userId,\n" +
            "        });\n" +
            "        if (!guard.allowed) {";
        expect(src.split(stary).length - 1).toBe(1); // warunek sondy: jedno trafienie
        const nowy =
            "        // TODO przywrocic: const guard = await enforceEgressGuard({ db, model: tabular_model, projectId: tabularProjectId, actorUserId: userId });\n" +
            "        const guard = { allowed: true, provider: \"x\", decision: { egress: \"cloud\", classification: \"internal\", reason: \"\" } } as any;\n" +
            "        if (!guard.allowed) {";
        fs.writeFileSync(p, src.replace(stary, nowy));
        expect(bramka(dir), "bramka zielona mimo zdjetego straznika").not.toBe(0);
    }, 180_000);

    it("nowy plik importujacy warstwe LLM przez namespace (import * as llm)", () => {
        const dir = kopia();
        fs.writeFileSync(
            path.join(dir, "src/routes/summarize.ts"),
            `import * as llm from "../lib/llm";\n` +
                `export async function summarize(text: string) {\n` +
                `    return llm.completeText({ model: "gemini-3-flash-preview", user: text, maxTokens: 256 });\n}\n`,
        );
        expect(bramka(dir), "bramka zielona mimo nowej powierzchni (namespace import)").not.toBe(0);
    }, 180_000);
});
