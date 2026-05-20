# ADR-0001: Audit trail z hash-chain SHA-256

**Status**: Accepted
**Data**: 2026-05-20
**Powiązane zasady**: Konstytucja AI Patrona, Art. 3 (audytowalność)

## Decyzja

Audit trail Patrona implementujemy jako **append-only ledger
z hash-chain SHA-256**. Każdy rekord w tabeli `audit_log` zawiera
pole `prev_hash` linkujące do hasha poprzedniego rekordu, oraz
własny `hash` policzony z deterministycznej konkatenacji
`prev_hash || canonical_json(ts, event_type, actor_user_id, chat_id, document_id, payload)`.

Genesis (pierwszy rekord): `prev_hash = "0".repeat(64)`.

## Kontekst

AI Act art. 12 wymaga record-keeping dla systemów AI wysokiego ryzyka,
a kancelarie potrzebują obiektywnego dowodu, że historia interakcji
z Patronem nie została zmodyfikowana retroaktywnie (np. żeby ukryć
halucynację albo niewłaściwą poradę).

Rozważane alternatywy:
1. **Zwykły log do tabeli bez hash-chain** — brak wykrywalności
   modyfikacji. Odrzucone: nie spełnia ducha record-keeping.
2. **Append-only z signed log (każdy wpis podpisywany kluczem
   prywatnym serwera)** — wymaga rotacji kluczy, większa złożoność
   operacyjna dla kancelarii. Odrzucone na rzecz prostszej hash-chain.
3. **Hash-chain SHA-256 (wybrana)** — minimalna złożoność, weryfikacja
   pełna w O(N) pamięcio-niezależnie, brak sekretów do zarządzania.

Wzorzec sprawdzony w domenie legal-tech (chiefofstaff-legal/donna,
patrz `memory/reference_kglf_lokalizacja.md` — ADR-001 KGLF).

## Konsekwencje

**Plusy**:
- Modyfikacja albo usunięcie środkowego wpisu psuje łańcuch
  i jest wykrywalna przez `npm run audit:verify` w sekundy.
- Brak sekretów do zarządzania (vs schemat z signed log).
- Deterministyczna serializacja (`canonicalJsonStringify`)
  niezależna od kolejności kluczy w JSON.

**Minusy / ograniczenia**:
- Race condition w wielowątkowym scenariuszu: dwa równoczesne
  `appendAuditEvent` mogą trafić na ten sam `prev_hash` →
  drugie dostaje unique-violation na `hash`. Mitigation: retry
  z pobraniem świeżego `prev_hash` (zaimplementowane w
  `appendAuditEvent`, 2 próby).
- Pole `payload` musi być małe — nie wkładamy tam pełnych
  treści dokumentów ani PII. Konwencja: tylko liczby, ID-y,
  enumy. Sprawdzane code review.
- Pełna weryfikacja O(N) — przy 1M wpisów to ~30 s. Akceptowalne
  dla offline audit (nie blokuje requestów).

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
      (planowane Tydzień 2 implementation playbook)
