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

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", EMBED_MODEL);
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
  const prefixed = texts.map((t) => `${kind}: ${t}`);
  const tensor = await extractor(prefixed, {
    pooling: "mean",
    normalize: true,
  });
  const dim = tensor.dims[1] ?? EMBED_DIM;
  const flat = tensor.data as Float32Array;
  const out: Float32Array[] = [];
  for (let i = 0; i < tensor.dims[0]; i++) {
    out.push(Float32Array.from(flat.slice(i * dim, (i + 1) * dim)));
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
