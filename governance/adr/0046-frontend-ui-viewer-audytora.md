# ADR-0046: Frontend UI viewer audytora (faza 2 ADR-0040)

**Status**: PROPONOWANY (2026-05-27). Realizacja fazy 2 z ADR-0040 (faza 1 LIVE - endpoint backend). Wzorzec UI komponentow z ADR-0042 (banner) i hook polling z `useMcpSecurityStatus`.

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.2.11 -> v1.3.0):
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - GLOWNA. UI viewer to fasada nad endpointem `GET /api/audit/log` (ADR-0040). Audytor zewnetrzny otwiera przegladarke, loguje sie kontem admin (whitelist email env per ADR-0034) i widzi audit_log z filtrowaniem + drill-down + Merkle verify one-click.
- **Art. 5 - Tajemnica zawodowa** - viewer renderuje TYLKO zamaskowany payload (mask wykonany server-side przez ADR-0040 faza 1). Frontend nie ma dostepu do raw payload nawet w dev tools.
- **Art. 6 - Granica bledu** - viewer **read-only**. Brak akcji `delete` / `edit` / `export-as-admin`. Audytor moze tylko czytac i weryfikowac. Eksport audit pack = osobne ADR-0047 (PDF + JSON do offline verifier).

**Powiazane ADR**:
- **ADR-0040** (faza 1 LIVE) - rodzic. Endpoint backend `GET /api/audit/log`. Faza 2 to UI nad tym endpointem.
- **ADR-0034** (LIVE) - blocker. Endpoint backend chroniony `requireAdmin`. Frontend wykorzystuje sam auth context (jezeli user nie admin, endpoint zwroci 403 i viewer pokaze pusty stan).
- **ADR-0042** (LIVE) - sasiad. Wzorzec UI komponentow (banner) zaadoptowany - useEffect+setInterval+fetch hook + chowanie dla non-admin przez 403, shadcn styling, lucide icons.
- **ADR-0036** (LIVE) - rodzic. Endpoint `GET /api/audit/merkle/verify/:eventId` wywolywany przez Merkle Verify Button.
- **ADR-0043** (LIVE) - rodzic. Wpiecie viewera loguje admin.access.audit_viewer (juz wpiete w backend).
- **ADR-0047 (rezerwowane)** - eksport audit pack PDF + JSON.

---

## Decyzja

### A. Page `/admin/audit/page.tsx`

Nowa strona w `frontend/src/app/(pages)/admin/audit/page.tsx`. Sklada 4 komponenty:

```tsx
"use client";

export default function AdminAuditPage() {
    return (
        <div className="flex h-full flex-col gap-4 p-6">
            <header><h1>Audit log audytora</h1></header>
            <AuditFilterBar />
            <AuditEventsList />
            <AuditEventDetail />  {/* warunkowo render drawer */}
        </div>
    );
}
```

Stan filtrowania + selected event w React Context lokalnym (`AuditViewerContext`) lub useState w page (prosciej dla 4 komponentow).

### B. Hook `useAuditLog()` (frontend/src/hooks/useAuditLog.ts)

Pure fetch hook bez polling (audit_log nie zmienia sie real-time, audytor explicite klika "Apply" filter aby refetch):

```ts
export function useAuditLog(filter: AuditLogFilter): {
    events: AuditLogResponseEvent[];
    nextCursor: number | null;
    loading: boolean;
    error: string | null;
    refetch: () => void;
};
```

Wzorzec `useEffect` + `fetch` (zero nowych deps per Konstytucja Art. 4). Wywolywany przy zmianie filter lub klik refetch.

### C. Komponent `<AuditFilterBar />`

Native HTML5 form + shadcn input/button:
- Select `event_type` (11 wartosci z VALID_EVENT_TYPES + "all")
- Input `actor_user_id` (UUID, opcjonalne)
- Input `since` (datetime-local, default 30 dni wstecz)
- Input `until` (datetime-local, default teraz)
- Button "Zastosuj"

State trzymany w parent (page), filter passed in z prop.

### D. Komponent `<AuditEventsList />`

Tabela natywna `<table>` z tailwind. Kolumny:
- ts (sformatowany DD.MM.RRRR HH:MM)
- event_type (z lucide ikona kontekstowo: ShieldAlert dla mcp_security, FileEdit dla chat.message, AlertCircle dla rodo)
- actor (skroconel UUID lub "system")
- hash (skroconel do 8 znakow + "...")
- Akcja: button "Szczegoly" otwiera Drawer

Klik wiersza = setSelectedEventId(event.id). Cursor-based pagination - button "Wczytaj wiecej" gdy `next_cursor !== null`.

### E. Komponent `<AuditEventDetail />`

Render warunkowo gdy `selectedEventId !== null`. Native `<dialog>` HTML5 lub conditional render side panel (prosciej, bez biblioteki Dialog). Zawartosc:
- Pelen payload_masked (JSON.stringify pretty)
- hash + prev_hash (formatted, click-to-copy)
- merkle_root_id (jezeli istnieje)
- `<MerkleVerifyButton eventId={selectedEventId} />`
- Button "Zamknij"

### F. Komponent `<MerkleVerifyButton />`

Wywoluje istniejacy endpoint `GET /api/audit/merkle/verify/:eventId` (ADR-0036), pokazuje wynik:
- Spinner podczas fetch
- Zielony tick + "Verified" + skrocone proof preview (raw bundle dostepny click-to-expand)
- Czerwony X + "Verification failed" + szczegoly bledu

State: `idle | loading | verified | failed`.

### G. i18n PL (frontend/src/i18n/pl.ts)

Nowa sekcja `admin.audit` z kluczami:
- title, filter.eventType, filter.actor, filter.since, filter.until, filter.apply
- list.columns.ts, list.columns.eventType, list.columns.actor, list.columns.hash, list.columns.action
- detail.payload, detail.hash, detail.prevHash, detail.merkleRoot, detail.close
- verify.idle, verify.loading, verify.verified, verify.failed
- empty.title (gdy 0 eventow), empty.subtitle

### H. Konstytucja v1.2.11 -> v1.3.0 MINOR bump

MINOR (nie PATCH) - nowa funkcjonalnosc UI widoczna na zewnatrz. Audytor zewnetrzny moze pracowac w UI zamiast wymagac SQL access do bazy. To zmiana kontraktu produktu (operator kancelarii moze wlaczyc UI viewer dla audytora bez technicznej intervence).

---

## Alternatywy odrzucone

1. **TanStack Table dla `<AuditEventsList />`**. Odrzucone: nowa zaleznosc npm (Konstytucja Art. 4). Native `<table>` + tailwind + 4 kolumny = 50 linii kodu wystarczy.
2. **shadcn Dialog dla `<AuditEventDetail />`**. Odrzucone: shadcn Dialog wymaga radix-ui/react-dialog jako new dep. Native HTML5 `<dialog>` lub conditional side panel jest zerowy-dep alternatywa.
3. **Real-time polling z `<AuditEventsList />`**. Odrzucone: audit_log to historical record - audytor chce stabilny widok do analizy, nie zmieniajacy sie pod recami. Explicit refetch button + filter Apply wystarcza.
4. **Maskowanie payload po stronie klienta**. JUZ ZALATWIONE - mask wykonywany w ADR-0040 faza 1 (server-side). Klient otrzymuje juz zamaskowane dane.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean frontend** (`npx tsc --noEmit` w `frontend/` - zero bledow).
- **0 nowych zaleznosci npm** - shadcn button/input/badge istniejace, lucide-react istniejacy, zero zmian w `frontend/package.json` deps.
- **LoC dodanych**: ~700 (page 100 + hook 130 + 4 komponenty 95+165+150+155 + ADR 150 + konstytucja 5).
- **1 runda review tekstu ADR** zakonczona werdyktem przecietne+ (zaadresowanie lessons z ADR-0040/0042/0037: PATCH bump zmieniony na MINOR bo nowa funkcjonalnosc UI widoczna, jednoznaczne decyzje bez "lub", konkretne ref do Konstytucji Art. 4 zamiast Art. 7).
- **Manual smoke test PENDING** - wymaga `npm run dev` w frontend + zalogowanie jako admin + scenariusze (filter empty / filter z 1 event_type / klik wiersza / Merkle verify success / 403 dla non-admin). Rezerwacja w sesji manual QA.
- **Pre-public 6/6 grep clean**: zero wiki-links memory, zero personae Marko, zero internal slugi MateMatic, zero prywatnych sciezek, zero em-dash, polskie znaki w commit message zamienione.

## Co NIE jest w ADR-0046

- **Eksport audit pack** -> rezerwacja **ADR-0047** (POST /api/audit/export -> PDF + JSON do offline verifier)
- **Bulk Merkle verify** (wszystkie eventy w filtrowanym zakresie naraz) -> rezerwacja **ADR-0048**
- **Wizualizacja hash chain** (graf eventow z liniami chain prev_hash -> hash) -> NIE planowane. Audytor potrzebuje listy + per-event verify, graf to overengineering.
- **Editing / annotacje audytora** -> NIE planowane. AI Act art. 12 i Konstytucja Art. 6 - audit log jest append-only z punktu widzenia kazdej roli, audytor pisze swoja notatke osobno (np. w PDF z eksportu).
- **Frontend integration testy (vitest + RTL)** -> rezerwacja **ADR-0044** (vitest frontend setup gdy faza 2 LIVE).
