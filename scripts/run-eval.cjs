#!/usr/bin/env node
// Eval jedna komenda (spec 010, A2-4) - bramka flipu flag (tracker B2/B3).
//
//   node scripts/run-eval.cjs
//
// Trzy etapy, jeden raport (eval-report/eval-report.{md,json}):
//   A. deterministyczne evale retrieval (vitest *.eval.test.ts) - ZAWSZE
//   B. grounding LEDGAR (legal-eval-harness, python + skill) - jesli dostepne
//   C. sedzia PL (backend/scripts/eval-judge-pl.ts, Ollama local-only) - jesli dostepne
//
// Etap niedostepny = SKIPPED z powodem (w CI B/C zawsze SKIPPED - brak skilla
// i Ollamy na runnerze; pelny raport powstaje lokalnie ta sama komenda).
// Exit 0 = zaden WYKONANY etap nie zawiodl; exit 1 = FAIL wykonanego etapu
// albo Etap A nie mogl ruszyc.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const OUT_DIR = path.join(ROOT, "eval-report");
const HARNESS =
    process.env.PATRON_EVAL_HARNESS_DIR ||
    [
        "C:/Users/Wieslaw/Projects/legal-eval-harness",
        path.join(ROOT, "..", "legal-eval-harness"),
    ].find((p) => fs.existsSync(p)) ||
    "";

const stages = [];

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {
        cwd: opts.cwd ?? ROOT,
        encoding: "utf8",
        shell: process.platform === "win32",
        timeout: opts.timeoutMs ?? 30 * 60 * 1000,
        env: { ...process.env, ...(opts.env ?? {}) },
        maxBuffer: 64 * 1024 * 1024,
    });
    return {
        status: r.status,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
        error: r.error?.message,
    };
}

function record(name, status, summary, log) {
    stages.push({ name, status, summary, log: (log ?? "").slice(-8000) });
    console.log(`[eval] ${name}: ${status} - ${summary}`);
}

// ── Etap A: deterministyczne evale retrieval (vitest) ──────────────────────
function stageA() {
    console.log("[eval] Etap A: vitest *.eval.test.ts (dual-similarity, event-KG)...");
    const r = run("npx", ["vitest", "run", "eval.test", "--reporter=default"], {
        cwd: BACKEND,
    });
    const out = r.stdout + r.stderr;
    const testsLine = out.match(/Tests\s+([^\n]+)/)?.[1]?.trim() ?? "";
    const filesLine = out.match(/Test Files\s+([^\n]+)/)?.[1]?.trim() ?? "";
    // Metryki nDCG wypisywane przez evale na stdout - zbierz do raportu
    const metricLines = out
        .split("\n")
        .filter((l) => /nDCG|ndcg|recall@|MRR/i.test(l))
        .slice(0, 40)
        .join("\n");
    if (r.status === 0 && /passed/.test(testsLine)) {
        record("A-retrieval-eval", "PASS", `${filesLine} | ${testsLine}`, metricLines || out);
        return true;
    }
    record(
        "A-retrieval-eval",
        "FAIL",
        r.error ?? testsLine ?? `vitest exit ${r.status}`,
        out,
    );
    return false;
}

// ── Etap B: grounding LEDGAR (legal-eval-harness) ───────────────────────────
function stageB() {
    if (!HARNESS || !fs.existsSync(HARNESS)) {
        record(
            "B-grounding-ledgar",
            "SKIPPED",
            "brak legal-eval-harness (ustaw PATRON_EVAL_HARNESS_DIR)",
        );
        return null;
    }
    const py = run("python", ["--version"]);
    if (py.status !== 0) {
        record("B-grounding-ledgar", "SKIPPED", "brak pythona w PATH");
        return null;
    }
    const skill = path.join(
        require("node:os").homedir(),
        ".claude",
        "skills",
        "citation-grounding-pl",
        "scripts",
        "ground-citations.mjs",
    );
    if (!fs.existsSync(skill)) {
        record(
            "B-grounding-ledgar",
            "SKIPPED",
            "brak skilla citation-grounding-pl (harness testuje realny skrypt skilla)",
        );
        return null;
    }
    const cases = path.join(HARNESS, "seeds", "grounding_cases.json");
    if (!fs.existsSync(cases)) {
        console.log("[eval] Etap B: brak seeds - fetch + build (HuggingFace)...");
        const f = run("python", ["fetch_seeds.py"], { cwd: HARNESS });
        const b = f.status === 0 ? run("python", ["build_grounding_eval.py"], { cwd: HARNESS }) : f;
        if (b.status !== 0) {
            record(
                "B-grounding-ledgar",
                "SKIPPED",
                "nie udalo sie zbudowac labeled set (offline?)",
                f.stdout + f.stderr + b.stdout + b.stderr,
            );
            return null;
        }
    }
    console.log("[eval] Etap B: run_grounding_eval.py (LEDGAR)...");
    const r = run("python", ["run_grounding_eval.py"], { cwd: HARNESS });
    const out = r.stdout + r.stderr;
    const acc = out.match(/Accuracy:\s*([^\n]+)/)?.[1]?.trim();
    if (r.status === 0 && acc) {
        record("B-grounding-ledgar", "PASS", `accuracy ${acc}`, out);
        return true;
    }
    record("B-grounding-ledgar", "FAIL", r.error ?? `exit ${r.status}`, out);
    return false;
}

// ── Etap C: sedzia PL (Ollama local-only, ADR-0097/0103) ───────────────────
function ollamaUp() {
    return new Promise((resolve) => {
        const req = http.get(
            { host: "127.0.0.1", port: 11434, path: "/api/tags", timeout: 1500 },
            (res) => {
                res.resume();
                resolve(res.statusCode === 200);
            },
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function stageC() {
    if ((process.env.PATRON_EVAL_JUDGE ?? "").toLowerCase() === "off") {
        record("C-judge-pl", "SKIPPED", "PATRON_EVAL_JUDGE=off");
        return null;
    }
    const corpus = HARNESS && path.join(HARNESS, "judge-pl", "corpus-pl.json");
    if (!corpus || !fs.existsSync(corpus)) {
        record("C-judge-pl", "SKIPPED", "brak korpusu judge-pl/corpus-pl.json");
        return null;
    }
    if (!(await ollamaUp())) {
        record("C-judge-pl", "SKIPPED", "Ollama (127.0.0.1:11434) niedostepna - sedzia jest local-only");
        return null;
    }
    console.log("[eval] Etap C: eval-judge-pl.ts (Ollama, moze potrwac)...");
    const r = run("npx", ["tsx", "scripts/eval-judge-pl.ts", corpus], {
        cwd: BACKEND,
        timeoutMs: 60 * 60 * 1000,
    });
    const out = r.stdout + r.stderr;
    const summary =
        out
            .split("\n")
            .filter((l) => /accuracy|Accuracy|werdykt|recall/i.test(l))
            .slice(0, 10)
            .join(" | ") || `exit ${r.status}`;
    if (r.status === 0) {
        record("C-judge-pl", "PASS", summary, out);
        return true;
    }
    record("C-judge-pl", "FAIL", r.error ?? summary, out);
    return false;
}

// ── Raport ──────────────────────────────────────────────────────────────────
function gitCommit() {
    const r = run("git", ["rev-parse", "--short", "HEAD"]);
    return r.status === 0 ? r.stdout.trim() : "unknown";
}

async function main() {
    const startedAt = new Date().toISOString();
    const a = stageA();
    const b = stageB();
    const c = await stageC();

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const commit = gitCommit();
    const executed = stages.filter((s) => s.status !== "SKIPPED");
    const failed = executed.filter((s) => s.status === "FAIL");
    const verdict = a === false || failed.length > 0 ? "FAIL" : "PASS";

    const json = {
        startedAt,
        finishedAt: new Date().toISOString(),
        commit,
        verdict,
        stages,
    };
    fs.writeFileSync(
        path.join(OUT_DIR, "eval-report.json"),
        JSON.stringify(json, null, 2),
        "utf8",
    );

    const md = [
        "# PATRON eval report (bramka flipu flag, spec 010)",
        "",
        `- Commit: \`${commit}\``,
        `- Start: ${startedAt}`,
        `- Werdykt: **${verdict}** (${executed.length} etapow wykonanych, ${stages.length - executed.length} pominietych)`,
        "",
        "| Etap | Status | Podsumowanie |",
        "|---|---|---|",
        ...stages.map((s) => `| ${s.name} | ${s.status} | ${s.summary.replace(/\|/g, "/").replace(/\n/g, " ")} |`),
        "",
        "## Logi (ogon)",
        ...stages.flatMap((s) => [
            "",
            `### ${s.name} (${s.status})`,
            "```",
            s.log || "(brak)",
            "```",
        ]),
        "",
        "> Flip flag pozostaje decyzja WM (bramka B3) - ten raport jest wejsciem, nie wyrokiem.",
    ].join("\n");
    fs.writeFileSync(path.join(OUT_DIR, "eval-report.md"), md, "utf8");

    console.log(`\n[eval] Werdykt: ${verdict}`);
    console.log(`[eval] Raport: ${path.join(OUT_DIR, "eval-report.md")}`);
    process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((err) => {
    console.error("[eval] blad orkiestratora:", err);
    process.exit(1);
});
