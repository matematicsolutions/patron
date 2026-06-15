// Router panelu "Stan systemu" (audyt P3 #17 / Propozycja #3 + Raport CTO sek. G).
//
// Jeden endpoint zdrowia: warstwa wektorowa on/off, OCR on/off, model+wymiar
// embeddera, status kluczy API (per provider + zrodlo), zgody chmurowe (env),
// saldo kredytow OpenRouter. Koniec z "nie wiadomo, czemu nie dziala" (realny
// incydent: ujemne saldo OpenRouter bez sygnalu). READ-ONLY, nic nie zapisuje.
//
// Autoryzacja: requireAuth + requireAdmin (parytet z usage/audit - status niesie
// info o konfiguracji; desktop single-user: operator = admin). Saldo OpenRouter
// liczone best-effort (null gdy brak klucza / blad / timeout) - panel sie nie
// wywraca od niedostepnego dostawcy.

import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { createServerSupabase, isSqliteBackend } from "../lib/supabase";
import { isVecEnabled, getDb } from "../lib/db/sqlite-connection";
import { isOcrConfigured } from "../lib/convert/ocrRunner";
import { getUserApiKeyStatus } from "../lib/userApiKeys";
import { getOpenRouterCredits } from "../lib/llm/openrouter";
import { allowUsProviders, allowPrivilegedCloud } from "../lib/routing/guard";

export const healthRouter = Router();

export interface SystemConsents {
  privilegedCloud: boolean;
  usProviders: boolean;
  pseudonimEgress: boolean;
  ragCrossCase: boolean;
}

/**
 * Zgody/przelaczniki operacyjne z env (dzis; P2 #6 przeniesie chmurowe do UI
 * per-sprawa). privilegedCloud/usProviders przez gettery guard.ts (single source
 * of truth z brama egress). Czysta - tylko czyta env.
 */
export function readConsents(): SystemConsents {
  return {
    privilegedCloud: allowPrivilegedCloud(),
    usProviders: allowUsProviders(),
    // Maskowanie PII przed chmura (ADR-0067/0110) - domyslnie ON.
    pseudonimEgress: process.env.PATRON_PSEUDONIM_EGRESS !== "false",
    // Przekrojowe wyszukiwanie RAG miedzy sprawami (ADR-0111) - domyslnie OFF.
    ragCrossCase: process.env.PATRON_RAG_CROSS_CASE === "true",
  };
}

/** Skladniki migawki stanu (wejscie czyste, bez I/O). */
export interface StatusParts {
  vectorEnabled: boolean;
  ocrConfigured: boolean;
  embedderModel: string | null;
  embedderDim: string | null;
  apiKeys: unknown;
  consents: SystemConsents;
  openrouterConfigured: boolean;
  credits: { totalCredits: number; totalUsage: number; balance: number } | null;
}

/**
 * Sklada payload panelu stanu z gotowych skladnikow (czysta, testowalna). Pole
 * `depleted` = wczesny sygnal wyczerpania kredytow OpenRouter (realny incydent);
 * null gdy salda nie udalo sie pobrac.
 */
export function buildStatusPayload(p: StatusParts) {
  return {
    ok: true,
    vector: { enabled: p.vectorEnabled },
    ocr: { configured: p.ocrConfigured },
    embedder: { model: p.embedderModel, dim: p.embedderDim },
    apiKeys: p.apiKeys,
    consents: p.consents,
    openrouter: {
      configured: p.openrouterConfigured,
      credits: p.credits,
      depleted: p.credits ? p.credits.balance <= 0 : null,
    },
  };
}

/** Odczyt metadanej retrievalu (model/wymiar embeddera). null poza sqlite/bledzie. */
function readRetrievalMeta(key: string): string | null {
  if (!isSqliteBackend()) return null;
  try {
    const row = getDb()
      .prepare("select value from retrieval_meta where key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

// GET /health - migawka stanu systemu (admin).
healthRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();

  let apiKeys: Awaited<ReturnType<typeof getUserApiKeyStatus>> | null = null;
  try {
    apiKeys = await getUserApiKeyStatus(userId, db);
  } catch {
    apiKeys = null;
  }

  // Saldo OpenRouter tylko gdy klucz skonfigurowany (env lub user). Best-effort.
  const openrouterConfigured = apiKeys?.openrouter ?? false;
  const credits = openrouterConfigured ? await getOpenRouterCredits() : null;

  res.json(
    buildStatusPayload({
      vectorEnabled: isVecEnabled(),
      ocrConfigured: isOcrConfigured(),
      embedderModel: readRetrievalMeta("embed_model"),
      embedderDim: readRetrievalMeta("embed_dim"),
      apiKeys,
      consents: readConsents(),
      openrouterConfigured,
      credits,
    }),
  );
});
