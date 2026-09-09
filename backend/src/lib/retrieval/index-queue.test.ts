// Bramka kolejki indeksacji. Pilnuje DWOCH wlasnosci, kazda z innego ADR-a:
//   ADR-0156 - zadanie startuje poza biezaca faza petli zdarzen, wiec nie
//              wchodzi przed sciezke odpowiedzi (nawet gdy jest CPU-bound);
//   ADR-0154 - liczba rownoczesnie pracujacych indekserow ma gorna granice
//              i nie zalezy od liczby plikow w importowanym folderze.
//
// Testujemy przyczyne (rownoleglosc), nie skutek (zuzycie pamieci) - z tego
// samego powodu, dla ktorego ADR-0153 nie postawil progu pamieciowego w CI:
// prog RSS wymagalby zaladowania prawdziwych wag i inferencji w kazdym
// przebiegu, a wynik zalezalby od maszyny i od momentu zadzialania GC. Test
// flaky w bramce jakosci uczy zespol ignorowania czerwonego. Rownoleglosc jest
// mierzalna deterministycznie, offline, bez modelu - i to ona jest w bramce.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Kolejka importuje indekser (ciagnie SQLite + model). Bramka dotyczy samej
// kolejki, wiec indekser jest zamockowany.
const indexDocumentMock = vi.hoisted(() => vi.fn());
vi.mock("./indexer", () => ({ indexDocument: indexDocumentMock }));

/** Zadanie, ktore samo mowi kiedy ruszylo i konczy sie dopiero na zadanie. */
function odroczoneZadanie() {
  let uwolnij!: () => void;
  let zwal!: (e: unknown) => void;
  const gotowe = new Promise<void>((res, rej) => {
    uwolnij = () => res();
    zwal = (e) => rej(e);
  });
  let ruszylo = false;
  return {
    ruszylo: () => ruszylo,
    uwolnij,
    zwal,
    job: async () => {
      ruszylo = true;
      await gotowe;
      return "ok";
    },
  };
}

async function przemiel(): Promise<void> {
  // Zadania startuja przez `setImmediate` (ADR-0156), wiec samo przemielenie
  // mikro-kolejki juz nie wystarcza - trzeba przepuscic faze check.
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((res) => setImmediate(res));
  }
}

async function zaladujKolejke(concurrency?: string) {
  vi.resetModules();
  if (concurrency === undefined) delete process.env.PATRON_INDEX_CONCURRENCY;
  else process.env.PATRON_INDEX_CONCURRENCY = concurrency;
  return import("./index-queue");
}

describe("kolejka indeksacji (ADR-0156 + ADR-0154)", () => {
  beforeEach(() => {
    indexDocumentMock.mockReset();
  });

  /** Zglasza 20 zadan i zwraca zaobserwowany szczyt rownoleglosci. */
  async function zmierzSzczyt(
    q: typeof import("./index-queue"),
  ): Promise<number> {
    let biezaca = 0;
    let szczyt = 0;
    const uwolnienia: (() => void)[] = [];
    const obietnice = Array.from({ length: 20 }, () =>
      q.enqueueIndexJob(async () => {
        biezaca++;
        if (biezaca > szczyt) szczyt = biezaca;
        await new Promise<void>((res) => uwolnienia.push(res));
        biezaca--;
      }),
    );
    await przemiel(); // pierwsze zadania musza ruszyc
    for (let krok = 0; krok < 40; krok++) {
      uwolnienia.shift()?.();
      await przemiel();
    }
    await Promise.all(obietnice);
    return szczyt;
  }

  it("domyslnie przepuszcza DWA zadania naraz (pomiar ADR-0154, nie ostroznosc)", async () => {
    const q = await zaladujKolejke();
    expect(q.INDEX_CONCURRENCY).toBe(2);

    const zadania = Array.from({ length: 12 }, () => odroczoneZadanie());
    const obietnice = zadania.map((z) => q.enqueueIndexJob(z.job));
    await przemiel();

    // Sedno: 12 zgloszen != 12 pracujacych. Reszta czeka.
    expect(zadania.filter((z) => z.ruszylo()).length).toBe(2);
    expect(q.indexQueueStats()).toEqual({ running: 2, pending: 10 });

    for (const z of zadania) {
      z.uwolnij();
      await przemiel();
      expect(q.indexQueueStats().running).toBeLessThanOrEqual(2);
    }
    await Promise.all(obietnice);
  });

  it("przy PATRON_INDEX_CONCURRENCY=3 szczyt rownoleglosci to 3, nigdy wiecej", async () => {
    const q = await zaladujKolejke("3");
    expect(q.INDEX_CONCURRENCY).toBe(3);
    expect(await zmierzSzczyt(q)).toBe(3);
    expect(q.indexQueueStats()).toEqual({ running: 0, pending: 0 });
  });

  it("przy PATRON_INDEX_CONCURRENCY=1 szczyt rownoleglosci to 1 (dzwignia Operatora)", async () => {
    const q = await zaladujKolejke("1");
    expect(q.INDEX_CONCURRENCY).toBe(1);
    expect(await zmierzSzczyt(q)).toBe(1);
    expect(q.indexQueueStats()).toEqual({ running: 0, pending: 0 });
  });

  it("wartosc bezsensowna w PATRON_INDEX_CONCURRENCY spada do domyslnej", async () => {
    for (const zla of ["0", "-3", "abc", ""]) {
      const q = await zaladujKolejke(zla);
      expect(q.INDEX_CONCURRENCY).toBe(2);
    }
  });

  it("zachowuje kolejnosc zgloszen (FIFO)", async () => {
    const q = await zaladujKolejke();
    const kolejnosc: number[] = [];
    const uwolnienia: (() => void)[] = [];
    const obietnice = Array.from({ length: 5 }, (_, i) =>
      q.enqueueIndexJob(async () => {
        kolejnosc.push(i);
        await new Promise<void>((res) => uwolnienia.push(res));
      }),
    );
    for (let krok = 0; krok < 10 && kolejnosc.length < 5; krok++) {
      uwolnienia.shift()?.();
      await przemiel();
    }
    uwolnienia.forEach((u) => u());
    await Promise.all(obietnice);
    expect(kolejnosc).toEqual([0, 1, 2, 3, 4]);
  });

  it("zadanie, ktore rzucilo, nie zakleszcza kolejki", async () => {
    const q = await zaladujKolejke();
    const pechowe = q.enqueueIndexJob(async () => {
      throw new Error("indeks padl");
    });
    const kolejne = q.enqueueIndexJob(async () => "poszlo");

    await expect(pechowe).rejects.toThrow("indeks padl");
    await expect(kolejne).resolves.toBe("poszlo");
    expect(q.indexQueueStats()).toEqual({ running: 0, pending: 0 });
  });

  it("zadanie NIE wchodzi przed sciezke odpowiedzi, nawet gdy jest CPU-bound", async () => {
    // Sedno ADR-0156. Semafor sam tego nie zapewnia: `await` na spelnionej
    // obietnicy to mikro-zadanie, ktore wykona sie PRZED faza I/O. Bez
    // `setImmediate` w kolejce ten test widzi ["praca", "odpowiedz"].
    //
    // Zadanie jest celowo synchroniczne (zero `await`) - tak zachowuje sie
    // indexDocument przy wylaczonej warstwie wektorowej: nie ma tam ani jednego
    // punktu oddania sterowania.
    const q = await zaladujKolejke();
    const kroki: string[] = [];
    indexDocumentMock.mockImplementation(() => {
      kroki.push("praca");
      return Promise.resolve();
    });

    q.scheduleIndexing("doc-cpu-1", "tresc");
    q.scheduleIndexing("doc-cpu-2", "tresc");
    // Marker fazy check zaplanowany TUZ PO zgloszeniu - w serwerze w tym
    // miejscu odpowiedz idzie do gniazda.
    await new Promise<void>((res) =>
      setImmediate(() => {
        kroki.push("odpowiedz");
        res();
      }),
    );
    await q.flushIndexQueue();

    expect(kroki[0]).toBe("odpowiedz");
    expect(kroki).toEqual(["odpowiedz", "praca", "praca"]);
  });

  it("scheduleIndexing wraca natychmiast i NIE wola indeksera synchronicznie", async () => {
    const q = await zaladujKolejke();
    let skonczony = false;
    indexDocumentMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      skonczony = true;
    });

    // Sedno kontraktu ADR-0056: odpowiedz HTTP nie czeka na embedder.
    const wynik = q.scheduleIndexing("doc-1", "tresc");
    expect(wynik).toBeUndefined();
    expect(indexDocumentMock).not.toHaveBeenCalled(); // nawet nie ruszyl jeszcze
    expect(skonczony).toBe(false);

    await q.flushIndexQueue();
    expect(indexDocumentMock).toHaveBeenCalledWith("doc-1", "tresc");
    expect(skonczony).toBe(true);
  });

  it("blad indeksacji nie wychodzi na zewnatrz scheduleIndexing (best-effort)", async () => {
    const q = await zaladujKolejke();
    const blad = vi.spyOn(console, "error").mockImplementation(() => {});
    indexDocumentMock.mockRejectedValue(new Error("model niedostepny"));

    expect(() => q.scheduleIndexing("doc-2", "tresc")).not.toThrow();
    await q.flushIndexQueue();
    // Kolejka melduje bezczynnosc, gdy slot jest zwolniony; wlasny `.catch`
    // zadania to kolejne mikro-zadanie, stad przemielenie przed asercja.
    await przemiel();

    expect(blad).toHaveBeenCalled();
    expect(q.indexQueueStats()).toEqual({ running: 0, pending: 0 });
    blad.mockRestore();
  });

  it("flushIndexQueue czeka na CALA kolejke, nie na pierwsze zadanie", async () => {
    const q = await zaladujKolejke();
    const zrobione: string[] = [];
    indexDocumentMock.mockImplementation(async (id: string) => {
      await new Promise((r) => setTimeout(r, 3));
      zrobione.push(id);
    });

    for (const id of ["a", "b", "c", "d", "e", "f"]) q.scheduleIndexing(id, "tresc");
    expect(q.indexQueueStats()).toEqual({ running: 2, pending: 4 });

    await q.flushIndexQueue();
    expect(zrobione.length).toBe(6);
    expect([...zrobione].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
