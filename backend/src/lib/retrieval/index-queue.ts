// Kolejka indeksacji RAG (ADR-0156, wartosc limitu z ADR-0154).
//
// Robi dwie rzeczy, ktore latwo pomylic, a ktore naprawiaja dwie rozne wady.
//
// 1. ODSUWA PRACE POZA SCIEZKE ODPOWIEDZI (`setImmediate`).
//    `void indexDocument(...)` nie odsuwal niczego. Funkcja async wykonuje sie
//    synchronicznie az do pierwszego `await`, ktory faktycznie oddaje sterowanie.
//    Przy wylaczonej warstwie wektorowej (`PATRON_DISABLE_VEC`, albo gdy wag
//    modelu nie ma i retrieval degraduje do BM25 + grafu - ADR-0007) indeksacja
//    takiego punktu NIE MA: chunkowanie, lokalizacja spanow, graf encji i zapisy
//    better-sqlite3 sa synchroniczne. Zmierzone: 100% czasu indeksacji
//    (0,59 s / 1,75 s / 4,64 s dla 1000 / 1595 / 4000 chunkow) uplywalo przed
//    oddaniem sterowania, czyli PRZED wyslaniem odpowiedzi HTTP.
//    Sam semafor tego nie naprawia: `await` na spelnionej obietnicy to
//    mikro-zadanie, ktore i tak wykona sie przed faza I/O. Dopiero `setImmediate`
//    przesuwa start zadania za biezaca faze petli zdarzen.
//
// 2. OGRANICZA ROWNOLEGLOSC (semafor).
//    `ingestFolder` (Folder Sprawy, ADR-0056) idzie po wszystkich plikach
//    katalogu, wiec bez limitu liczba rownoczesnych indekserow byla rowna
//    liczbie plikow. To ta sama klasa wady co w ADR-0153: wielkosc brana
//    z danych wejsciowych, nie z projektu.
//
// To NIE czyni indeksacji nieblokujaca: praca dalej zajmuje watek, gdy juz
// ruszy. Przenosi granice - odpowiedz wychodzi przed nia, nie po niej.
// Prawdziwe zdjecie jej z watku (worker_threads) to osobna decyzja.
//
// Limit siedzi TUTAJ, a nie w `ingestFolder`, z tego samego powodu, dla ktorego
// ADR-0153 polozyl limit paczki w `embed()`, a nie w indekserze: kazdy nastepny
// wolajacy "w tle" bedzie mial te sama pokuse i te sama wade.

import { indexDocument } from "./indexer";

// DWA, nie jedno - z pomiaru, nie z ostroznosci. Rozumowanie "embedder jest
// jednym procesem CPU, wiec rownoleglosc niczego nie daje" jest nietrafione:
// indeksacja to nie tylko inferencja, ale takze chunking, ekstrakcja encji,
// budowa grafu i zapisy SQLite. Przy limicie 1 watki ORT stoja w tych fazach
// bezczynnie. Zmierzone na 30 aktach po 50 stron, embedder WLACZONY (ADR-0154):
// bez limitu 1 498 s, limit 2 -> 1 586 s (+6%), limit 1 -> 1 978 s (+32%).
// Szczyt pamieci we wszystkich trzech wariantach ten sam (~1,40 GB).
//
// Przy wylaczonej warstwie wektorowej limit powyzej 1 nie daje nic i nie szkodzi:
// zadanie bez punktu oddania sterowania i tak wykona sie w calosci, zanim ruszy
// nastepne. Rownolegle sa wtedy tylko sloty, nie praca.
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
/** Wolajacy czekajacy na oproznienie calej kolejki (testy, zamkniecie procesu). */
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
 *
 * Zadanie startuje przez `setImmediate`, wiec nigdy nie wykona sie w tej samej
 * fazie petli zdarzen co zgloszenie - patrz punkt 1 w naglowku pliku.
 */
export async function enqueueIndexJob<T>(job: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await new Promise<T>((resolve, reject) => {
      setImmediate(() => {
        job().then(resolve, reject);
      });
    });
  } finally {
    release();
  }
}

/**
 * Zglasza dokument do indeksacji w tle. Wraca NATYCHMIAST, a praca rusza
 * dopiero po zamknieciu biezacej fazy petli zdarzen - odpowiedz HTTP zdazy
 * pojsc do klienta (kontrakt ADR-0056, ktorego `void indexDocument(...)`
 * nie spelnial).
 *
 * Blad indeksacji jest logowany i pochlaniany: jedna nieudana indeksacja nie
 * moze zatrzymac kolejki ani wywrocic procesu.
 */
export function scheduleIndexing(docId: string, text: string): void {
  void enqueueIndexJob(() => indexDocument(docId, text)).catch((err) => {
    console.error(`[index-queue] indeksacja nieudana dla ${docId}:`, err);
  });
}

/** Stan kolejki: ile pracuje (lub ma przydzielony slot), ile czeka. */
export function indexQueueStats(): { running: number; pending: number } {
  return { running, pending: waiting.length };
}

/**
 * Czeka, az kolejka sie oprozni. Do testow i do zamykania procesu - bez tego
 * `afterAll` zamykalby SQLite pod trwajaca indeksacja.
 */
export function flushIndexQueue(): Promise<void> {
  if (running === 0 && waiting.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    idleWaiters.push(resolve);
  });
}
