// Pipeline obrony (Invisible AI, ADR-0058). Bierze draft pisma i przepuszcza go
// przez lancuch etapow doskonalacych - kazdy etap zwraca POPRAWIONA wersje
// (output jednego etapu = wejscie nastepnego). Prawnik widzi jeden guzik
// "Draft odpowiedzi"; pod spodem dziala kilka wyspecjalizowanych przebiegow LLM.
//
//   Recenzent      - konstruktywny senior, wzmacnia slabe argumenty, struktura.
//   Adwokat diabla - adversarial; 3 tryby (strona przeciwna / sad / prokurator),
//                    uprzedza kontrargumenty i uodparnia pismo.
//   Pisz po ludzku - usuwa AI-slop, naturalny jezyk prawniczy, zachowuje precyzje.
//
// Buildery promptow sa czyste (testowalne bez LLM). Orkiestrator przyjmuje
// wstrzykiwana funkcje LLM (default completeText) - testy podaja fake.

import { completeText, type UserApiKeys } from "../llm";
import { egressForModel } from "../routing/egress";
import { createPseudonimMap } from "../pseudonim/map";
import { wrapInto, unwrap } from "../pseudonim/wrap";

export type AdwokatMode = "strona-przeciwna" | "sad" | "prokurator";
export type DefenseStage = "recenzent" | "adwokat" | "pisz-po-ludzku";

export const ALL_STAGES: DefenseStage[] = [
  "recenzent",
  "adwokat",
  "pisz-po-ludzku",
];

/**
 * Custom etap z paczki skilla (ADR-0094/0095). Uruchamiany PO wbudowanych,
 * przez ten sam przeplyw maskowania PII. Prompt pochodzi z manifestu - autor
 * skilla kontroluje zachowanie (nie doklejamy BASE_RULES); gwarancja "bez PII"
 * plynie z maskowania pipeline, nie z tresci promptu.
 */
export interface CustomStageSpec {
  id: string;
  name: string;
  system: string;
  user: string;
}

export interface DefenseConfig {
  /** Ktore wbudowane etapy uruchomic, w kolejnosci. Default: wszystkie trzy. */
  stages?: DefenseStage[];
  /** Tryb adwokata diabla. Default: strona-przeciwna. */
  adwokatMode?: AdwokatMode;
  model: string;
  apiKeys?: UserApiKeys;
  /** Opcjonalny kontekst sprawy (rodzaj pisma, instancja) - wstrzykiwany w prompt. */
  context?: string;
  /** Custom etapy z paczek skilli (ADR-0095) - uruchamiane PO wbudowanych. */
  customStages?: CustomStageSpec[];
}

export interface StageResult {
  /** Wbudowany etap (enum) albo id custom skilla z paczki. */
  stage: DefenseStage | string;
  mode?: AdwokatMode;
  /** Etykieta wyswietlana dla custom skilla (nazwa z manifestu). */
  label?: string;
  output: string;
}

export interface DefenseResult {
  final: string;
  stages: StageResult[];
}

export interface DefensePrompt {
  system: string;
  user: string;
}

const BASE_RULES =
  "Pracujesz na polskim pismie procesowym/prawnym. Zachowaj wszystkie fakty, " +
  "daty, kwoty, sygnatury i powolane przepisy bez zmian - nie wymyslaj nowych. " +
  "Nie dodawaj danych osobowych. Zwroc WYLACZNIE poprawiona wersje pisma, bez " +
  "komentarza, bez naglowka 'oto poprawiona wersja', bez metaopisu.";

// ADR-0074: fidelity skilla `marko-pl-content` (UI: "Recenzent"). Twardy prog
// jakosci - eliminuj te same defekty, ktore Marko wytyka w tresci MateMatic,
// zaadaptowane do pisma procesowego.
const RECENZENT_BAR =
  "Recenzujesz wedlug twardego progu jakosci. Eliminuj i napraw: " +
  "(1) marketingowy belkot i hype (kluczowy, przelomowy, innowacyjny, kompleksowy, " +
  "holistyczny) - tnij, zostaw konkret; (2) twierdzenia bez podstawy - kazda teza " +
  "prawna ma sie opierac na przepisie, orzeczeniu albo fakcie z akt; (3) mgliste " +
  "atrybucje (eksperci twierdza, powszechnie uwaza sie) - zastap konkretnym zrodlem; " +
  "(4) powtorzenia tego samego argumentu - scal; (5) niespojny rejestr - ujednolic " +
  "do tonu pisma procesowego; (6) brak struktury - teza, podstawa prawna, subsumpcja, " +
  "wniosek, bez waty. Wzmacniaj slabe argumenty, nie oslabiaj mocnych.";

// ADR-0074: fidelity skilla `humanizer-pl` (UI: "Pisz po polsku"). Konkretne
// wzorce AI-slop PL - usun je, zachowujac precyzje prawnicza i tresc merytoryczna.
const PISZ_PO_POLSKU_RULES =
  "Usun sygnaly tekstu generowanego przez AI, zachowujac precyzje prawnicza: " +
  "(1) slop-slownictwo (kluczowy, istotny, zasadniczy, niezwykle, kompleksowy, " +
  "innowacyjny, synergia, w dzisiejszych czasach, w dobie, warto podkreslic/zaznaczyc) " +
  "- wytnij lub zamien na konkret; (2) imieslowy pozornej glebi (podkreslajac, " +
  "odzwierciedlajac, przyczyniajac sie do, umozliwiajac) - rozbij na zdania; " +
  "(3) regula trojki (trzy synonimiczne wyliczenia dla efektu) - zostaw sama tresc; " +
  "(4) negatywne paralelizmy (nie tylko... ale takze; to nie X, to Y) - przepisz wprost; " +
  "(5) omijanie kopuly (stanowi, pelni funkcje, posiada) -> jest/sa/ma; " +
  "(6) strona bierna ukrywajaca sprawce -> wskaz podmiot; " +
  "(7) filler i hedging (w celu osiagniecia -> zeby; w oparciu o -> na podstawie; " +
  "mozna by potencjalnie -> wprost); (8) kalki anglicyzmow (dedykowany -> przeznaczony, " +
  "adresowac problem -> zajac sie, posiadac -> miec, bazowac -> opierac sie); " +
  "(9) artefakty czatbota, tropy autorytetu (prawdziwe pytanie brzmi, w istocie, co " +
  "najwazniejsze) i generyczne pozytywne zakonczenia - usun. " +
  "Typografia: WYLACZNIE lacznik '-', NIGDY em-dash (— ani –); polskie cudzyslowy. " +
  "Nie skracaj merytoryki; nie ruszaj cytatow, sygnatur ani powolanych przepisow.";

/** Limit dlugosci kontekstu sprawy (H12 - DoS i prompt injection). */
export const MAX_CONTEXT_CHARS = 2000;

/**
 * Sanityzacja pola context (H12). Pole pochodzi od uzytkownika i jest
 * interpolowane do user promptu wszystkich 3 etapow - bez kontroli podatne na
 * prompt injection ("Ignoruj poprzednie instrukcje..."), zwlaszcza w adwokacie
 * diabla. Usuwamy znaki kontrolne (poza zwyklym whitespace) i tniemy dlugosc.
 */
export function sanitizeContext(context: string): string {
  let out = "";
  for (const ch of context) {
    const c = ch.codePointAt(0);
    // pomin znaki kontrolne (zachowaj tab/newline/cr jako zwykly whitespace)
    if (c !== undefined && c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    if (c === 0x7f) continue;
    out += ch;
  }
  return out.slice(0, MAX_CONTEXT_CHARS).trim();
}

function withContext(user: string, context?: string): string {
  if (!context) return user;
  const safe = sanitizeContext(context);
  if (!safe) return user;
  // Otoczenie separatorem - model traktuje kontekst jako dane, nie instrukcje.
  return `<kontekst_sprawy>\n${safe}\n</kontekst_sprawy>\n\n${user}`;
}

export function buildRecenzentPrompt(
  draft: string,
  context?: string,
): DefensePrompt {
  return {
    system:
      "Jestes doswiadczonym radca prawnym recenzujacym pismo kolegi (Recenzent). " +
      "Twoja rola jest konstruktywna: wzmacniasz slabe argumenty, poprawiasz " +
      "strukture i logike wywodu, usuwasz powtorzenia i niejasnosci, dbasz o " +
      "poprawne powolania przepisow i orzecznictwa. Nie oslabiasz mocnych miejsc. " +
      RECENZENT_BAR +
      " " +
      BASE_RULES,
    user: withContext(
      `Zrecenzuj i popraw ponizsze pismo. Wzmocnij argumentacje tam gdzie jest slaba, ` +
        `popraw strukture i jezyk prawniczy.\n\n---\n${draft}`,
      context,
    ),
  };
}

const ADWOKAT_ROLE: Record<AdwokatMode, string> = {
  "strona-przeciwna":
    "Wcielasz sie w pelnomocnika strony PRZECIWNEJ. Znajdz najmocniejsze " +
    "kontrargumenty, luki dowodowe i slabe ogniwa tego pisma.",
  sad: "Wcielasz sie w sklad orzekajacy. Wskaz watpliwosci, braki formalne i " +
    "merytoryczne, pytania ktore zada sad oraz miejsca wymagajace uzupelnienia.",
  prokurator:
    "Wcielasz sie w prokuratora/linie oskarzenia (sprawa karna). Wskaz gdzie " +
    "obrona jest podatna na atak i jakie argumenty podniesie oskarzenie.",
};

export function buildAdwokatPrompt(
  draft: string,
  mode: AdwokatMode,
  context?: string,
): DefensePrompt {
  return {
    system:
      `Jestes adwokatem diabla dla autora pisma. ${ADWOKAT_ROLE[mode]} ` +
      "Najpierw (wewnetrznie, bez wypisywania) zidentyfikuj te kontrargumenty, " +
      "a nastepnie przepisz pismo tak, by je UPRZEDZALO i uodparnialo wywod - " +
      "domykajac luki, wzmacniajac slabe miejsca, dodajac kontrargumentacje tam " +
      "gdzie trzeba. " +
      BASE_RULES,
    user: withContext(
      `Uodpornij ponizsze pismo na atak. Zwroc wzmocniona wersje, ktora ` +
        `przewiduje i zbija kontrargumenty.\n\n---\n${draft}`,
      context,
    ),
  };
}

export function buildPiszPoLudzkuPrompt(
  draft: string,
  context?: string,
): DefensePrompt {
  return {
    system:
      "Jestes redaktorem (Pisz po polsku), ktory sprawia ze pisma prawnicze brzmia " +
      "naturalnie, a nie jak generowane maszynowo. Usun AI-slop. " +
      PISZ_PO_POLSKU_RULES +
      " Zachowaj jezyk prawniczy, terminy, precyzje i ton odpowiedni do pisma " +
      "procesowego. " +
      BASE_RULES,
    user: withContext(
      `Przepisz ponizsze pismo tak, by czytalo sie naturalnie i profesjonalnie, ` +
        `bez znamion tekstu generowanego przez AI.\n\n---\n${draft}`,
      context,
    ),
  };
}

function promptForStage(
  stage: DefenseStage,
  draft: string,
  config: DefenseConfig,
): { prompt: DefensePrompt; mode?: AdwokatMode } {
  if (stage === "recenzent") {
    return { prompt: buildRecenzentPrompt(draft, config.context) };
  }
  if (stage === "adwokat") {
    const mode = config.adwokatMode ?? "strona-przeciwna";
    return { prompt: buildAdwokatPrompt(draft, mode, config.context), mode };
  }
  return { prompt: buildPiszPoLudzkuPrompt(draft, config.context) };
}

/**
 * Prompt custom etapu z paczki skilla. System pochodzi w calosci z manifestu
 * (autor kontroluje zachowanie); draft doklejany do user-promptu jak w etapach
 * wbudowanych. Kontekst sprawy wstrzykiwany tym samym separatorem (dane, nie
 * instrukcje). Maskowanie PII robi runDefensePipeline, nie ten prompt.
 */
export function buildCustomPrompt(
  spec: CustomStageSpec,
  draft: string,
  context?: string,
): DefensePrompt {
  return {
    system: spec.system,
    user: withContext(`${spec.user}\n\n---\n${draft}`, context),
  };
}

export type LlmCompleteFn = (params: {
  model: string;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
  apiKeys?: UserApiKeys;
}) => Promise<string>;

/**
 * Uruchamia lancuch obrony. Kazdy etap dostaje aktualny draft i zwraca
 * poprawiona wersje, ktora staje sie wejsciem nastepnego etapu. Zwraca finalny
 * draft + wynik kazdego etapu (transparency). LLM wstrzykiwany (test = fake).
 */
export async function runDefensePipeline(
  draft: string,
  config: DefenseConfig,
  llm: LlmCompleteFn = completeText,
): Promise<DefenseResult> {
  const stages = config.stages ?? ALL_STAGES;
  // H14 (ADR-0068): maskuj PII PRZED wyjsciem do chmury. Pipeline robi do 3
  // wywolan LLM na drogim modelu - draft z PESEL/NIP nie moze isc jawnie do
  // dostawcy chmurowego. Model lokalny (no-egress, pilotaz Ollama) pomijany.
  // Wylacznik PATRON_PSEUDONIM_EGRESS=false. Imiona LLM-noop = dlug FAZA 1 (B1).
  const mask =
    process.env.PATRON_PSEUDONIM_EGRESS !== "false" &&
    egressForModel(config.model) !== "no-egress";
  const map = mask ? createPseudonimMap() : null;
  // `current` plynie zamaskowany przez wszystkie etapy (wspolna mapa = spojne
  // tokeny); output kazdego etapu pokazujemy odwrocony.
  let current = map ? await wrapInto(map, draft) : draft;
  const results: StageResult[] = [];
  // Zadania = wbudowane etapy (w kolejnosci) + custom etapy z paczek PO nich.
  // Custom etapy ida przez ten sam zamaskowany `current` (wspolna mapa PII).
  type Job =
    | { kind: "builtin"; stage: DefenseStage }
    | { kind: "custom"; spec: CustomStageSpec };
  const jobs: Job[] = [
    ...stages.map((stage): Job => ({ kind: "builtin", stage })),
    ...(config.customStages ?? []).map((spec): Job => ({ kind: "custom", spec })),
  ];
  for (const job of jobs) {
    let prompt: DefensePrompt;
    let mode: AdwokatMode | undefined;
    let stageId: string;
    let label: string | undefined;
    if (job.kind === "builtin") {
      const r = promptForStage(job.stage, current, config);
      prompt = r.prompt;
      mode = r.mode;
      stageId = job.stage;
    } else {
      prompt = buildCustomPrompt(job.spec, current, config.context);
      stageId = job.spec.id;
      label = job.spec.name;
    }
    const output = await llm({
      model: config.model,
      systemPrompt: prompt.system,
      user: prompt.user,
      maxTokens: 8000,
      apiKeys: config.apiKeys,
    });
    const trimmed = (output ?? "").trim();
    // Pusta odpowiedz etapu nie kasuje draftu - zachowaj poprzedni.
    if (trimmed) current = trimmed;
    results.push({
      stage: stageId,
      mode,
      label,
      output: map ? unwrap(trimmed, map) : trimmed,
    });
  }
  return {
    final: map ? unwrap(current, map) : current,
    stages: results,
  };
}
