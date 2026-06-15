# ADR-0065: Citation grounding - UI badge, persystencja werdyktu, audit summary

**Status**: Wdrozony 2026-05-29 (poziom 1 - dokumenty klienta). Konstytucja v1.3.4.
**Data**: 2026-05-29
**Powiązane zasady**: Konstytucja AI Patrona, Art. 2 (weryfikowalnosc),
Art. 5 (tajemnica zawodowa), Art. 12 AI Act (record-keeping)
**Powiązane**: ADR-0005 (mechaniczna weryfikacja cytatow - rdzen + wpiecie
backend), ADR-0006 (audit bundle), ADR-0001 (hash-chain audit)

## Decyzja

Domkniecie ADR-0005 poziom 1 o trzy warstwy widoczne dla prawnika i audytora:

1. **UI badge 3-stopniowy** w `AssistantMessage.tsx`. Znacznik cytatu `[N]`
   w prozie dostaje kolor wg werdyktu: zielony (`verified` - zweryfikowany w
   zrodle), bursztynowy (`unverified` - drobne roznice, sprawdz), czerwony
   (`blocked` - zrodlo nie potwierdza, potencjalna halucynacja). Status w
   tooltipie (i18n `citations.grounding*`). Brak werdyktu = neutralny szary
   (cytat MCP albo starszy czat sprzed groundingu).

2. **Persystencja werdyktu** na reload czatu. `extractAnnotations` dokleja
   `grounding` (decision) + `grounding_status` do `citation_data` zapisywanego
   w `chat_messages.annotations`. Badge przezywa odswiezenie - werdykt nie jest
   przeliczany ponownie (deterministyczny, ten sam wynik, ale zapis oszczedza
   ponownego odczytu dokumentu).

3. **Audit summary** w payloadzie istniejacego eventu `chat.message.assistant`
   (oba routy: `chat.ts`, `projectChat.ts`). Pole `grounding: {total, verified,
   unverified, blocked}` przez helper `groundingSummary`. Record-keeping AI Act
   art. 12 - dowod, ze weryfikacja zaszla i z jakim wynikiem.

**Decyzja produktowa (rezerwowana w ADR-0005):** werdykt `blocked` daje
**czerwona flage, NIE twardy blok renderu**. Prawnik widzi, ze Patron nie
potwierdzil cytatu, i sam decyduje. Uzasadnienie: mniej falszywych blokad
(cytat moze byc poprawny mimo braku zrodla - np. orzeczenie spoza SAOS), a
odpowiedzialnosc zawodowa zostaje przy prawniku (Art. 2 - weryfikowalnosc, nie
cenzura modelu).

## Odstepstwo od blueprintu ADR-0005

ADR-0005 zakladal **3 osobne event_type** audit (`citation.verified` /
`citation.unverified` / `citation.blocked`). Wybrano zamiast tego **jedno
podsumowanie w payloadzie `chat.message.assistant`**:

- Brak nowego event_type = brak migracji ALTER CHECK whitelist + 4 lustrzanych
  miejsc (schema.sql, migration, EVENT_TYPES, VALID_EVENT_TYPES) - mniej
  powierzchni, mniejsze ryzyko.
- Brak audit spam - jedna odpowiedz z 50 cytatami = 1 wpis z liczbami, nie 50.
- Grounding to deterministyczne post-przetwarzanie odpowiedzi LLM, ktora JUZ
  jest audytowana eventem `chat.message.assistant` - werdykt naturalnie nalezy
  do tego samego rekordu, nie osobnego.

Per-cytat decyzja (do reklamacji/dowodu) jest w `chat_messages.annotations`
(persystencja, punkt 2) - audit_log trzyma agregat, annotations trzymaja
szczegol. Audit bundle (ADR-0006) moze laczyc oba.

## Konsekwencje

### Plusy

- Prawnik widzi wiarygodnosc cytatu bez klikania (kolor w prozie)
- Audytor ma agregat weryfikacji w hash-chain (art. 12)
- Zero nowych zaleznosci npm, zero migracji, zero nowych endpointow
- Backward-compatible: starsze czaty (annotations bez `grounding`) renderuja
  sie neutralnie; event `citations` z polem `grounding` jest addytywny

### Minusy i ograniczenia

- Tylko poziom 1 (dokumenty klienta). Cytaty z orzeczen (SAOS) i przepisow
  (ISAP/EUR-Lex) renderuja sie neutralnie do czasu poziomow 2/3 (resolvery
  dopinane analogicznie - rezerwacja)
- Werdykt persystowany jako string w annotations - nie w osobnej tabeli
  `citation_verification` (blueprint ADR-0005). Wystarczajace dla poziomu 1;
  osobna tabela wroci jesli potrzebny bedzie query po werdyktach
- Brak twardego bloku przy `blocked` - swiadomy wybor (patrz Decyzja). Jezeli
  pilotaz pokaze, ze prawnicy ignoruja czerwona flage, rozwazyc opt-in twardy blok

### Wymagane MAJOR/MINOR konstytucji

- **Konstytucja v1.3.3 -> v1.3.4** - PATCH. Techniczne domkniecie ADR-0005
  (UI + persystencja + audit summary), bez zmiany kontraktow rol ani API.
  Pole `grounding` w evencie SSE i w annotations - addytywne. Payload audit
  rozszerzony o `grounding` summary - bez nowego event_type.

## Status weryfikacji

- [x] Typ `PATRONGroundingDecision` + pole `grounding` w `PATRONCitationAnnotation`
- [x] Handler SSE `citations` skleja mape `grounding` (ref -> decision) w cytaty
- [x] Reload: `grounding` przechodzi przez loader (zgodnosc nazwy pola)
- [x] `extractAnnotations` dokleja `grounding`/`grounding_status` do citation_data (+2 testy)
- [x] Badge 3-kolorowy w `AssistantMessage.tsx` + tooltip i18n
- [x] Klucze i18n `citations.groundingVerified/Unverified/Blocked` (pl.ts)
- [x] `groundingSummary` w payloadzie `chat.message.assistant` (chat.ts + projectChat.ts)
- [x] Backend 727/732 vitest pass, tsc clean (backend + frontend)
- [ ] Pilotaz: czy prawnicy reaguja na czerwona flage (decyzja o twardym bloku)
- [ ] Poziomy 2/3 (SAOS / ISAP-EUR-Lex) - osobne resolvery

## Licencja

Implementacja MateMatic od zera w powloce Patrona (AGPL-3.0). Wzorzec
architektoniczny groundingu: [AnttiHero/lavern](https://github.com/AnttiHero/lavern)
(Apache 2.0) - patrz THIRD_PARTY_INSPIRATIONS.md i ADR-0005.
