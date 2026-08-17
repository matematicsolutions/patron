// Biblioteka umiejetnosci (ADR-0094) - endpoint REST.
//
//   GET    /skills            -> { builtin[], installed[] }
//   POST   /skills/import     -> { manifest } -> waliduje + utrwala paczke
//   PATCH  /skills/:id         -> { enabled, confirm_egress? } wlacz/wylacz
//   DELETE /skills/:id         -> usun zainstalowany skill
//
// Skille WBUDOWANE (etapy obrony) sa read-only: nie da sie ich wylaczyc ani
// usunac. Wlaczenie skilla deklarujacego egress do chmury (cloud-allowed)
// wymaga jawnej zgody (confirm_egress) - twarda bramka dwoch plaszczyzn egress.

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { validateManifest, BUILTIN_IDS } from "../lib/skills/manifest";
import { analyzeInput } from "../lib/input-security";
import {
  listSkills,
  importSkill,
  setSkillEnabled,
  removeSkill,
  getSkillRow,
} from "../lib/skills/store";

export const skillsRouter = Router();

// GET /skills
skillsRouter.get("/", requireAuth, async (_req, res) => {
  const db = createServerSupabase();
  try {
    const result = await listSkills(db);
    res.json(result);
  } catch (e) {
    res.status(500).json({ detail: `Nie udalo sie wczytac umiejetnosci: ${String(e)}` });
  }
});

// POST /skills/import
skillsRouter.post("/import", requireAuth, async (req, res) => {
  const { manifest } = req.body as { manifest?: unknown };
  if (manifest === undefined) {
    return void res.status(400).json({ detail: "Pole 'manifest' jest wymagane." });
  }
  const parsed = validateManifest(manifest);
  if (!parsed.ok) {
    return void res.status(400).json({ detail: parsed.error });
  }
  // Nie pozwol nadpisac wbudowanego skilla importem (kolizja id).
  if (BUILTIN_IDS.has(parsed.manifest.id)) {
    return void res.status(409).json({
      detail: `Identyfikator '${parsed.manifest.id}' jest zarezerwowany dla umiejetnosci wbudowanej.`,
    });
  }
  // Skan anty-injection promptu skilla (ADR-0094/0096, duch ADR-0019). Zlosliwy
  // prompt ("ignoruj poprzednie instrukcje...") nie wchodzi do biblioteki -
  // bramka przy imporcie jest silniejsza niz skan przy kazdym uruchomieniu.
  const scan = analyzeInput({
    text: `${parsed.manifest.prompt.system}\n${parsed.manifest.prompt.user}`,
    fileName: `skill:${parsed.manifest.id}`,
  });
  if (scan.action !== "allowed") {
    return void res.status(400).json({
      detail: `Paczka odrzucona przez skan bezpieczenstwa (poziom: ${scan.threatLevel}). Prompt zawiera podejrzane wzorce.`,
      security: { action: scan.action, threatLevel: scan.threatLevel },
    });
  }
  const db = createServerSupabase();
  try {
    const entry = await importSkill(db, parsed.manifest);
    res.status(201).json(entry);
  } catch (e) {
    res.status(500).json({ detail: `Import nie powiodl sie: ${String(e)}` });
  }
});

// PATCH /skills/:id  { enabled: boolean, confirm_egress?: boolean }
skillsRouter.patch("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  if (BUILTIN_IDS.has(id)) {
    return void res
      .status(403)
      .json({ detail: "Umiejetnosci wbudowanej nie mozna wylaczyc." });
  }
  const { enabled, confirm_egress } = req.body as {
    enabled?: boolean;
    confirm_egress?: boolean;
  };
  if (typeof enabled !== "boolean") {
    return void res.status(400).json({ detail: "Pole 'enabled' (boolean) jest wymagane." });
  }
  const db = createServerSupabase();
  try {
    const existing = await getSkillRow(db, id);
    if (!existing) {
      return void res.status(404).json({ detail: "Umiejetnosc nie znaleziona." });
    }
    // Twarda bramka egress: wlaczenie skilla z egress do chmury wymaga zgody.
    if (enabled && existing.manifest.egress === "cloud-allowed" && confirm_egress !== true) {
      return void res.status(409).json({
        detail:
          "Ta umiejetnosc moze wysylac tresc do chmury. Wymagana jawna zgoda (confirm_egress).",
        requires_egress_consent: true,
      });
    }
    const entry = await setSkillEnabled(db, id, enabled);
    res.json(entry);
  } catch (e) {
    res.status(500).json({ detail: `Zmiana stanu nie powiodla sie: ${String(e)}` });
  }
});

// DELETE /skills/:id
skillsRouter.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  if (BUILTIN_IDS.has(id)) {
    return void res
      .status(403)
      .json({ detail: "Umiejetnosci wbudowanej nie mozna usunac." });
  }
  const db = createServerSupabase();
  try {
    const removed = await removeSkill(db, id);
    if (!removed) {
      return void res.status(404).json({ detail: "Umiejetnosc nie znaleziona." });
    }
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ detail: `Usuniecie nie powiodlo sie: ${String(e)}` });
  }
});
