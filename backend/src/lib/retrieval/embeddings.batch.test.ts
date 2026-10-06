// Regresja wycieku pamieci embeddera (pomiar 2026-09-09, ADR-0153).
//
// Chroniony niezmiennik: embed() NIGDY nie oddaje modelowi wiecej niz
// EMBED_BATCH_SIZE sekwencji w jednym wywolaniu - niezaleznie od tego, ile
// tekstow dostal od wolajacego. Przed poprawka indexer.indexDocument()
// przekazywal tu wszystkie chunki dokumentu naraz, a onnxruntime alokowal
// aktywacje pod najwieksza widziana paczke i nie oddawal tej pamieci do konca
// zycia procesu (zmierzone: 800 chunkow w jednej paczce = 8,8 GB RSS; akta na
// ~1600 chunkow = 17,6 GB, dokladnie tyle co u Operatora po dwoch dniach).
//
// Test jest deterministyczny i offline: model jest zamockowany, wiec bramka nie
// zalezy od wag ani od czasu inferencji. Weryfikuje ROZMIAR PACZKI, bo to on
// jest przyczyna - progu pamieciowego w CI nie stawiamy swiadomie (zalezalby od
// maszyny i od momentu GC; uzasadnienie w ADR-0153, alternatywy odrzucone).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Rozmiary paczek, jakie zamockowany model faktycznie zobaczyl. */
const widzianeRozmiary: number[] = [];
/** Wszystkie teksty w kolejnosci, w jakiej dotarly do modelu. */
const widzianeTeksty: string[] = [];

const DIM = 4;

vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: vi.fn(async () => {
    return async (texts: string[]) => {
      widzianeRozmiary.push(texts.length);
      widzianeTeksty.push(...texts);
      // Wektor rozpoznawalny po pozycji globalnej: pierwszy element = numer
      // chunku z tekstu ("<kind>: chunk <n>"), zeby test mogl sprawdzic
      // kolejnosc wyniku po sklejeniu paczek.
      const data = new Float32Array(texts.length * DIM);
      texts.forEach((t, i) => {
        data[i * DIM] = Number(t.split(" ").pop());
      });
      return { dims: [texts.length, DIM], data };
    };
  }),
}));

const PIERWOTNY_LIMIT = process.env.PATRON_EMBED_BATCH;

describe("embed() - paczkowanie (regresja wycieku pamieci, ADR-0153)", () => {
  beforeEach(() => {
    widzianeRozmiary.length = 0;
    widzianeTeksty.length = 0;
    // Limit czytany jest z env przy imporcie modulu. Bez jawnego wyzerowania
    // bramka mierzylaby konfiguracje maszyny dewelopera, a nie kod.
    delete process.env.PATRON_EMBED_BATCH;
    vi.resetModules();
  });

  afterEach(() => {
    if (PIERWOTNY_LIMIT === undefined) delete process.env.PATRON_EMBED_BATCH;
    else process.env.PATRON_EMBED_BATCH = PIERWOTNY_LIMIT;
  });

  it("nie oddaje modelowi wiecej niz EMBED_BATCH_SIZE sekwencji naraz", async () => {
    const { embed, EMBED_BATCH_SIZE } = await import("./embeddings");
    const LICZBA_CHUNKOW = 400; // realny rozmiar akt sredniej sprawy
    const teksty = Array.from({ length: LICZBA_CHUNKOW }, (_, i) => `chunk ${i}`);

    await embed(teksty, "passage");

    expect(widzianeRozmiary.length).toBeGreaterThan(1);
    expect(Math.max(...widzianeRozmiary)).toBeLessThanOrEqual(EMBED_BATCH_SIZE);
    // Suma paczek = wejscie: nic nie zginelo i nic sie nie zdublowalo.
    expect(widzianeRozmiary.reduce((a, b) => a + b, 0)).toBe(LICZBA_CHUNKOW);
  });

  it("domyslny limit to 16 (wartosc zmierzona jako optimum pamiec/czas)", async () => {
    const { EMBED_BATCH_SIZE } = await import("./embeddings");
    expect(EMBED_BATCH_SIZE).toBe(16);
  });

  it("honoruje PATRON_EMBED_BATCH - dzwignia Operatora na slabszej maszynie", async () => {
    process.env.PATRON_EMBED_BATCH = "4";
    const { embed, EMBED_BATCH_SIZE } = await import("./embeddings");
    expect(EMBED_BATCH_SIZE).toBe(4);

    await embed(Array.from({ length: 10 }, (_, i) => `chunk ${i}`), "passage");
    expect(widzianeRozmiary).toEqual([4, 4, 2]);
  });

  it("odrzuca bezsensowny PATRON_EMBED_BATCH zamiast go przyjac", async () => {
    // Zero albo wartosc ujemna dalyby petle bez konca w embed(); "abc" -> NaN.
    for (const zly of ["0", "-8", "abc", ""]) {
      process.env.PATRON_EMBED_BATCH = zly;
      vi.resetModules();
      const { EMBED_BATCH_SIZE } = await import("./embeddings");
      expect(EMBED_BATCH_SIZE, `wartosc "${zly}"`).toBe(16);
    }
  });

  it("zachowuje kolejnosc wektorow zgodna z kolejnoscia wejscia", async () => {
    const { embed } = await import("./embeddings");
    const teksty = Array.from({ length: 37 }, (_, i) => `chunk ${i}`);

    const wektory = await embed(teksty, "passage");

    expect(wektory).toHaveLength(37);
    // Wolajacy (indexer.ts) laczy vectors[i] z pieces[i] po pozycji - rozjazd
    // kolejnosci przypisalby embedding do niewlasciwego fragmentu akt.
    wektory.forEach((v, i) => expect(v[0]).toBe(i));
  });

  it("dokleja prefiks e5 w kazdej paczce, nie tylko w pierwszej", async () => {
    const { embed } = await import("./embeddings");
    await embed(Array.from({ length: 40 }, (_, i) => `chunk ${i}`), "query");

    expect(widzianeTeksty).toHaveLength(40);
    expect(widzianeTeksty.every((t) => t.startsWith("query: "))).toBe(true);
  });

  it("pusta lista nie dotyka modelu", async () => {
    const { embed } = await import("./embeddings");
    expect(await embed([], "passage")).toEqual([]);
    expect(widzianeRozmiary).toHaveLength(0);
  });
});
