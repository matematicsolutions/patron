// Router REST API dla posture egress / data-residency (Faza 2 audytu Fable5).
//
// GET /api/config/egress zwraca read-only stan flag data-residency, ktore na
// desktopie ustawia instalator (ADR-0101): czy model chmurowy jest dozwolony dla
// spraw objetych tajemnica (PATRON_ALLOW_PRIVILEGED_CLOUD) i czy dozwoleni sa
// dostawcy US (ALLOW_US_PROVIDERS). Cel: "swiadoma zgoda Operatora" ma byc
// FAKTYCZNIE widoczna dla pracujacego prawnika (ryzyko #2 audytu), a nie tylko
// zaszyta w env i ADR.
//
// Read-only, bez PII - same booleany. requireAuth: kazdy uzytkownik widzi gdzie
// moga trafic dane JEGO spraw (na desktopie single-user to Operator). Nazwa modelu
// lokalnego NIE jest eksponowana - tylko bool, czy zastepczy model jest ustawiony.
//
// Wpiety w index.ts -> app.use("/api/config", configRouter).

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import {
  allowUsProviders,
  allowPrivilegedCloud,
  defaultLocalModel,
} from "../lib/routing/guard";

export const configRouter = Router();

export interface EgressConfigPayload {
  /** ALLOW_US_PROVIDERS - transfer poza EOG (dostawcy US) dozwolony. */
  us_providers: { allowed: boolean };
  /** PATRON_ALLOW_PRIVILEGED_CLOUD - model chmurowy dla spraw objetych tajemnica. */
  privileged_cloud: { allowed: boolean };
  /** Czy skonfigurowano model lokalny (no-egress) jako zastepczy. */
  local_model_configured: boolean;
}

/**
 * Sklada posture egress z czystych czytnikow flag (guard.ts). Pure function -
 * testowalna z env mock, bez IO, bez PII (same booleany; nazwa modelu lokalnego
 * NIE wchodzi do payloadu).
 */
export function buildEgressConfigPayload(): EgressConfigPayload {
  return {
    us_providers: { allowed: allowUsProviders() },
    privileged_cloud: { allowed: allowPrivilegedCloud() },
    local_model_configured: defaultLocalModel() !== null,
  };
}

/**
 * GET /api/config/egress
 *   200 - EgressConfigPayload (read-only, bez PII)
 *   401 - brak/niepoprawny JWT (requireAuth)
 * Dziala offline (czyta tylko env) - Konstytucja Art. 1 lokalnosc.
 */
configRouter.get(
  "/egress",
  requireAuth,
  (_req: Request, res: Response): void => {
    res.status(200).json(buildEgressConfigPayload());
  },
);
