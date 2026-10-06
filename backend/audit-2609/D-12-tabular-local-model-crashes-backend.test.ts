// D-12: Tabular review z modelem LOKALNYM (Ollama, np. "Bielik 11B (lokalny)" z listy
// MODELS w frontend/src/app/components/assistant/ModelToggle.tsx:34-38, wybieralny jako
// model tabular przez ModelToggle w TRChatPanel (TRChatPanel.tsx:1487-1494 ->
// updateModelPreference("tabularModel"); backend routes/user.ts:90-99 akceptuje ollama/*).
// UWAGA weryfikatora: /account/models NIE oferuje grupy "Lokalny" (page.tsx:143-147),
// wiec tam wyboru nie ma - jedyna sciezka UI to TRChatPanel) wywraca proces backendu.
// routes/tabular.ts:71-79 missingModelApiKey wola providerForModel(model), ktory dla
// "ollama/*" RZUCA "Unknown model id" (lib/llm/models.ts:81-90 - ollama celowo nie jest
// w unii Provider). Wywolania w generate (:1004), regenerate-cell (:835) i czacie
// przegladu (:1451) sa w async handlerach Express 4 bez try/catch -> odrzucona obietnica
// bez obslugi; backend nie rejestruje handlera unhandledRejection (backend/src/index.ts),
// wiec Node (>=15) konczy proces. Desktop nie restartuje backendu
// (desktop/main.js:423-440 - tylko log "exit"). Skutek: sprawa objeta tajemnica
// (domyslnie wolno ja przetwarzac tylko lokalnie) nie ma dzialajacego tabular review,
// a klikniecie "Generuj" zabija cala aplikacje do restartu.
// Oczekiwane: generate z modelem lokalnym odpowiada (strumien/blad HTTP) i backend zyje.
import { pathToFileURL } from "node:url";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { createRequire } from "module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "patron-d12-"));
const src = path.resolve(__dirname, "../src");
const script = path.join(work, "server.ts");
const expressPath = createRequire(path.join(src, "index.ts")).resolve("express");
fs.writeFileSync(
    script,
    `(async () => {
process.env.PATRON_DB_BACKEND = "sqlite";
process.env.PATRON_DISABLE_VEC = "1";
process.env.PATRON_DB_PATH = ${JSON.stringify(path.join(work, "p.db"))};
process.env.PATRON_STORAGE = "fs";
process.env.PATRON_STORAGE_DIR = ${JSON.stringify(path.join(work, "store"))};
const express = (await import(${JSON.stringify(pathToFileURL(expressPath).href)})).default;
const { tabularRouter } = await import(${JSON.stringify(pathToFileURL(path.join(src, "routes/tabular.ts")).href)});
const { createServerSupabase } = await import(${JSON.stringify(pathToFileURL(path.join(src, "lib/supabase.ts")).href)});
const { LOCAL_USER_ID } = await import(${JSON.stringify(pathToFileURL(path.join(src, "lib/db/supabase-shim.ts")).href)});
const db: any = createServerSupabase();
// Uzytkownik wybral lokalny model dla tabular (id z frontendowej listy MODELS).
await db.from("user_profiles").update({ tabular_model: "ollama/SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M" }).eq("user_id", LOCAL_USER_ID);
const docId = (await db.from("documents").insert({ user_id: LOCAL_USER_ID, filename: "umowa.docx", file_type: "docx", status: "ready" }).select("id").single()).data.id;
const reviewId = (await db.from("tabular_reviews").insert({ user_id: LOCAL_USER_ID, title: "Kary", columns_config: [{ index: 0, name: "Kara", prompt: "Jaka kara?" }], document_ids: [docId] }).select("id").single()).data.id;
await db.from("tabular_cells").insert({ review_id: reviewId, document_id: docId, column_index: 0, status: "pending" });
const app = express();
app.use(express.json());
app.use("/tabular-review", tabularRouter);
app.get("/ping", (_req: any, res: any) => res.json({ ok: true }));
const server = app.listen(0, "127.0.0.1", () => {
    console.log("READY " + JSON.stringify({ port: (server.address() as any).port, reviewId }));
});
})();
`,
);

let child: ChildProcess;
let port = 0;
let reviewId = "";
let exitCode: number | null = null;
let stderr = "";

beforeAll(async () => {
    child = spawn(process.execPath, [path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs"), script], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("exit", (c) => { exitCode = c ?? -1; });
    child.stderr!.on("data", (d) => { stderr += String(d); });
    await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("serwer nie wystartowal: " + stderr)), 30_000);
        child.stdout!.on("data", (d) => {
            const m = String(d).match(/READY (\{.*\})/);
            if (m) {
                const info = JSON.parse(m[1]!);
                port = info.port;
                reviewId = info.reviewId;
                clearTimeout(t);
                resolve();
            }
        });
    });
}, 40_000);

afterAll(async () => {
    // tsx uruchamia skrypt w procesie-wnuku; na Windows SIGKILL rodzica go nie zabija,
    // a wnuk trzyma plik bazy. Zabijamy cale drzewo i czekamy na wyjscie.
    if (child && exitCode === null) {
        const wyszedl = new Promise((r) => child!.once("exit", r));
        if (process.platform === "win32" && child.pid)
            spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        else
            try { child.kill("SIGKILL"); } catch { /* ignore */ }
        await wyszedl;
    }
    // Sprzatanie katalogu tymczasowego nie jest czescia asercji - best-effort.
    try {
        fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (e) {
        console.warn(`[D-12] nie udalo sie usunac ${work}: ${String(e)}`);
    }
});

describe("D-12 tabular review z modelem lokalnym", () => {
    it("generate odpowiada, a backend pozostaje przy zyciu", async () => {
        let status: number | string = "brak odpowiedzi";
        try {
            const r = await fetch(`http://127.0.0.1:${port}/tabular-review/${reviewId}/generate`, {
                method: "POST",
                signal: AbortSignal.timeout(8_000),
            });
            status = r.status;
            await r.text();
        } catch (e) {
            status = `blad polaczenia: ${String(e)}`;
        }
        await new Promise((r) => setTimeout(r, 500));
        let alive = false;
        try {
            alive = (await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(2_000) })).ok;
        } catch { alive = false; }
        const msg = `generate=${status} backend_exit=${exitCode} stderr=${stderr.split("\n").filter((l) => /Error|Unknown/.test(l)).slice(0, 3).join(" | ")}`;
        expect(alive, msg).toBe(true);
        expect(typeof status, msg).toBe("number");
    }, 20_000);
});
