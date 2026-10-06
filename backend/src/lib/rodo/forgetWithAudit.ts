// Wspolna sciezka kasacji sprawy dla obu wejsc: POST /rodo/forget-case
// (routes/rodo.ts) i DELETE /projects/:id (routes/projects.ts) - forgetCase
// (ADR-0061) + slad w hash-chain + werdykt HTTP. Jedno miejsce, zeby oba wejscia
// nie rozjechaly sie w tym, co uznaja za sukces (audyt 2026-09, D-03/D-04).

import { createServerSupabase } from "../supabase";
import { appendAuditEvent } from "../audit";
import { forgetCase, type ForgetReport } from "./forget";

/**
 * Buduje payload audytowy dla zdarzenia rodo.delete. Czysta funkcja (testowalna
 * bez Express/Supabase - wzorzec security.ts buildStatusPayload). Bez PII:
 * wylacznie project_id + liczniki z raportu kasacji + kroki, ktore sie nie
 * udaly (nazwy krokow, bez kluczy storage i bez tresci).
 */
export function buildRodoDeleteAuditPayload(
  projectId: string,
  report: ForgetReport,
): Record<string, unknown> {
  return {
    project_id: projectId,
    complete: report.complete,
    documents: report.documents,
    chats: report.chats,
    linked_chats: report.linkedChats,
    linked_chats_other_cases_kept: report.linkedChatsOtherCases,
    tabular_reviews: report.tabularReviews,
    tabular_reviews_pruned: report.tabularReviewsPruned,
    approval_cards: report.approvalCards,
    rag_cleared: report.ragCleared,
    storage_files_deleted: report.storageFilesDeleted,
    brain_cleared: report.brainCleared,
    failures: report.failures.length,
    failed_steps: [...new Set(report.failures.map((f) => f.step))].join(","),
  };
}

export interface ForgetOutcome {
  /** Status HTTP: 200 przy pelnym sukcesie, 500 przy porazce czesciowej. */
  status: number;
  body: Record<string, unknown>;
}

/**
 * Wspolna sciezka obu wejsc kasacji sprawy (POST /rodo/forget-case i
 * DELETE /projects/:id): forgetCase + slad w hash-chain + werdykt HTTP.
 *
 * D-03/D-04: porazka czesciowa (plik zablokowany, blad zapisu bazy) i nieudany
 * zapis sladu w audit_log NIE sa cichym sukcesem - status 500 z raportem
 * (co faktycznie usunieto) i lista niepowodzen, ktora UI moze pokazac.
 */
export async function forgetCaseWithAudit(
  db: ReturnType<typeof createServerSupabase>,
  projectId: string,
  userId: string,
): Promise<ForgetOutcome> {
  const report = await forgetCase(projectId, db);
  // Slad kasacji RODO art. 17 w hash-chain (AI Act art. 12) - takze nieudanej
  // albo czesciowej proby. forget.ts celowo NIE tyka audit_log (naglowek modulu).
  const audit = await appendAuditEvent(db, {
    event_type: "rodo.delete",
    actor_user_id: userId,
    payload: buildRodoDeleteAuditPayload(projectId, report),
  });
  if (!report.complete) {
    return {
      status: 500,
      body: {
        detail:
          "Kasacja sprawy niekompletna - czesc danych nie zostala usunieta. " +
          "Sprawa pozostaje na liscie; usun przyczyne (np. zamknij program, " +
          "ktory trzyma plik) i ponow.",
        ...report,
        audit_recorded: audit.ok,
      },
    };
  }
  if (!audit.ok) {
    return {
      status: 500,
      body: {
        detail:
          "Sprawa usunieta, ale nie udalo sie zapisac sladu kasacji w dzienniku " +
          "audytowym. Zglos to administratorowi.",
        ...report,
        audit_recorded: false,
      },
    };
  }
  return { status: 200, body: { ...report, audit_recorded: true } };
}

