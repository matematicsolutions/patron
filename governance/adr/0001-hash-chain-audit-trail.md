# ADR-0001: Audit trail z hash-chain SHA-256

**Status**: Przyjęty
**Data**: 2026-05-20
**Powiązane zasady**: Konstytucja AI Patrona, Art. 3 (audytowalność)

## Decyzja

Audit trail Patrona implementujemy jako **append-only ledger
z hash-chain SHA-256**. Każdy rekord w tabeli `audit_log` ma pole
`prev_hash` wskazujące hash poprzedniego rekordu oraz własny `hash`
policzony z deterministycznej konkatenacji
`prev_hash || canonical_json(ts, event_type, actor_user_id, chat_id, document_id, payload)`.

Genesis (pierwszy rekord): `prev_hash = "0".repeat(64)`.

## Kontekst

AI Act art. 12 wymaga record-keeping dla systemów AI wysokiego ryzyka,
a kancelarie potrzebują dowodu, że historia interakcji z Patronem
nie została zmieniona po fakcie (np. żeby ukryć halucynację albo
nietrafioną poradę).

Rozważane alternatywy:
1. **Zwykły log do tabeli bez hash-chain** - nie wykrywa modyfikacji.
   Odrzucone: nie spełnia wymogu record-keeping z art. 12.
2. **Append-only z signed log (każdy wpis podpisywany kluczem
   prywatnym serwera)** - wymaga rotacji kluczy i obciąża operacyjnie
   kancelarie. Odrzucone na rzecz prostszej hash-chain.
3. **Hash-chain SHA-256 (wybrana)** - prosta w implementacji, weryfikacja
   liniowa O(N) bez trzymania całego łańcucha w pamięci, brak sekretów
   do zarządzania.

Ten sam wzorzec stosuje chiefofstaff-legal/donna w domenie legal-tech
(patrz `memory/reference_kglf_lokalizacja.md` - ADR-001 KGLF).

## Konsekwencje

**Plusy**:
- Modyfikacja albo usunięcie środkowego wpisu rozrywa łańcuch,
  a `npm run audit:verify` wykrywa to w sekundy.
- Nie ma sekretów do zarządzania (w przeciwieństwie do signed log).
- Serializacja deterministyczna (`canonicalJsonStringify`),
  niezależna od kolejności kluczy w JSON.

**Minusy i ograniczenia**:
- Race condition przy współbieżnym zapisie: dwa równoczesne
  `appendAuditEvent` mogą trafić na ten sam `prev_hash`,
  wtedy drugie dostaje unique-violation na `hash`. Obejście:
  ponawiamy z pobraniem świeżego `prev_hash` (zaimplementowane
  w `appendAuditEvent`, 2 próby).
- Pole `payload` musi być małe - nie wkładamy tam pełnych
  treści dokumentów ani PII. Trzymamy tylko liczby, ID-y i enumy,
  pilnujemy tego na code review.
- Weryfikacja całego łańcucha to O(N), czyli przy 1M wpisów około
  30 sekund. Dla audytu offline to wystarcza, nie blokuje requestów.

## Implementacja

- Schema: `backend/schema.sql` (sekcja audit_log).
- Helper: `backend/src/lib/audit.ts`
  (`computeAuditHash`, `appendAuditEvent`, `canonicalJsonStringify`).
- Weryfikator: `backend/scripts/verify-audit-chain.ts`.
- Skrypt npm: `npm run audit:verify`.
- Testy: `backend/src/lib/audit.test.ts` (18 testów, 4 scenariusze ataku).
- Wpinanie: `backend/src/routes/chat.ts` + `routes/projectChat.ts`
  (po insert do `chat_messages`, `void appendAuditEvent`).

## Status weryfikacji

- [x] Test deterministic hash (3 testy)
- [x] Test 4 scenariusze ataku (modyfikacja payload, usunięcie wpisu,
      podmiana hash, reorder)
- [x] Weryfikator CLI smoke-tested na pustej bazie (return OK,
      verified 0 wpisów)
- [ ] Weryfikator end-to-end po pierwszych zapytaniach produkcyjnych
      (planowane na Tydzień 2 wdrożenia)
