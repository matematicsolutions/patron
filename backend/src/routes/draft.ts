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

export const draftRouter = Router();

const VALID_STAGES = new Set<DefenseStage>(ALL_STAGES);
const VALID_MODES = new Set<AdwokatMode>([
  "strona-przeciwna",
  "sad",
  "prokurator",
]);

// POST /draft/refine
draftRouter.post("/refine", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { text, stages, adwokat_mode, model, context } = req.body as {
    text?: string;
    stages?: string[];
    adwokat_mode?: string;
    model?: string;
    context?: string;
  };
  if (!text || typeof text !== "string" || !text.trim()) {
    return void res.status(400).json({ detail: "text is required" });
  }

  const requestedStages = Array.isArray(stages)
    ? stages.filter((s): s is DefenseStage => VALID_STAGES.has(s as DefenseStage))
    : undefined;
  const mode =
    typeof adwokat_mode === "string" && VALID_MODES.has(adwokat_mode as AdwokatMode)
      ? (adwokat_mode as AdwokatMode)
      : undefined;

  const db = createServerSupabase();
  try {
    const apiKeys = await getUserApiKeys(userId, db);
    const selectedModel = resolveModel(model, DEFAULT_MAIN_MODEL);
    const result = await runDefensePipeline(text, {
      model: selectedModel,
      apiKeys,
      stages:
        requestedStages && requestedStages.length ? requestedStages : undefined,
      adwokatMode: mode,
      context: typeof context === "string" ? context : undefined,
    });
    res.json(result);
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
