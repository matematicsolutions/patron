// Kolejka indeksacji w tle (ADR-0154).
//
// POWOD. `ingestDocument` konczy sie wywolaniem indeksacji BEZ `await`
// (ADR-0056: odpowiedz HTTP nie ma czekac kilkudziesieciu sekund na embedder).
// Przy imporcie Folderu Sprawy `ingestFolder` przechodzi po wszystkich plikach
// katalogu, wiec kazdy plik wypuszczal wlasny indekser i wszystkie zyly naraz:
// liczba rownoczesnych indekserow byla rowna liczbie plikow w folderze, bez
// zadnej gornej granicy. To ta sama wada co w ADR-0153 (rozmiar wsadu = rozmiar
// danych wejsciowych), tyle ze o pietro wyzej - tam nieograniczona byla paczka
// dla modelu, tu liczba rownoczesnych wywolan modelu.
//
// ADR-0153 ograniczyl paczke do 16 sekwencji, wiec pojedyncze wywolanie modelu
// jest tanie. Ale N rownoczesnych wywolan to N razy aktywacje ORT plus N razy
// komplet chunkow, span-ow i wektorow trzymanych w pamieci - narost liniowy
// wzgledem liczby plikow. Pomiar (ADR-0154) przy 30 plikach: 30 indekserow
// naraz i szczyt pamieci procesu rosnacy z liczba plikow.
//
// DECYZJA. Indeksacja przechodzi przez jedna kolejke FIFO o ograniczonej
// rownoleglosci (domyslnie 1 - embedder i tak jest jednym procesem CPU, wiec
// rownoleglosc niczego nie przyspieszala, a kosztowala pamiec). Wolajacy
// NADAL nie czeka: `scheduleIndexing` wraca natychmiast. Zmienia sie tylko to,
// KIEDY zadanie ruszy, nie to, czy blokuje odpowiedz.
//
// Limit siedzi TUTAJ, a nie w `ingestFolder`, z tego samego powodu, dla ktorego
// ADR-0153 polozyl limit paczki w `embed()`, a nie w indekserze: kazdy nastepny
// wolajacy "w tle" bedzie mial te sama pokuse i te sama wade.

import { indexDocument } from "./indexer";

// DWA, nie jedno - i to jest wynik pomiaru, nie ostroznosci. Rozumowanie
// "embedder jest jednym procesem CPU, wiec rownoleglosc niczego nie daje" jest
// nietrafione: indeksacja dokumentu to nie tylko inferencja, ale takze chunking,
// ekstrakcja encji, budowa grafu i zapisy SQLite. Przy limicie 1 watki ORT stoja
// w tych fazach bezczynnie. Zmierzone na 30 aktach po 50 stron (ADR-0154):
// bez limitu 1 498 s, limit 2 -> 1 586 s (+6%), limit 1 -> 1 978 s (+32%).
// Szczyt pamieci we wszystkich trzech wariantach ten sam (~1,40 GB).
const DEFAULT_INDEX_CONCURRENCY = 2;

/** Ilu indekserow wolno pracowac naraz. `PATRON_INDEX_CONCURRENCY` do przestrojenia. */
export const INDEX_CONCURRENCY = (() => {
  const raw = Number(process.env.PATRON_INDEX_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1
    ? Math.floor(raw)
    : DEFAULT_INDEX_CONCURRENCY;
})();

let running = 0;
/** Oczekujacy na wolny slot, w kolejnosci zgloszenia (FIFO). */
const waiting: (() => void)[] = [];
/** Wolajacy czekajacy na oproznienie calej kolejki (test, zamkniecie aplikacji). */
const idleWaiters: (() => void)[] = [];

function acquire(): Promise<void> {
  if (running < INDEX_CONCURRENCY) {
    running++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiting.push(() => {
      running++;
      resolve();
    });
  });
}

function release(): void {
  running--;
  const next = waiting.shift();
  if (next) {
    next();
    return;
  }
  if (running === 0) {
    // Kolejka pusta i nic nie pracuje - budzimy czekajacych na bezczynnosc.
    const czekajacy = idleWaiters.splice(0, idleWaiters.length);
    for (const w of czekajacy) w();
  }
}

/**
 * Wpuszcza zadanie do kolejki. Zwraca obietnice wyniku zadania - wolajacy MOZE
 * na nia poczekac, ale nie musi. Blad zadania nie blokuje kolejki (slot jest
 * zwalniany w `finally`) i propaguje sie do wolajacego.
 */
export async function enqueueIndexJob<T>(job: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await job();
  } finally {
    release();
  }
}

/**
 * Zglasza dokument do indeksacji w tle. Wraca NATYCHMIAST (bez `await`) -
 * odpowiedz HTTP nie czeka na embedder, taka byla intencja ADR-0056.
 * Roznica wzgledem `void indexDocument(...)`: zadania czekaja w kolejce
 * zamiast ruszac wszystkie naraz.
 */
export function scheduleIndexing(docId: string, text: string): void {
  void enqueueIndexJob(() => indexDocument(docId, text)).catch((err) => {
    console.error(`[ingest] RAG index failed for ${docId}:`, err);
  });
}

/** Stan kolejki: ile pracuje, ile czeka. Do testow i diagnostyki. */
export function indexQueueStats(): { running: number; pending: number } {
  return { running, pending: waiting.length };
}

/** Obietnica spelniana, gdy kolejka jest pusta i nic nie pracuje. */
export function awaitIndexQueueIdle(): Promise<void> {
  if (running === 0 && waiting.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    idleWaiters.push(resolve);
  });
}
