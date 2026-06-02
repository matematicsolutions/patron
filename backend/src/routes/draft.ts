// Pipeline obrony (Invisible AI, ADR-0058) - endpoint REST.
// POST /draft/refine { text, stages?, adwokat_mode?, model? }
// Przepuszcza draft przez lancuch Recenzent -> Adwokat diabla -> Pisz po ludzku.

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { singleFileUpload } from "../lib/upload";
import { parseDocxRoundtrip } from "../lib/docxRoundtrip";
import { createServerSupabase } from "../lib/supabase";
import { getUserApiKeys } from "../lib/userApiKeys";
import { DEFAULT_MAIN_MODEL, resolveModel } from "../lib/llm";
import {
  ALL_STAGES,
  runDefensePipeline,
  type AdwokatMode,
  type DefenseStage,
} from "../lib/pipeline/defense";
import { loadEnabledDraftStageSkills } from "../lib/skills/store";
import { appendAuditEvent } from "../lib/audit";
import { enforceEgressGuard, appendLlmRouteEvent } from "../lib/routing";
import {
  classifyHighStakes,
  configFromEnv,
  type DocumentType,
} from "../lib/highstakes";

export const draftRouter = Router();

// H13 (ADR-0068): limit rozmiaru draftu. Pipeline robi 3 wywolania LLM po
// maxTokens 8000 - bez limitu (tylko express.json 50MB) jeden request = kilkanascie
// mln tokenow na drogich modelach. ~100k znakow to dlugie pismo procesowe.
const MAX_DRAFT_CHARS = 100_000;

const VALID_DOC_TYPES = new Set<DocumentType>([
  "opinia",
  "umowa_M&A",
  "umowa_DD",
  "umowa_finansowa",
  "umowa_handlowa",
  "pismo_procesowe",
  "notatka",
  "research",
  "inny",
]);

const VALID_STAGES = new Set<DefenseStage>(ALL_STAGES);
const VALID_MODES = new Set<AdwokatMode>([
  "strona-przeciwna",
  "sad",
  "prokurator",
]);

// POST /draft/refine
draftRouter.post("/refine", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { text, stages, adwokat_mode, model, context, document_type, cm_value, explicit_high_stakes, project_id } =
    req.body as {
      text?: string;
      stages?: string[];
      adwokat_mode?: string;
      model?: string;
      context?: string;
      document_type?: string;
      cm_value?: number;
      explicit_high_stakes?: boolean;
      project_id?: string;
    };
  if (!text || typeof text !== "string" || !text.trim()) {
    return void res.status(400).json({ detail: "text is required" });
  }
  // H13: limit rozmiaru draftu (DoS / koszt LLM).
  if (text.length > MAX_DRAFT_CHARS) {
    return void res.status(400).json({
      detail: `text przekracza limit ${MAX_DRAFT_CHARS} znakow (${text.length})`,
    });
  }

  const requestedStages = Array.isArray(stages)
    ? stages.filter((s): s is DefenseStage => VALID_STAGES.has(s as DefenseStage))
    : undefined;
  const mode =
    typeof adwokat_mode === "string" && VALID_MODES.has(adwokat_mode as AdwokatMode)
      ? (adwokat_mode as AdwokatMode)
      : undefined;

  // H10: klasyfikator high-stakes wpiety jako brama minimalna (dotad martwy kod).
  // Wynik trafia do audit_log - sygnal "to pismo zasluguje na debate/eskalacje".
  const docType =
    typeof document_type === "string" && VALID_DOC_TYPES.has(document_type as DocumentType)
      ? (document_type as DocumentType)
      : undefined;
  const highStakes = classifyHighStakes(
    {
      documentType: docType,
      projectCmValue: typeof cm_value === "number" ? cm_value : undefined,
      explicitFlag: explicit_high_stakes === true,
    },
    configFromEnv(process.env),
  );

  const db = createServerSupabase();
  const startedAt = Date.now();
  try {
    const apiKeys = await getUserApiKeys(userId, db);
    const selectedModel = resolveModel(model, DEFAULT_MAIN_MODEL);
    const effectiveStages =
      requestedStages && requestedStages.length ? requestedStages : ALL_STAGES;

    // ADR-0067 (domkniecie luki): pipeline obrony robi do 3 wywolan LLM - musi
    // przejsc przez TEN SAM straznik data-residency co czat (enforceEgressGuard).
    // Dotad /draft/refine egressowal bez tego straznika (tylko maskowanie PII),
    // wiec tresc sprawy objetej tajemnica mogla wyjsc do chmury. Blok = audyt
    // "llm_route" (block) robi helper; tu zwracamy 403 z komunikatem PL.
    const projectId =
      typeof project_id === "string" && project_id.trim() ? project_id : null;
    const guard = await enforceEgressGuard({
      db,
      model: selectedModel,
      projectId,
      actorUserId: userId,
    });
    if (!guard.allowed) {
      return void res.status(403).json({
        detail:
          guard.blockMessage ??
          "Routing zablokowany przez polityke data-residency.",
        code: "egress_blocked",
        suggestedModel: guard.suggestedModel ?? null,
      });
    }

    // Wlaczone skille z paczek (surface draft-stage) - po wbudowanych etapach.
    const customStages = await loadEnabledDraftStageSkills(db);
    const result = await runDefensePipeline(text, {
      model: selectedModel,
      apiKeys,
      stages: effectiveStages,
      adwokatMode: mode,
      context: typeof context === "string" ? context : undefined,
      customStages,
    });
    // H11: per-call audit pipeline obrony. Payload bez tresci draftu - tylko
    // metadane (kto/kiedy/etapy/model/klasyfikacja/dlugosci/czas). AI Act art. 12.
    await appendAuditEvent(db, {
      event_type: "defense.pipeline.run",
      actor_user_id: userId,
      payload: {
        model: selectedModel,
        classification: guard.decision.classification,
        egress: guard.decision.egress,
        stages: effectiveStages,
        custom_skills: customStages.map((s) => s.id),
        adwokat_mode: mode ?? null,
        document_type: docType ?? null,
        high_stakes: highStakes.isHighStakes,
        high_stakes_reasons: highStakes.reasons,
        applied_threshold: highStakes.appliedThreshold,
        text_len: text.length,
        final_len: result.final.length,
        duration_ms: Date.now() - startedAt,
      },
    });
    // ADR-0067: audyt "llm_route" (allow) po zakonczeniu - parytet z czatem
    // (stream.ts), ten sam dowod data-residency dla AI Act art. 12.
    await appendLlmRouteEvent(db, {
      actorUserId: userId,
      caseId: projectId,
      model: selectedModel,
      provider: guard.provider,
      egress: guard.decision.egress,
      classification: guard.decision.classification,
      action: "allow",
      reason: guard.decision.reason,
      latencyMs: Date.now() - startedAt,
    });
    res.json({ ...result, highStakes });
  } catch (e) {
    res
      .status(500)
      .json({ detail: `Draft refine failed: ${String(e)}` });
  }
});

// POST /draft/roundtrip - parsuje edytowany DOCX wracajacy z Worda (ADR-0060):
// tracked changes (czego uczy sie Bibliotekarz) + komentarze + instrukcje
// [PATRON: ...]. Multipart: pole "file".
draftRouter.post(
  "/roundtrip",
  requireAuth,
  singleFileUpload("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) return void res.status(400).json({ detail: "file is required" });
    try {
      const result = await parseDocxRoundtrip(file.buffer);
      res.json(result);
    } catch (e) {
      res
        .status(500)
        .json({ detail: `Roundtrip parse failed: ${String(e)}` });
    }
  },
);
