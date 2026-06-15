// Runner OCR przez subprocess (ADR-0074). Produkcyjna implementacja `deps.ocr`
// dla convertToMarkdown. Lokalny silnik OCR uruchamiany jako proces zewnetrzny -
// omija blokade junction node_modules->~/patron (to nie npm dep).
//
// ENGINE-AGNOSTIC: silnik wybierany configiem env `PATRON_OCR_CMD`, zero zmian
// kodu przy zmianie silnika. Dwa tryby (wykrywane po placeholderach w szablonie):
//
//   stdout-mode  (tylko {input})  - silnik pisze tekst na stdout.
//     Tesseract:  "tesseract {input} stdout -l pol"
//   dir-mode     ({input} {outdir}) - silnik pisze pliki do katalogu, czytamy *.md.
//     Chandra:    "chandra {input} {outdir} --method hf"
//
// LICENCJA (do decyzji przy wyborze silnika - patrz ADR-0074):
//   - Tesseract / PaddleOCR / docTR: Apache 2.0 - czyste do bundla komercyjnego.
//   - Chandra (datalab-to): kod Apache 2.0, ale MODEL OpenRAIL-M (restrykcja
//     komercyjna + klauzula antykonkurencyjna wobec API Datalab) - RYZYKO dla
//     produktu komercyjnego sprzedawanego kancelariom. Patrz bramka licencji Konstytucji.
//
// Zero-cloud: silnik lokalny, model bundlowany (HF_HUB_OFFLINE), nie pobierany.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

/** Czy OCR jest skonfigurowany (env PATRON_OCR_CMD ustawiony). */
export function isOcrConfigured(): boolean {
    return !!process.env.PATRON_OCR_CMD?.trim();
}

/**
 * Pure: tokenizuje szablon komendy z poszanowaniem cudzyslowow. Segment w "..."
 * pozostaje JEDNYM tokenem (cudzyslowy zdejmowane) - krytyczne dla sciezki silnika
 * ze spacjami, np. `"C:\Program Files\Tesseract-OCR\tesseract.exe" {input} stdout`.
 * Reszta dzielona po bialych znakach. (Edge-case `--foo="a b"` bez spacji nie jest
 * wspierany - szablon dostarcza main.js/Operator, wiec cudzyslujemy cale tokeny.)
 */
function tokenizeTemplate(template: string): string[] {
    const tokens: string[] = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template.trim())) !== null) {
        tokens.push(m[1] !== undefined ? m[1] : m[2]!);
    }
    return tokens;
}

/**
 * Pure: rozkłada szablon komendy na argv, podstawiajac {input} i {outdir} jako
 * pojedyncze elementy (sciezki ze spacjami bezpieczne). Gdy brak {input} -
 * doklejamy sciezke wejscia na koniec. Testowalne bez procesu.
 */
export function buildOcrArgv(
    template: string,
    inputPath: string,
    outDir?: string,
): string[] {
    const tokens = tokenizeTemplate(template);
    const argv = tokens.map((t) => {
        if (t === "{input}") return inputPath;
        if (t === "{outdir}") return outDir ?? "";
        return t;
    });
    if (!tokens.includes("{input}")) argv.push(inputPath);
    return argv;
}

/** Czy szablon uzywa trybu katalogowego (silnik pisze pliki, np. Chandra). */
export function usesDirMode(template: string): boolean {
    return template.includes("{outdir}");
}

function tmpExt(kind: "image" | "pdf", filename: string): string {
    if (kind === "pdf") return ".pdf";
    return filename.includes(".")
        ? "." + filename.split(".").pop()!.toLowerCase()
        : ".png";
}

/** Rekurencyjnie zbiera tresc plikow .md z katalogu (output silnika dir-mode). */
function readMarkdownFromDir(dir: string): string {
    const parts: string[] = [];
    const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.name.toLowerCase().endsWith(".md"))
                parts.push(fs.readFileSync(p, "utf8"));
        }
    };
    walk(dir);
    return parts.join("\n\n");
}

function spawnCapture(argv: string[]): Promise<{ stdout: string; code: number; stderr: string }> {
    return new Promise((resolve, reject) => {
        const [cmd, ...args] = argv;
        const child = spawn(cmd!, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", (e) => reject(e));
        child.on("close", (code) => resolve({ stdout, code: code ?? -1, stderr }));
    });
}

/**
 * Produkcyjny `deps.ocr` dla convertToMarkdown. Zapisuje bufor do pliku
 * tymczasowego, uruchamia skonfigurowany silnik OCR, zwraca rozpoznany tekst/MD.
 * Tryb (stdout vs katalog) wg placeholderow w PATRON_OCR_CMD. Pliki tymczasowe
 * zawsze sprzatane. Rzuca z czytelnym komunikatem (fail-loud, nie cichy pusty OCR).
 */
export async function runOcr(
    buf: Buffer,
    kind: "image" | "pdf",
    filename: string,
): Promise<string> {
    const template = process.env.PATRON_OCR_CMD?.trim();
    if (!template) {
        throw new Error(
            "OCR niedostepny: ustaw PATRON_OCR_CMD (silnik OCR). " +
                "Skan/zdjecie nie zostalo rozpoznane.",
        );
    }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), "patron-ocr-"));
    const inputPath = path.join(work, `in-${crypto.randomUUID()}${tmpExt(kind, filename)}`);
    const outDir = path.join(work, "out");
    try {
        fs.writeFileSync(inputPath, buf);
        const dirMode = usesDirMode(template);
        if (dirMode) fs.mkdirSync(outDir, { recursive: true });
        const argv = buildOcrArgv(template, inputPath, outDir);
        const { stdout, code, stderr } = await spawnCapture(argv);
        if (code !== 0) {
            throw new Error(
                `OCR zwrocil kod ${code}: ${stderr.slice(0, 500) || "(brak stderr)"}`,
            );
        }
        const text = dirMode ? readMarkdownFromDir(outDir) : stdout;
        return text.trim();
    } finally {
        try {
            fs.rmSync(work, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    }
}
