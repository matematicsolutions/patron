// Lokalny embedder (ADR-0054, realizacja wektorowej warstwy ADR-0007).
//
// Zero-cloud: model uruchamiany w procesie przez transformers.js (ONNX),
// dane przy inferencji nie opuszczaja maszyny (Konstytucja Art. 2).
//
// ADR-0071: domyslnie ZAKAZ pobierania wag modelu z sieci (HF Hub w US). Bez
// tego pierwszy start na czystej maszynie cicho fetchowal multilingual-e5-small
// z CDN HuggingFace - ukryty egress lamiacy zero-cloud (metadane: IP/UA/timestamp).
// Lokalny cache / model dostarczony lokalnie nadal dziala offline. Jednorazowe
// pobranie = swiadoma zgoda Operatora przez PATRON_EMBED_ALLOW_DOWNLOAD=true
// (analogicznie do ALLOW_US_PROVIDERS). Gdy model niedostepny lokalnie i pobieranie
// wylaczone - embedder rzuca, retrieval degraduje sie do BM25 + grafu (ADR-0007).
//
// e5 wymaga prefiksow "query: " / "passage: " - INNE prefiksy psuja jakosc
// retrievalu (asymetria pytanie vs fragment). Patrz karta modelu e5.

import {
  pipeline,
  env,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import { EMBED_DIM } from "../db/sqlite-connection";

export const EMBED_MODEL =
  process.env.PATRON_EMBED_MODEL || "Xenova/multilingual-e5-small";

// Zero-cloud fail-closed: zadnych zdalnych pobran modelu, chyba ze Operator
// jawnie wlaczyl. Lokalny cache (env.cacheDir) i localModelPath dzialaja dalej.
env.allowRemoteModels = process.env.PATRON_EMBED_ALLOW_DOWNLOAD === "true";
if (process.env.PATRON_EMBED_MODELS_PATH) {
  env.localModelPath = process.env.PATRON_EMBED_MODELS_PATH;
}

export type EmbedKind = "query" | "passage";

// Gorna granica liczby sekwencji w JEDNYM wywolaniu modelu.
//
// POWOD (pomiar 2026-09-09, wyciek 17,6 GB w procesie backendu): indexer
// wolal embed() z CALYM dokumentem naraz (indexer.ts: `embed(pieces.map(...))`),
// wiec rozmiar paczki byl rowny liczbie chunkow dokumentu - bez zadnego limitu.
// onnxruntime alokuje aktywacje pod NAJWIEKSZA widziana paczke i tej pamieci
// NIE oddaje (arena rosnie do high-water mark i zostaje do konca zycia procesu).
// Zmierzony koncowy RSS procesu przy jednej paczce: 100 chunkow -> 1,8 GB,
// 200 -> 2,7 GB, 400 -> 4,1 GB, 800 -> 8,8 GB (~10 MB na chunk, liniowo).
// Akta na ~1600 chunkow (300-400 stron) daja ~17,6 GB - dokladnie tyle, ile
// zmierzono u Operatora po dwoch dniach pracy. Pamiec jest zimna (jednorazowo
// dotknieta przy inferencji), wiec Windows wypycha ja do pagefile: stad obraz
// "commit 17,6 GB przy working set 41 MB".
//
// Przy paczkowaniu po 16 ten sam wolumen (400 chunkow) konczy na 725-991 MB
// i - co wazniejsze - jest STALY niezaleznie od wielkosci dokumentu. Jest
// takze SZYBSZY (103 s vs 183 s): jedna gigantyczna paczka jest paddowana do
// najdluzszej sekwencji i liczy mase pustych tokenow.
const DEFAULT_EMBED_BATCH = 16;
export const EMBED_BATCH_SIZE = (() => {
  const raw = Number(process.env.PATRON_EMBED_BATCH);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_EMBED_BATCH;
})();

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    // Audyt P3 #16: nie cache'uj ODRZUCONEGO promise. Jezeli pierwszy load
    // modelu sie wywali (np. brak wag lokalnie, chwilowy blad), wyzeruj cache,
    // zeby kolejne wywolanie moglo sprobowac ponownie bez restartu procesu.
    //
    // enableCpuMemArena=false: arena onnxruntime nie oddaje pamieci po
    // inferencji. Przy paczkach o stalym rozmiarze arena nie jest nam
    // potrzebna, a jej wylaczenie scina staly narzut o kolejne ~27%
    // (991 MB -> 725 MB na tym samym wolumenie, pomiar 2026-09-09).
    extractorPromise = pipeline("feature-extraction", EMBED_MODEL, {
      session_options: { enableCpuMemArena: false },
    }).catch((err) => {
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

/**
 * Liczy embeddingi dla listy tekstow. `kind` ustawia prefiks e5
 * ("query: " dla zapytan, "passage: " dla fragmentow korpusu). Zwraca
 * znormalizowane wektory (L2) o wymiarze EMBED_DIM.
 */
export async function embed(
  texts: string[],
  kind: EmbedKind,
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out: Float32Array[] = [];
  // Paczkowanie po EMBED_BATCH_SIZE - patrz komentarz przy stalej. Kolejnosc
  // wektorow odpowiada kolejnosci `texts` (wolajacy indeksuje po pozycji).
  for (let from = 0; from < texts.length; from += EMBED_BATCH_SIZE) {
    const prefixed = texts
      .slice(from, from + EMBED_BATCH_SIZE)
      .map((t) => `${kind}: ${t}`);
    const tensor = await extractor(prefixed, {
      pooling: "mean",
      normalize: true,
    });
    const dim = tensor.dims[1] ?? EMBED_DIM;
    const flat = tensor.data as Float32Array;
    for (let i = 0; i < tensor.dims[0]; i++) {
      out.push(Float32Array.from(flat.slice(i * dim, (i + 1) * dim)));
    }
  }
  return out;
}

/** Embedding pojedynczego tekstu. */
export async function embedOne(
  text: string,
  kind: EmbedKind,
): Promise<Float32Array> {
  const [vec] = await embed([text], kind);
  return vec;
}
