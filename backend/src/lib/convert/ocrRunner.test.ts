import { describe, it, expect, afterEach } from "vitest";
import { buildOcrArgv, isOcrConfigured, runOcr } from "./ocrRunner";

const ENV = process.env.PATRON_OCR_CMD;
afterEach(() => {
    if (ENV === undefined) delete process.env.PATRON_OCR_CMD;
    else process.env.PATRON_OCR_CMD = ENV;
});

describe("buildOcrArgv (pure)", () => {
    it("podstawia {input} jako pojedynczy element (sciezka ze spacja bezpieczna)", () => {
        const argv = buildOcrArgv(
            "python -m chandra_ocr --input {input} --format md",
            "C:\\temp z spacja\\in.png",
        );
        expect(argv).toEqual([
            "python",
            "-m",
            "chandra_ocr",
            "--input",
            "C:\\temp z spacja\\in.png",
            "--format",
            "md",
        ]);
    });

    it("brak {input} w szablonie -> sciezka doklejona na koniec", () => {
        const argv = buildOcrArgv("chandra.exe", "/tmp/in.pdf");
        expect(argv).toEqual(["chandra.exe", "/tmp/in.pdf"]);
    });
});

describe("isOcrConfigured / runOcr", () => {
    it("brak PATRON_OCR_CMD -> nieskonfigurowany", () => {
        delete process.env.PATRON_OCR_CMD;
        expect(isOcrConfigured()).toBe(false);
    });

    it("ustawiony PATRON_OCR_CMD -> skonfigurowany", () => {
        process.env.PATRON_OCR_CMD = "chandra {input}";
        expect(isOcrConfigured()).toBe(true);
    });

    it("runOcr bez konfiguracji -> rzuca czytelny komunikat (zamiast cichego pustego OCR)", async () => {
        delete process.env.PATRON_OCR_CMD;
        await expect(runOcr(Buffer.from("x"), "image", "skan.png")).rejects.toThrow(
            /OCR niedostepny/,
        );
    });
});
