// Lokalny embedder (ADR-0054, realizacja wektorowej warstwy ADR-0007).
//
// Zero-cloud: model uruchamiany w procesie przez transformers.js (ONNX),
// dane nie opuszczaja maszyny (Konstytucja Art. 2). Default model
// multilingual-e5-small (384d) - pobierany raz przy pierwszym uzyciu, potem
// z cache. Zmiana modelu na inny wymiar wymaga re-index (DROP vec_chunks +
// PATRON_EMBED_DIM zgodny z modelem).
//
// e5 wymaga prefiksow "query: " / "passage: " - INNE prefiksy psuja jakosc
// retrievalu (asymetria pytanie vs fragment). Patrz karta modelu e5.

import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBED_DIM } from "../db/sqlite-connection";

export const EMBED_MODEL =
  process.env.PATRON_EMBED_MODEL || "Xenova/multilingual-e5-small";

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
