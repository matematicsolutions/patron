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
  complete: true,
  documents: 3,
  chats: 2,
  linkedChats: 1,
  linkedChatsOtherCases: 0,
  tabularReviews: 1,
  tabularReviewsPruned: 1,
  approvalCards: 2,
  ragCleared: 3,
  storageFilesDeleted: 4,
  brainCleared: true,
  failures: [],
};

describe("buildRodoDeleteAuditPayload", () => {
  it("mapuje liczniki raportu kasacji na payload audytowy", () => {
    expect(buildRodoDeleteAuditPayload("p1", report)).toEqual({
      project_id: "p1",
      complete: true,
      documents: 3,
      chats: 2,
      linked_chats: 1,
      linked_chats_other_cases_kept: 0,
      tabular_reviews: 1,
      tabular_reviews_pruned: 1,
      approval_cards: 2,
      rag_cleared: 3,
      storage_files_deleted: 4,
      brain_cleared: true,
      failures: 0,
      failed_steps: "",
    });
  });

  it("payload zawiera WYLACZNIE dozwolone klucze (zero PII)", () => {
    const keys = Object.keys(buildRodoDeleteAuditPayload("p1", report)).sort();
    expect(keys).toEqual(
      [
        "approval_cards",
        "brain_cleared",
        "chats",
        "complete",
        "documents",
        "failed_steps",
        "failures",
        "linked_chats",
        "linked_chats_other_cases_kept",
        "project_id",
        "rag_cleared",
        "storage_files_deleted",
        "tabular_reviews",
        "tabular_reviews_pruned",
      ].sort(),
    );
  });

  it("wszystkie wartosci to liczby/bool/id - nic pelnotekstowego", () => {
    for (const v of Object.values(buildRodoDeleteAuditPayload("p1", report))) {
      expect(["number", "boolean", "string"]).toContain(typeof v);
    }
  });

  it("porazka czesciowa: do audytu ida nazwy krokow, nie klucze storage ani komunikaty", () => {
    const partial: ForgetReport = {
      ...report,
      complete: false,
      failures: [
        { step: "storage", error: "EBUSY", key: "documents/u1/d1/source.docx" },
        { step: "storage", error: "EPERM", key: "documents/u1/d2/source.docx" },
        { step: "chats", error: "SQLITE_BUSY" },
      ],
    };
    const payload = buildRodoDeleteAuditPayload("p1", partial);
    expect(payload.complete).toBe(false);
    expect(payload.failures).toBe(3);
    expect(payload.failed_steps).toBe("storage,chats");
    expect(JSON.stringify(payload)).not.toContain("documents/u1");
  });
});
