#!/usr/bin/env tsx
// Przebieg bojowy CZTERECH powierzchni demo (nie tylko czatu): tabular review,
// workflows, generowanie dokumentu (tool generate_docx) i draft/refine - na
// zywym backendzie w trybie sqlite, z prawdziwym modelem (wymaga klucza w env,
// domyslnie GEMINI). Kazda powierzchnia dostaje REALNE zadanie i werdykt
// trojstanowy: ok / degraded / failed z pelnym mianownikiem.
//
//   npm run smoke:surfaces                  # model z PATRON_SMOKE_MODEL albo gemini-3-flash-preview
//   PATRON_SMOKE_MODEL=... npm run smoke:surfaces
//
// Powod istnienia: 2026-08-18 klient korporacyjny poprosil o demo "calej platformy" (tabular,
// workflows, generowanie dokumentow), a przebieg bojowy z 08-17 objal tylko
// czat + konektory. Bramka jednostkowa (vitest) uzywa fake-LLM, wiec nie
// odpowiada na pytanie "czy to dziala z prawdziwym modelem na prawdziwym pliku".

import { spawn, spawnSync } from "child_process";
import net from "net";
import { Document, Packer, Paragraph } from "docx";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const PORT = 3097;
const BASE = `http://localhost:${PORT}`;
const MODEL = process.env.PATRON_SMOKE_MODEL?.trim() || "gemini-3-flash-preview";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patron-surfaces-"));
const dbPath = path.join(tmp, "patron.db");
const storeDir = path.join(tmp, "sprawy");

type Verdict = "ok" | "degraded" | "failed";
const results: { surface: string; verdict: Verdict; detail: string }[] = [];
function report(surface: string, verdict: Verdict, detail: string) {
  results.push({ surface, verdict, detail });
  const mark = verdict === "ok" ? "ok      " : verdict === "degraded" ? "DEGRADED" : "FAILED  ";
  console.log(`  ${mark} ${surface}: ${detail}`);
}

async function makeDocx(paras: string[]): Promise<Buffer> {
  return Packer.toBuffer(
    new Document({ sections: [{ children: paras.map((t) => new Paragraph(t)) }] }),
  );
}
async function upload(name: string, buf: Buffer): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([buf]), name);
  const r = await fetch(`${BASE}/single-documents`, { method: "POST", body: form });
  if (r.status !== 201) throw new Error(`upload ${name} -> ${r.status}`);
  const b = (await r.json()) as { id: string; status: string };
  return b.id;
}
async function waitIndexed(docId: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    try {
      const db = new Database(dbPath, { readonly: true });
      const c = (db.prepare("select count(*) c from doc_chunks where document_id=?").get(docId) as { c: number }).c;
      db.close();
      if (c > 0) return true;
    } catch { /* busy */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
/** Czyta SSE do [DONE], zwraca surowe zdarzenia. */
async function readSse(res: Response, maxMs = 240_000): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return events;
        try { events.push(JSON.parse(payload)); } catch { /* ignore */ }
      }
    }
  }
  return events;
}
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port }, () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}
function killTree(pid: number | undefined, kill: () => void) {
  if (process.platform === "win32" && pid) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else kill();
}

// Realistyczne fixtury: dwie umowy najmu (fikcyjne strony).
const LEASE_A = [
  "UMOWA NAJMU LOKALU UZYTKOWEGO nr 7/2026",
  "zawarta w Warszawie dnia 3 marca 2026 r. pomiedzy Galeria Polnoc sp. z o.o. z siedziba w Warszawie (Wynajmujacy) a Acme Retail sp. z o.o. z siedziba w Krakowie (Najemca).",
  "§ 1. Przedmiotem najmu jest lokal nr 114 o powierzchni 86,5 m2 na parterze Galerii Polnoc.",
  "§ 2. Umowa zostaje zawarta na czas oznaczony 5 lat, od dnia 1 kwietnia 2026 r. do dnia 31 marca 2031 r.",
  "§ 3. Czynsz miesieczny wynosi 24,50 EUR za m2. Oplata serwisowa wynosi 38,00 PLN za m2 miesiecznie. Oplata marketingowa wynosi 2,10 EUR za m2.",
  "§ 4. Zabezpieczeniem najmu jest gwarancja bankowa w wysokosci 45 000 EUR oraz oswiadczenie o poddaniu sie egzekucji w trybie art. 777 k.p.c. do kwoty 90 000 EUR.",
  "§ 5. Najemcy przysluguje okres bezczynszowy (rent free) 3 miesiace od dnia przekazania lokalu.",
];
const LEASE_B = [
  "UMOWA NAJMU POWIERZCHNI BIUROWEJ nr B-22/2026",
  "zawarta w Poznaniu dnia 12 maja 2026 r. pomiedzy Biurowiec Centrum S.A. (Wynajmujacy) a Doe Consulting sp. k. (Najemca).",
  "§ 1. Przedmiotem najmu jest powierzchnia biurowa 412 m2 na 6. pietrze budynku Centrum Tower, add on factor 5,5%.",
  "§ 2. Okres najmu: 7 lat od dnia 1 lipca 2026 r. Najemcy przysluguje opcja przedluzenia o 3 lata.",
  "§ 3. Czynsz: 15,90 EUR/m2/miesiac. Oplata eksploatacyjna: 22,00 PLN/m2/miesiac.",
  "§ 4. Zabezpieczenie: depozyt gotowkowy 3-miesieczny czynsz brutto. Fit-out contribution: 250 EUR/m2.",
];

async function main() {
  if (await portInUse(PORT)) { console.error(`FAIL: port ${PORT} zajety`); process.exit(1); }
  const server = spawn("npx", ["tsx", "src/index.ts"], {
    env: { ...process.env, PATRON_DB_BACKEND: "sqlite", PATRON_STORAGE: "fs", PATRON_DISABLE_VEC: "1",
      PATRON_DB_PATH: dbPath, PATRON_STORAGE_DIR: storeDir, PORT: String(PORT),
      DOWNLOAD_SIGNING_SECRET: "smoke", USER_API_KEYS_ENCRYPTION_SECRET: "smoke" },
    stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32",
  });
  const log: string[] = [];
  const cap = (c: Buffer) => { log.push(c.toString()); if (log.length > 300) log.shift(); };
  server.stdout?.on("data", cap); server.stderr?.on("data", cap);

  try {
    // boot
    let up = false;
    for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* */ } if (!up) await new Promise((r) => setTimeout(r, 500)); }
    if (!up) { console.error(log.join("")); throw new Error("backend nie wstal"); }
    console.log(`Backend up (${MODEL})\n`);

    // dokumenty
    const idA = await upload("umowa-A.docx", await makeDocx(LEASE_A));
    const idB = await upload("umowa-B.docx", await makeDocx(LEASE_B));
    const ixA = await waitIndexed(idA), ixB = await waitIndexed(idB);
    report("upload+index 2 umow", ixA && ixB ? "ok" : "failed", `A=${ixA} B=${ixB}`);

    // ---------------- 1. TABULAR REVIEW ----------------
    const columns = [
      { index: 0, name: "Najemca", prompt: "Podaj pelna nazwe najemcy z komparycji." },
      { index: 1, name: "Powierzchnia (m2)", prompt: "Podaj powierzchnie przedmiotu najmu w m2 (sama liczba)." },
      { index: 2, name: "Czynsz", prompt: "Podaj stawke czynszu za m2 z waluta." },
      { index: 3, name: "Zabezpieczenie", prompt: "Wymien zabezpieczenia najmu (rodzaj i kwota)." },
    ];
    const cr = await fetch(`${BASE}/tabular-review`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Smoke: 2 umowy najmu", document_ids: [idA, idB], columns_config: columns }) });
    const crBody = (await cr.json()) as { id?: string; review?: { id: string } };
    const reviewId = crBody.id ?? crBody.review?.id;
    if (!reviewId) { report("tabular: create", "failed", `${cr.status} ${JSON.stringify(crBody).slice(0, 200)}`); }
    else {
      const t0 = Date.now();
      const gen = await fetch(`${BASE}/tabular-review/${reviewId}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL }) });
      const ev = await readSse(gen, 300_000);
      const errs = ev.filter((e) => e.type === "error");
      const rv = await fetch(`${BASE}/tabular-review/${reviewId}`);
      // Kontrakt komorki (parseCellContent): content = { summary, flag, reasoning, grounding }
      const rvBody = (await rv.json()) as { cells?: { document_id: string; column_index: number; content?: { summary?: string; flag?: string; grounding?: unknown } | null }[] };
      const cells = rvBody.cells ?? [];
      const txt = (c: { content?: { summary?: string } | null }) => (c.content?.summary ?? "").toString();
      const filled = cells.filter((c) => txt(c).trim().length > 0);
      const total = 2 * columns.length;
      // kontrola merytoryczna na 2 komorkach z jednoznaczna odpowiedzia
      const areaA = filled.find((c) => c.document_id === idA && c.column_index === 1);
      const areaB = filled.find((c) => c.document_id === idB && c.column_index === 1);
      const okA = /86[,.]5/.test(areaA ? txt(areaA) : "");
      const okB = /412/.test(areaB ? txt(areaB) : "");
      const flags = filled.map((c) => c.content?.flag ?? "-");
      const grounded = filled.filter((c) => c.content?.grounding).length;
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      const detail = `komorek ${filled.length}/${total} w ${secs}s, bledow SSE ${errs.length}, powierzchnia A=${okA ? "86,5 OK" : "BLAD"} B=${okB ? "412 OK" : "BLAD"}, flagi=[${flags.join(",")}], grounding ${grounded}/${filled.length}`;
      if (process.env.PATRON_SMOKE_DEBUG) for (const c of cells) console.log("     cell", c.document_id === idA ? "A" : "B", c.column_index, JSON.stringify(c.content).slice(0, 180));
      report("tabular: generate", filled.length === total && okA && okB && errs.length === 0 ? "ok" : filled.length > 0 ? "degraded" : "failed", detail);
      if (filled.length < total) console.log("    zdarzenia SSE:", [...new Set(ev.map((e) => e.type))].join(","));
    }

    // ---------------- 2. WORKFLOWS ----------------
    const wf = await fetch(`${BASE}/workflows`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Smoke: ekstrakcja najmu", type: "tabular", prompt_md: "Wyciagnij kluczowe dane z umowy najmu.", columns_config: columns }) });
    const wfBody = (await wf.json()) as { id?: string; workflow?: { id: string }; detail?: string };
    const wfId = wfBody.id ?? wfBody.workflow?.id;
    const wl = await fetch(`${BASE}/workflows`);
    const wlBody = (await wl.json()) as { workflows?: unknown[] } | unknown[];
    const listN = Array.isArray(wlBody) ? wlBody.length : (wlBody.workflows?.length ?? -1);
    report("workflows: create+list", wf.status < 300 && wfId && listN >= 1 ? "ok" : "failed", `create ${wf.status}${wfId ? "" : " (" + JSON.stringify(wfBody).slice(0, 120) + ")"}, lista=${listN}`);

    // ---------------- 3. GENEROWANIE DOKUMENTU (chat -> generate_docx) ----------------
    const chat = await fetch(`${BASE}/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content:
        "Wygeneruj plik DOCX: krotkie wezwanie do zaplaty czynszu (2 akapity) od Galeria Polnoc sp. z o.o. do Acme Retail sp. z o.o., kwota 12 300 EUR, termin 14 dni. Uzyj narzedzia do generowania dokumentu." }] }) });
    const cev = await readSse(chat, 240_000);
    const toolCalls = cev.filter((e) => e.type === "tool_call_start").map((e) => (e as { name?: string; tool?: string }).name ?? (e as { tool?: string }).tool);
    const dl = cev.map((e) => JSON.stringify(e)).join("\n").match(/https?:\/\/[^"\\\s]+\/download\/[^"\\\s]+/)?.[0]
      ?? cev.map((e) => JSON.stringify(e)).join("\n").match(/\/download\/[^"\\\s]+/)?.[0];
    let docOk = false, docBytes = 0;
    if (dl) {
      const url = dl.startsWith("http") ? dl : `${BASE}${dl}`;
      const d = await fetch(url); const ab = Buffer.from(await d.arrayBuffer()); docBytes = ab.length;
      docOk = d.ok && ab.length > 2000 && ab[0] === 0x50 && ab[1] === 0x4b; // PK = zip/docx
    }
    report("generowanie DOCX (chat tool)", docOk ? "ok" : toolCalls.some((t) => String(t).includes("docx")) ? "degraded" : "failed",
      `tool_calls=[${toolCalls.join(",")}] download=${dl ? "tak" : "brak"} bytes=${docBytes} PK=${docOk}`);

    // ---------------- 4. RESEARCH + GROUNDING CYTATOW MCP (ADR-0146) ----------------
    // Pytanie o orzecznictwo (konektor SAOS) z JAWNA prosba o doslowny cytat - to jest
    // scenariusz, ktory 2026-08-17 dal blockquote nieistniejacy w zrodle przy milczacym UI.
    // Bramka pilnuje, ze werdykt DOCHODZI: event mcp_grounding + zrodla + werdykt per karta.
    const res = await fetch(`${BASE}/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content:
        "Znajdz orzeczenie Sadu Najwyzszego o klauzulach niedozwolonych w umowie kredytu (spread walutowy) " +
        "i zacytuj DOSLOWNIE jedno zdanie z uzasadnienia. Podaj sygnature." }] }) });
    const rev = await readSse(res, 240_000);
    const rTools = rev.filter((e) => e.type === "tool_call_start").map((e) => String((e as { name?: string }).name ?? ""));
    const mcpCit = rev.find((e) => e.type === "mcp_citations") as { citations?: unknown[] } | undefined;
    const gr = rev.find((e) => e.type === "mcp_grounding") as
      | { error?: string; summary?: { quotes: number; green: number; yellow: number; red: number; sources: number; cards: number }; perCitation?: Record<string, { verdict: string; reason: string }> }
      | undefined;
    const cards = Object.values(gr?.perCitation ?? {});
    const verdicts = cards.map((c) => c.verdict);
    const allHaveVerdict = cards.length > 0 && verdicts.every((v) => ["green", "yellow", "red"].includes(v));
    const detail = gr
      ? gr.error
        ? `event przyszedl z error=${gr.error} (UI pokazuje "niesprawdzone")`
        : `zrodla ${gr.summary?.sources}, kart ${gr.summary?.cards}, cytatow ${gr.summary?.quotes} ` +
          `(green ${gr.summary?.green} / yellow ${gr.summary?.yellow} / red ${gr.summary?.red}), ` +
          `werdykty kart [${verdicts.join(",")}], powody [${cards.map((c) => c.reason).join(",")}]`
      : `BRAK eventu mcp_grounding (tool_calls=[${rTools.join(",")}], mcp_citations=${mcpCit?.citations?.length ?? 0})`;
    report("research + grounding cytatow MCP (ADR-0146)",
      gr && !gr.error && allHaveVerdict ? "ok" : gr ? "degraded" : "failed", detail);
    if (process.env.PATRON_SMOKE_DEBUG && gr && !gr.error) {
      for (const q of ((gr as { quotes?: { verdict: string; status?: string; quote?: string }[] }).quotes ?? []).slice(0, 4)) {
        console.log(`     quote [${q.verdict}/${q.status}] ${String(q.quote ?? "").slice(0, 110)}`);
      }
    }

    // ---------------- 5. DRAFT/REFINE ----------------
    // draft/refine = pipeline obronny draftu (DefenseResult { final, stages }), NIE "wykonaj polecenie".
    // Kontrola: 200, final niepusty, fakty zachowane (kwota 45 000 EUR, lokal 114, art. 777).
    const rf = await fetch(`${BASE}/draft/refine`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, text: LEASE_A.join("\n"), document_type: "umowa" }) });
    const rfBody = (await rf.json().catch(() => ({}))) as { final?: string; stages?: unknown[]; detail?: string };
    const fin = rfBody.final ?? "";
    const factsKept = /45[\s ]?000/.test(fin) && /114/.test(fin) && /777/.test(fin);
    report("draft/refine (pipeline obronny)", rf.ok && fin.trim() ? (factsKept ? "ok" : "degraded") : "failed",
      `${rf.status}, final ${fin.length} zn., etapow ${rfBody.stages?.length ?? 0}, fakty zachowane (45 000 EUR / lokal 114 / art. 777)=${factsKept}${rf.ok ? "" : " " + String(rfBody.detail).slice(0, 160)}`);
  } catch (e) {
    console.error("SURFACES SMOKE THREW:", e);
    console.error(log.slice(-40).join(""));
    process.exitCode = 1;
  } finally {
    killTree(server.pid, () => server.kill());
    const failed = results.filter((r) => r.verdict === "failed").length;
    const degraded = results.filter((r) => r.verdict === "degraded").length;
    console.log(`\nSURFACES: ${results.length} powierzchni, ok=${results.length - failed - degraded}, degraded=${degraded}, failed=${failed}`);
    if (failed) process.exitCode = 1;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  }
}
main();
