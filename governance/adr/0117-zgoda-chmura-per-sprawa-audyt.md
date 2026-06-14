# ADR-0117: Zgoda na model chmurowy per-sprawa (przelacznik w UI + audyt)

- **Status:** Proponowany. Branch `fix/audyt-patron-p1-p3`, NIESCALONY do `main` (bramka: 2x review WM + decyzja Operatora). Domkniecie audytu P2 #6.
- **Data:** 2026-06-14
- **Kontekst:** Audyt PATRON P2 #6. Zgoda na model chmurowy dla spraw objetych tajemnica byla tylko globalna zmienna srodowiskowa (`PATRON_ALLOW_PRIVILEGED_CLOUD`) - wyglada jak generyczny blad, nie swiadoma blokada; adwokat musi grzebac w env zamiast kliknac zgode per-sprawa; brak sladu w audycie.

## Decyzja

Swiadoma zgoda na model chmurowy **per-sprawa**, ustawiana przelacznikiem w UI, zapisywana do `audit_log`.

1. **Schema:** `projects.cloud_consent` (sqlite: `integer not null default 0` + `ensureSchemaUpgrades` ADD COLUMN; Postgres: `boolean not null default false`, migracja 013). Default fail-closed: istniejace sprawy bez zgody.
2. **Brama egress (`lib/routing/guard.ts`):** nowy `resolveCloudConsent(db, projectId)` (defensywny -> false). `guardEgress` OR-uje: `allowPrivilegedCloud() (env globalny) || resolveCloudConsent(per-sprawa)` i podaje do `decideRoute`. Czat ogolny (brak projectId) -> false. `decideRoute` bez zmian (przyjmuje gotowy bool).
3. **Endpoint:** `PATCH /projects/:projectId/cloud-consent` (`routes/projects.ts`), owner-only (404 dla cudzej sprawy - zmiana bramy egress), body `{ enabled }`. Ustawia flage + `appendAuditEvent`.
4. **Audit (AI Act art. 12):** nowy `event_type = 'project.cloud_consent'` (kto/kiedy/ktora sprawa/stan, bez tresci). Whitelist: `EVENT_TYPES` (audit.ts) + `schema.sqlite.ts` + `schema.sql` + **migracja sqlite v2** (`runSqliteMigrations` rebuild `audit_log` CHECK z zachowaniem wierszy/hash-chain - wykorzystuje runner z ADR-0109) + **Postgres migracja 012**.
5. **Frontend:** przelacznik "Model chmurowy" w `ProjectPage` (slot `actions` ToolbarTabs), owner-only, optymistyczny z revertem; `patronApi.setCloudConsent`. `PATRONProject` += `cloud_consent`/`classification`.

## Konsekwencje

- (+) Adwokat wlacza chmure dla JEDNEJ sprawy kliknieciem; decyzja jest swiadoma, odwracalna, **audytowana** (slad w hash-chain). Koniec grzebania w env.
- (+) Defense-in-depth nietkniete: tajemnica nadal wymaga zgody (fail-closed), PII maskowane przed chmura (ADR-0110), kazdy call egress audytowany `llm_route` (ADR-0067). Per-sprawa zgoda OR-uje sie z globalna - nie oslabia, dodaje granularnosc.
- (+) Rebuild `audit_log` (sqlite) przez wersjonowany runner naprawia tez latentna luke: istniejace bazy desktop nie przyjmowaly nowych `event_type` (brak runnera przed ADR-0109). Wiersze + hash/prev_hash kopiowane verbatim -> chain i proof-y Merkle wazne (audit_log bez incoming FK).
- (-) Zgoda jest per-sprawa, nie per-pojedynczy-call (granularnosc sprawy, nie zapytania) - swiadome uproszczenie.
- (-) Etykieta przelacznika hardcoded PL (precedens audit-event-detail.tsx); klucz i18n = nit/rezerwacja.
- **Testy:** backend vitest 1180 pass / 0 fail / 5 todo (+11: migracja v2 audit_log zachowuje wiersze/hash + nowy event_type; resolveCloudConsent true/false/no-project/error; guardEgress privileged+per-sprawa->allow). Frontend tsc 0. Endpoint integration = rezerwacja (brak supertest). Manualna weryfikacja UI u pilota.
