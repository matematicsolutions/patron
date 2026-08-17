// Test pure helper payloadu audytowego rodo.delete (route rodo.ts).
//
// Integration test endpointu (Express + Supabase) = rezerwacja - brak supertest
// w stosie (Konstytucja Art. 4, ADR-0042). Tu gwarantujemy KONTRAKT payloadu
// zdarzenia rodo.delete: project_id + liczniki z raportu, ZERO PII pelnotekstowego.

import { describe, it, expect } from "vitest";

import { buildRodoDeleteAuditPayload } from "./rodo";
import type { ForgetReport } from "../lib/rodo/forget";

const report: ForgetReport = {
  projectId: "p1",
  documents: 3,
  chats: 2,
  tabularReviews: 1,
  ragCleared: 3,
  storageFilesDeleted: 4,
  brainCleared: true,
};

describe("buildRodoDeleteAuditPayload", () => {
  it("mapuje liczniki raportu kasacji na payload audytowy", () => {
    expect(buildRodoDeleteAuditPayload("p1", report)).toEqual({
      project_id: "p1",
      documents: 3,
      chats: 2,
      tabular_reviews: 1,
      rag_cleared: 3,
      storage_files_deleted: 4,
      brain_cleared: true,
    });
  });

  it("payload zawiera WYLACZNIE dozwolone klucze (zero PII)", () => {
    const keys = Object.keys(buildRodoDeleteAuditPayload("p1", report)).sort();
    expect(keys).toEqual(
      [
        "brain_cleared",
        "chats",
        "documents",
        "project_id",
        "rag_cleared",
        "storage_files_deleted",
        "tabular_reviews",
      ].sort(),
    );
  });

  it("wszystkie wartosci to liczby/bool/id - nic pelnotekstowego", () => {
    for (const v of Object.values(buildRodoDeleteAuditPayload("p1", report))) {
      expect(["number", "boolean", "string"]).toContain(typeof v);
    }
  });
});
