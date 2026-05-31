// Event-centric legal knowledge graph - baseline deterministyczny (ADR-0089, Faza C / US1).
//
// Wzorzec (clean-room, wzorzec NIE kod): Tianjin CN112632223B / CN112632225B
// (CN-only wg zwiadu IP 2026-05-31, brak rodziny EP -> wolne do stosowania w EU)
// - event-node + role typing + subgraph matching. One-stage joint extraction
// inspirowany wzorcem Balanced-TPLinker (rezerwacja US2, model uczony). Bierzemy
// idee reprezentacji i dopasowania, reimplementujemy od zera. Patrz ADR-0089 i
// THIRD_PARTY_INSPIRATIONS.md.
//
// Problem: dual-similarity (ADR-0087) liczy Jaccard PLASKIEGO zbioru wszystkich
// encji dokumentu. Sprawa z tymi samymi przepisami w INNEJ konfiguracji rol
// (te same tokeny rozsiane po dokumencie, nie zwiazane jednym zdarzeniem)
// dostaje wysoki wynik mimo braku analogii strukturalnej. Ten modul reprezentuje
// ZDARZENIA jako ramki rol wspolwystepujacych w obrebie okna tekstu i liczy
// podobienstwo PER ROLA - dwie sprawy sa analogiczne, gdy maja te same wartosci
// zwiazane z tymi samymi rolami w jednej ramce, nie gdy tylko dziela worek encji.
//
// GRANICA: biblioteka. Funkcje czyste (buildEventFrames, frameSimilarity,
// eventSetSimilarity, eventSimilarityRank) sa w pelni testowalne bez bazy;
// loadEventFrames jest cienka warstwa DB. Wpiecie w retrieve() jest rezerwacja
// US3 (jak ADR-0086/0087 - dostarczamy silnik, nie zmieniamy request-path).
//
// DETERMINIZM (Konstytucja Art. 3): zero losowosci, zero zegara, regex+gazetteer,
// stabilne sortowanie z jawnym tie-breakiem. Te same wejscie = te same ramki =
// ten sam ranking. Baseline US1 jest w pelni deterministyczny; ekstraktor uczony
// (US2, audytowalnie reprodukowalny: pinned wagi + greedy + model_version w
// audit_log) jest osobnym modulem i nie wchodzi w tej warstwie.

import { getDb } from "../db/sqlite-connection";
import type { ExtractedEntity, EntityType } from "../pl-entities/types";

/**
 * Role zdarzenia v1 (waski zestaw, decyzja C4): kto (strona) zrobil co (czyn)
 * kiedy (data) za ile (kwota) na jakiej podstawie (podstawa). Rozszerzalne bez
 * breakingu (schema: tekstowa kolumna role; create-if-not-exists).
 */
export type EventRole = "strona" | "czyn" | "data" | "kwota" | "podstawa";

export const EVENT_ROLES: readonly EventRole[] = [
  "strona",
  "czyn",
  "data",
  "kwota",
  "podstawa",
];

/**
 * Mapowanie typu encji ADR-0008 (ontologia legal PL) na role zdarzenia v1.
 * SYGNATURA_ORZECZENIA i SAD nie sa rolami (sygnatura sprawy i sad to metadane,
 * nie role aktora zdarzenia); PII (PESEL/NIP/...) tym bardziej. czyn nie pochodzi
 * z encji - jest wykrywany leksykonem (extractActHits).
 */
export function roleOfEntityType(type: EntityType): EventRole | null {
  switch (type) {
    case "OSOBA":
    case "FIRMA":
      return "strona";
    case "DATA":
    case "DATA_PUBLIKACJI":
      return "data";
    case "KWOTA":
      return "kwota";
    case "SYGNATURA_AKTU":
      return "podstawa";
    default:
      return null; // SYGNATURA_ORZECZENIA, SAD, PII - poza zestawem rol v1
  }
}

/**
 * Leksykon czynow/roszczen (rola czyn). Deterministyczny gazetteer pojec
 * materialnoprawnych polskiego procesu. Dopasowanie case-insensitive na granicy
 * slowa; wartosc kanoniczna = forma z leksykonu (ASCII-lowercase). Kolejnosc bez
 * znaczenia (wszystkie trafienia zbierane). Rozszerzalny. Ograniczenie znane:
 * dopasowanie po formie podstawowej (fleksja PL nie jest lematyzowana) - to celowa
 * minimalnosc baseline US1; bogatsza ekstrakcja czynow = rezerwacja US2 (model).
 */
export const ACT_LEXICON: readonly string[] = [
  "zachowek",
  "darowizna",
  "roszczenie",
  "odwolanie darowizny",
  "zaplata",
  "odszkodowanie",
  "zadoscuczynienie",
  "eksmisja",
  "alimenty",
  "zasiedzenie",
  "wydanie rzeczy",
  "uniewaznienie",
  "ustalenie",
  "zniesienie wspolwlasnosci",
  "dzial spadku",
  "stwierdzenie nabycia spadku",
  "rozwiazanie umowy",
  "uzupelnienie zachowku",
];

/** Pojedyncze trafienie roli: rola + wartosc kanoniczna + pozycja w tekscie. */
export interface RoleHit {
  role: EventRole;
  /** Wartosc znormalizowana (kanoniczna), spojna z value_normalized encji. */
  value: string;
  /** Offset znakowy w tekscie zrodlowym (do klastrowania w ramki). */
  position: number;
}

/**
 * Ramka zdarzenia: zbior wartosci per rola, wspolwystepujacych w obrebie okna
 * tekstu. span = [start, end] offsetow trafien tworzacych ramke. To jest "wezel
 * zdarzenia" - jednostka dopasowania subgrafowego.
 */
export interface EventFrame {
  roles: ReadonlyMap<EventRole, ReadonlySet<string>>;
  span: readonly [number, number];
}

export interface FrameBuildOptions {
  /**
   * Maksymalny odstep znakowy miedzy kolejnymi trafieniami, by nalezaly do tej
   * samej ramki. Wieksze trafienia zaczynaja nowa ramke. Default 160 (~zdanie /
   * krotki akapit). Determinizm niezalezny od wartosci.
   */
  windowChars?: number;
  /**
   * Minimalna liczba ROZNYCH rol, by klaster liczyl sie jako ramka zdarzenia.
   * Pojedyncza izolowana encja nie jest zdarzeniem. Default 2.
   */
  minRoles?: number;
}

const DEFAULT_WINDOW = 160;
const DEFAULT_MIN_ROLES = 2;

function isWordChar(ch: string): boolean {
  return ch !== "" && /[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Wykryj czyny (rola czyn) leksykonem. Case-insensitive, wszystkie wystapienia
 * na granicy slowa. Wartosc = kanoniczna forma z leksykonu. Deterministyczne
 * (skan po stalym leksykonie, brak losowosci). Pozycja = offset trafienia.
 */
export function extractActHits(text: string): RoleHit[] {
  const hits: RoleHit[] = [];
  const lower = text.toLowerCase();
  for (const term of ACT_LEXICON) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(term, from);
      if (idx === -1) break;
      const before = idx === 0 ? "" : lower.charAt(idx - 1);
      const afterIndex = idx + term.length;
      const after = afterIndex >= lower.length ? "" : lower.charAt(afterIndex);
      if (!isWordChar(before) && !isWordChar(after)) {
        hits.push({ role: "czyn", value: term, position: idx });
      }
      from = idx + term.length;
    }
  }
  return hits;
}

/**
 * Zbuduj trafienia rol z encji ADR-0008 (strona/data/kwota/podstawa) oraz
 * czynow z leksykonu. Czysta funkcja - wejscie encje + tekst, wyjscie trafienia.
 */
export function buildRoleHits(
  entities: ReadonlyArray<ExtractedEntity>,
  text: string,
): RoleHit[] {
  const hits: RoleHit[] = [];
  for (const e of entities) {
    const role = roleOfEntityType(e.type);
    if (role === null) continue;
    if (!e.valueNormalized) continue;
    hits.push({ role, value: e.valueNormalized, position: e.sourceOffsetStart });
  }
  for (const a of extractActHits(text)) hits.push(a);
  return hits;
}

/**
 * Stabilne sortowanie trafien: pozycja rosnaco, potem rola alfabetycznie, potem
 * wartosc. Jednoznaczna kolejnosc -> deterministyczne klastrowanie.
 */
function sortHits(hits: ReadonlyArray<RoleHit>): RoleHit[] {
  return [...hits].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    if (a.role !== b.role) return a.role < b.role ? -1 : 1;
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  });
}

function clusterToFrame(
  cluster: ReadonlyArray<RoleHit>,
  minRoles: number,
): EventFrame | null {
  const roles = new Map<EventRole, Set<string>>();
  let minPos = cluster[0].position;
  let maxPos = cluster[0].position;
  for (const h of cluster) {
    if (h.position < minPos) minPos = h.position;
    if (h.position > maxPos) maxPos = h.position;
    let set = roles.get(h.role);
    if (!set) {
      set = new Set<string>();
      roles.set(h.role, set);
    }
    set.add(h.value);
  }
  if (roles.size < minRoles) return null;
  return { roles, span: [minPos, maxPos] };
}

/**
 * Zbuduj ramki zdarzen z trafien rol przez klastrowanie po bliskosci (gap-based).
 * Kolejne trafienia naleza do tej samej ramki, dopoki odstep <= windowChars;
 * wiekszy odstep zaczyna nowa ramke. Klaster zostaje ramka tylko gdy ma >=
 * minRoles ROZNYCH rol (wspolwystepowanie - istota zdarzenia). Deterministyczne.
 */
export function buildEventFrames(
  hits: ReadonlyArray<RoleHit>,
  opts: FrameBuildOptions = {},
): EventFrame[] {
  const windowChars = opts.windowChars ?? DEFAULT_WINDOW;
  const minRoles = Math.max(1, Math.floor(opts.minRoles ?? DEFAULT_MIN_ROLES));
  const sorted = sortHits(hits);
  if (sorted.length === 0) return [];

  const frames: EventFrame[] = [];
  let cluster: RoleHit[] = [sorted[0]];
  let lastPos = sorted[0].position;

  const flush = (): void => {
    const frame = clusterToFrame(cluster, minRoles);
    if (frame) frames.push(frame);
  };

  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i];
    if (h.position - lastPos <= windowChars) {
      cluster.push(h);
    } else {
      flush();
      cluster = [h];
    }
    lastPos = h.position;
  }
  flush();
  return frames;
}

/**
 * Jaccard dwoch zbiorow. Oba puste -> 0 (brak sygnalu, nie sztuczna jedynka).
 * Symetryczny, w [0,1], deterministyczny. (Lokalna kopia - events.ts jest
 * samodzielna biblioteka; dualSimilarity.ts ma wlasna na potrzeby plaskiego
 * profilu encji.)
 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * Podobienstwo dwoch ramek: makro-srednia Jaccarda PER ROLA po rolach obecnych
 * w ktorejkolwiek ramce. To jest sedno przewagi nad ADR-0087: wartosci sa
 * porownywane TYLKO w obrebie tej samej roli (podstawa z podstawa, czyn z
 * czynem), wiec ta sama kwota w roli strony vs kwoty nie zlicza sie jako
 * dopasowanie. Symetryczne, w [0,1]. Brak wspolnych rol -> 0.
 */
export function frameSimilarity(a: EventFrame, b: EventFrame): number {
  const present: EventRole[] = [];
  for (const r of EVENT_ROLES) {
    const ar = a.roles.get(r);
    const br = b.roles.get(r);
    if ((ar && ar.size > 0) || (br && br.size > 0)) present.push(r);
  }
  if (present.length === 0) return 0;
  let sum = 0;
  for (const r of present) {
    sum += jaccard(a.roles.get(r) ?? EMPTY_SET, b.roles.get(r) ?? EMPTY_SET);
  }
  return sum / present.length;
}

/**
 * Podobienstwo subgrafowe dwoch spraw = symetryczne best-match ramek. Dla kazdej
 * ramki A bierzemy najlepsze dopasowanie w B (i odwrotnie), usredniamy oba
 * kierunki. Pusta lista po ktorejkolwiek stronie -> 0 (brak sygnalu, degradacja
 * bez regresji w US3). Symetryczne, w [0,1], deterministyczne.
 */
export function eventSetSimilarity(
  a: ReadonlyArray<EventFrame>,
  b: ReadonlyArray<EventFrame>,
): number {
  if (a.length === 0 || b.length === 0) return 0;
  const dir = (
    xs: ReadonlyArray<EventFrame>,
    ys: ReadonlyArray<EventFrame>,
  ): number => {
    let acc = 0;
    for (const x of xs) {
      let best = 0;
      for (const y of ys) {
        const s = frameSimilarity(x, y);
        if (s > best) best = s;
      }
      acc += best;
    }
    return acc / xs.length;
  };
  return (dir(a, b) + dir(b, a)) / 2;
}

export interface EventCandidate {
  id: number | string;
  /** Wynik tresci z warstwy retrievalu (RRF/wektor/BM25). Wieksze = lepsze. */
  contentScore: number;
  /** Ramki zdarzen kandydata. */
  frames: ReadonlyArray<EventFrame>;
}

export interface EventRankOptions {
  /**
   * Waga tresci w [0,1]. combined = alpha*content + (1-alpha)*zdarzenia.
   * alpha=1 daje czyste content (brak regresji); alpha=0 czyste zdarzenia.
   * Default 0.6 (spojnie z ADR-0087). Wartosci spoza [0,1] sa przycinane.
   */
  alpha?: number;
}

export interface RankedEventCandidate {
  id: number | string;
  score: number;
  contentNorm: number;
  eventScore: number;
}

const DEFAULT_ALPHA = 0.6;

function normalizeContent(scores: number[]): number[] {
  if (scores.length === 0) return [];
  let min = scores[0];
  let max = scores[0];
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  const range = max - min;
  if (range === 0) return scores.map(() => 1);
  return scores.map((s) => (s - min) / range);
}

/**
 * Re-ranking po sygnale zdarzeniowym. Laczy znormalizowany wynik tresci z
 * podobienstwem subgrafowym do ramek referencyjnych (sprawa-kotwica). Pusta
 * referencja -> eventScore 0 dla wszystkich -> ranking sprowadza sie do tresci
 * (brak regresji, gdy brak zdarzen). Best-first.
 *
 * Tie-break deterministyczny: score malejaco, potem contentNorm, potem kolejnosc
 * wejsciowa, na koncu id jako string. (Wzorzec ADR-0087 dualSimilarityRank.)
 */
export function eventSimilarityRank(
  candidates: ReadonlyArray<EventCandidate>,
  reference: ReadonlyArray<EventFrame>,
  opts: EventRankOptions = {},
): RankedEventCandidate[] {
  const alpha = Math.min(1, Math.max(0, opts.alpha ?? DEFAULT_ALPHA));
  const contentNorms = normalizeContent(candidates.map((c) => c.contentScore));

  const scored = candidates.map((c, i) => {
    const eventScore = eventSetSimilarity(c.frames, reference);
    const score = alpha * contentNorms[i] + (1 - alpha) * eventScore;
    return { id: c.id, score, contentNorm: contentNorms[i], eventScore, inputIndex: i };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.contentNorm !== a.contentNorm) return b.contentNorm - a.contentNorm;
    if (a.inputIndex !== b.inputIndex) return a.inputIndex - b.inputIndex;
    const sa = String(a.id);
    const sb = String(b.id);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  return scored.map((s) => ({
    id: s.id,
    score: s.score,
    contentNorm: s.contentNorm,
    eventScore: s.eventScore,
  }));
}

/**
 * Wczytaj ramki zdarzen dokumentu z bazy (events + event_roles). Cienka warstwa
 * DB; cala logika dopasowania jest w funkcjach czystych powyzej. Zwraca [] gdy
 * brak zdarzen (wtedy eventSetSimilarity degraduje do 0 - bez regresji w US3).
 * Rezerwacja US3: wpiecie w retrieve() po ADR-0087.
 */
export function loadEventFrames(documentId: string): EventFrame[] {
  const db = getDb();
  const rows = db
    .prepare(
      `select e.id as event_id, e.span_start as span_start, e.span_end as span_end,
              r.role as role, r.value_normalized as value_normalized
       from events e
       join event_roles r on r.event_id = e.id
       where e.document_id = ?
       order by e.frame_index, r.id`,
    )
    .all(documentId) as {
    event_id: number;
    span_start: number;
    span_end: number;
    role: EventRole;
    value_normalized: string;
  }[];

  const byEvent = new Map<
    number,
    { span: [number, number]; roles: Map<EventRole, Set<string>> }
  >();
  for (const row of rows) {
    let frame = byEvent.get(row.event_id);
    if (!frame) {
      frame = { span: [row.span_start, row.span_end], roles: new Map() };
      byEvent.set(row.event_id, frame);
    }
    let set = frame.roles.get(row.role);
    if (!set) {
      set = new Set<string>();
      frame.roles.set(row.role, set);
    }
    if (row.value_normalized) set.add(row.value_normalized);
  }

  return [...byEvent.values()].map((f) => ({ roles: f.roles, span: f.span }));
}
