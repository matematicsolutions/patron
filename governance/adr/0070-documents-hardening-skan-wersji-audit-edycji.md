# ADR-0070: Hardening documents.ts - skan input-security nowej wersji + audit rozstrzygniecia edycji

**Status**: Wdrozony 2026-05-29 (H5 + H6 LIVE). Konstytucja v1.4.3.
**Data**: 2026-05-29
**Powiazane zasady**: Konstytucja AI Patrona Art. 5 (kontrola wejscia), Art. 3 (audytowalnosc),
AI Act art. 12 (record-keeping)
**Powiazane**: ADR-0055 (parytet skanu input-security - kanoniczny ingest), ADR-0019/0020
(pipeline input-security), ADR-0001 (hash-chain), ADR-0035 (migration infra), ADR-0060 (roundtrip docx)

## Kontekst

Audyt FAZA 0 wskazal 2 luki w `routes/documents.ts`:

- H5: `POST /:documentId/versions` ladowal nowa wersje wprost przez `uploadFile`, omijajac skan
  input-security (analyzeInput / resolveIngestOutcome). Regresja parytetu ADR-0055 - dokument z
  prompt injection / ukrytymi akcjami trafial do storage i podgladu/RAG bez flagi.
- H6: rozstrzygniecie tracked-change (accept/reject) nadpisywalo bajty dokumentu prawnego in-place
  bez zadnego zdarzenia w audit_log. Mutacja dokumentu bez sladu - naruszenie AI Act art. 12.

## Decyzja

### H5 - skan nowej wersji (parytet z kanonicznym ingestem)
Przed `uploadFile` w handlerze /versions: ekstrakcja tekstu (`extractPdfText` / `extractDocxBodyText`)
-> `analyzeInput` -> `resolveIngestOutcome` -> `appendAuditEvent(input_security_scan)`. Gdy skan
blokuje (`!outcome.persist`): bajty NIE trafiaja do storage, dokument dostaje `security_status`
blokujacy, odpowiedz 422 z raportem. Reuse tych samych funkcji co `lib/documentIngest.ts` (zero
kopii logiki, zgodnie z AGENTS.md). RAG-reindex wersji pozostaje poza zakresem (handler i tak nie
indeksowal).

### H6 - audit rozstrzygniecia tracked-change
Po nadpisaniu bajtow: `appendAuditEvent(document.edit_resolved)` z payloadem bez tresci dokumentu
(edit_id, change_id, mode accept/reject, version_id). Nowy typ przez migracje 008 (ALTER CHECK,
4 lustra enum).

ODSTEPSTWO od rekomendacji audytu (nowy row document_versions): handler CELOWO nadpisuje bajty
in-place, by uniknac version-churn (jeden row na edycje asystenta, nie na klik accept/reject -
komentarz w kodzie). Ta decyzja produktowa zostaje. Krytyczna luka H6 to brak SLADU AUDYTU (AI Act
art. 12), nie brak wersji - i ten slad dokladamy. Pelne wersjonowanie per-rozstrzygniecie (pelna
odtwarzalnosc bajtow przed/po) = opcja FAZA 1, swiadomie nie wymuszamy jej kosztem churn.

## Konsekwencje

- Obie sciezki uploadu (single/projekt/folder ORAZ nowa wersja) przechodza teraz skan input-security
  - domkniety parytet ADR-0055.
- Kazda mutacja dokumentu prawnego (upload, nowa wersja, accept/reject) ma slad w hash-chain.
- Reuse istniejacych, otestowanych funkcji - maly diff, brak nowej logiki bezpieczenstwa.

## Ograniczenia / dlug (FAZA 1)

- H6 nie tworzy nowej wersji per rozstrzygniecie - bajty sprzed accept/reject nie sa zachowane
  (decyzja anty-churn). Pelna odtwarzalnosc = opcja do rozwazenia (kosztem liczby wersji).
- Brak testow route-level (documents.ts nie ma harnessu supertest) - logika opiera sie na
  reuzytych, juz otestowanych funkcjach (analyzeInput / resolveIngestOutcome / appendAuditEvent).

## Status weryfikacji

- `tsc --noEmit` clean. Backend 787 testow pass (5 todo, bez regresji).
- Migracja 008 (document.edit_resolved, 4 lustra enum). Commit chirurgiczny.
