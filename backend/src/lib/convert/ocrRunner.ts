// Runner OCR przez subprocess (ADR-0074). Produkcyjna implementacja `deps.ocr`
// dla convertToMarkdown. Lokalny silnik (Chandra) uruchamiany jako proces
// zewnetrzny - omija blokade junction node_modules->~/patron (to nie npm dep).
//
// Konfiguracja przez env `PATRON_OCR_CMD` - szablon komendy z tokenem {input}:
//   "python -m chandra_ocr --input {input} --format md"
//   albo sciezka do bundlowanego binarki: "C:\\Patron\\ocr\\chandra.exe {input}"
// stdout procesu = rozpoznany tekst/Markdown. Token {input} podstawiamy jako
// POJEDYNCZY element argv (sciezki ze spacjami sa bezpieczne).
//
// Zero-cloud: silnik lokalny, tresc nie opuszcza maszyny (ADR-0071). Model
// bundlowany w instalce, nie pobierany.

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
 * Pure: rozkłada szablon komendy na argv i podstawia token {input} jako
 * pojedynczy element (sciezka ze spacjami bezpieczna). Testowalne bez procesu.
 * Pierwszy element argv = program, reszta = argumenty.
 */
export function buildOcrArgv(template: string, inputPath: string): string[] {
    const tokens = template.trim().split(/\s+/).filter((t) => t.length > 0);
    const argv = tokens.map((t) => (t === "{input}" ? inputPath : t));
    // Gdy szablon nie zawiera {input}, doklej sciezke na koniec (sensowny default).
    if (!tokens.includes("{input}")) argv.push(inputPath);
    return argv;
}

/** Rozszerzenie pliku tymczasowego dla danego rodzaju wejscia OCR. */
function tmpExt(kind: "image" | "pdf", filename: string): string {
    if (kind === "pdf") return ".pdf";
    const s = filename.includes(".")
        ? "." + filename.split(".").pop()!.toLowerCase()
        : ".png";
    return s;
}

/**
 * Produkcyjny `deps.ocr` dla convertToMarkdown. Zapisuje bufor do pliku
 * tymczasowego (bez spacji w nazwie), uruchamia skonfigurowany silnik OCR,
 * zwraca stdout. Plik tymczasowy zawsze sprzatany. Rzuca z czytelnym
 * komunikatem, gdy OCR nieskonfigurowany albo proces zwroci blad.
 */
export async function runOcr(
    buf: Buffer,
    kind: "image" | "pdf",
    filename: string,
): Promise<string> {
    const template = process.env.PATRON_OCR_CMD?.trim();
    if (!template) {
        throw new Error(
            "OCR niedostepny: ustaw PATRON_OCR_CMD (silnik Chandra). " +
                "Skan/zdjecie nie zostalo rozpoznane.",
        );
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patron-ocr-"));
    const inputPath = path.join(dir, `in-${crypto.randomUUID()}${tmpExt(kind, filename)}`);
    try {
        fs.writeFileSync(inputPath, buf);
        const argv = buildOcrArgv(template, inputPath);
        const [cmd, ...args] = argv;
        const text = await new Promise<string>((resolve, reject) => {
            const child = spawn(cmd!, args, { stdio: ["ignore", "pipe", "pipe"] });
            let out = "";
            let err = "";
            child.stdout.on("data", (d) => (out += d.toString()));
            child.stderr.on("data", (d) => (err += d.toString()));
            child.on("error", (e) => reject(e));
            child.on("close", (code) => {
                if (code === 0) resolve(out);
                else
                    reject(
                        new Error(
                            `OCR zwrocil kod ${code}: ${err.slice(0, 500) || "(brak stderr)"}`,
                        ),
                    );
            });
        });
        return text.trim();
    } finally {
        // Sprzataj plik tymczasowy + katalog (best-effort).
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    }
}
