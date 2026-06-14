// Testy ADR-0118: typed search feed z best-effort lokatorem.

import { describe, it, expect } from "vitest";
import type { RetrievedChunk } from "../retrieval/retrieval";
import { reanchor } from "./locator";
import { buildSearchFeed, type FeedSourceResolver } from "./search-feed";

function chunk(
    documentId: string,
    content: string,
    chunkIndex = 0,
    score = 0.5,
): RetrievedChunk {
    return { chunkId: chunkIndex + 1, documentId, chunkIndex, content, score };
}

describe("buildSearchFeed - pusty wynik", () => {
    it("brak hitow -> total 0 + note honesty", () => {
        const feed = buildSearchFeed("pytanie", [], () => null);
        expect(feed.total).toBe(0);
        expect(feed.results).toEqual([]);
        expect(feed.note).toMatch(/Brak trafien/);
        expect(feed.granularity).toBe("passage");
    });
});

describe("buildSearchFeed - kotwica exact", () => {
    const SRC =
        "Sad uznal, ze powodztwo jest zasadne. Pozwany nie wykazal przeciwnego.";
    const resolve: FeedSourceResolver = () => SRC;

    it("fragment verbatim w zrodle -> anchor exact + niezmiennik slice", () => {
        const feed = buildSearchFeed(
            "zasadnosc",
            [chunk("doc-1", "powodztwo jest zasadne")],
            resolve,
        );
        const hit = feed.results[0]!;
        expect(hit.type).toBe("passage");
        expect(hit.anchor).toBe("exact");
        expect(hit.locator).not.toBeNull();
        expect(hit.locator!.rawText).toBe("powodztwo jest zasadne");
        // niezmiennik: lokator wskazuje verbatim
        const a = reanchor(hit.locator!, SRC);
        expect(SRC.slice(a!.start, a!.end)).toBe("powodztwo jest zasadne");
        expect(hit.anchorNote).toBeUndefined();
    });

    it("round-trip: lokator feedu -> reanchor ten sam span", () => {
        const feed = buildSearchFeed(
            "q",
            [chunk("doc-1", "Pozwany nie wykazal")],
            resolve,
        );
        const loc = feed.results[0]!.locator!;
        const a = reanchor(loc, SRC);
        expect(a!.start).toBe(SRC.indexOf("Pozwany nie wykazal"));
    });
});

describe("buildSearchFeed - anchor none (uczciwie)", () => {
    it("brak zrodla (resolver null) -> none + note", () => {
        const feed = buildSearchFeed("q", [chunk("doc-x", "cokolwiek")], () => null);
        const hit = feed.results[0]!;
        expect(hit.anchor).toBe("none");
        expect(hit.locator).toBeNull();
        expect(hit.anchorNote).toMatch(/brak tekstu zrodlowego/);
    });

    it("tresc nie wystepuje verbatim (normalizacja) -> none + note", () => {
        // chunk znormalizowany pojedynczymi spacjami; zrodlo ma podwojne spacje
        // i nowa linie - dokladne indexOf nie trafi.
        const src = "Klauzula  poufnosci\nobowiazuje strony.";
        const feed = buildSearchFeed(
            "q",
            [chunk("doc-1", "Klauzula poufnosci obowiazuje strony.")],
            () => src,
        );
        const hit = feed.results[0]!;
        expect(hit.anchor).toBe("none");
        expect(hit.locator).toBeNull();
        expect(hit.anchorNote).toMatch(/normalizacja chunka/);
    });
});

describe("buildSearchFeed - wieloznacznosc", () => {
    it("fragment wielokrotny -> exact, kotwica na pierwszym, anchorNote", () => {
        const src = "zgoda. potem zgoda. na koncu zgoda.";
        const feed = buildSearchFeed("q", [chunk("doc-1", "zgoda")], () => src);
        const hit = feed.results[0]!;
        expect(hit.anchor).toBe("exact");
        expect(hit.locator!.startHint).toBe(src.indexOf("zgoda"));
        expect(hit.locator!.occurrenceHint).toBe(0);
        expect(hit.anchorNote).toMatch(/wielokrotnie/);
    });
});

describe("buildSearchFeed - wiele hitow", () => {
    it("zachowuje kolejnosc i total; rozne dokumenty przez resolver", () => {
        const sources: Record<string, string> = {
            "doc-1": "alfa beta gamma",
            "doc-2": "delta epsilon",
        };
        const resolve: FeedSourceResolver = (id) => sources[id] ?? null;
        const feed = buildSearchFeed(
            "q",
            [
                chunk("doc-1", "beta gamma", 0, 0.9),
                chunk("doc-2", "epsilon", 1, 0.7),
                chunk("doc-3", "ZZZ", 2, 0.1),
            ],
            resolve,
        );
        expect(feed.total).toBe(3);
        expect(feed.results.map((h) => h.documentId)).toEqual([
            "doc-1",
            "doc-2",
            "doc-3",
        ]);
        expect(feed.results[0]!.anchor).toBe("exact");
        expect(feed.results[1]!.anchor).toBe("exact");
        expect(feed.results[2]!.anchor).toBe("none"); // doc-3 brak zrodla
    });

    it("granularity zapisany z opcji", () => {
        const feed = buildSearchFeed("q", [], () => null, {
            granularity: "both",
        });
        expect(feed.granularity).toBe("both");
    });
});
