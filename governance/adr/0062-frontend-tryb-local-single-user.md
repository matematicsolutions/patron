# ADR-0062: Frontend tryb local (single-user, bez logowania Supabase)

**Status**: PROPONOWANY (2026-05-28). Pozwala frontendowi dzialac bez Supabase auth - jeden lokalny mecenas, brak ekranu logowania. Krytyczna sciezka do soft-launch (Beata dwuklikiem uruchamia app bez rejestracji). Weryfikacja live w przegladarce odlozona (patrz Bramki).

**Data**: 2026-05-28

**Powiazane zasady** (Konstytucja Patrona):
- **Art. 2 / zero-cloud** - w trybie local frontend nie laczy sie z Supabase (chmura) po sesje. Token "local" jest tylko naglowkiem; backend (tryb sqlite, ADR-0053) i tak bypassuje weryfikacje.
- **Art. 4 - prostota** - flaga `NEXT_PUBLIC_PATRON_LOCAL_MODE` centralizuje decyzje; bez flagi frontend dziala dokladnie jak dotad (tryb Supabase, multi-tenant SaaS).

**Powiazane ADR**: ADR-0053 (backend sqlite single-user + auth bypass - frontend local mode to jego lustro po stronie UI). Razem daja "PATRON bez Dockera/Supabase: dwuklik -> dziala".

---

## Kontekst

Backend dziala bez Supabase (ADR-0053, auth bypass w trybie sqlite), ale frontend wciaz zakladal logowanie przez Supabase: `AuthContext` gatuje na `supabase.auth.getSession()`, layout stron przekierowuje niezalogowanych do `/login`, a `patronApi` dolacza token z sesji Supabase. W rezultacie Beata nie przeszlaby nawet przez ekran logowania w wersji zero-cloud. To realny blocker do soft-launch.

## Decyzja

### 1. Centralny `frontend/src/lib/localMode.ts`
`IS_LOCAL_MODE = NEXT_PUBLIC_PATRON_LOCAL_MODE === "true"`, `LOCAL_USER` (id/email spojne z backendem), `LOCAL_TOKEN = "local"`.

### 2. `AuthContext` - auto-user w trybie local
Gdy `IS_LOCAL_MODE`: ustaw `LOCAL_USER`, `authLoading=false`, pomin caly kod Supabase (getSession / onAuthStateChange). `signOut` = no-op. Layout stron nie zmienia sie - `isAuthenticated=true` od razu, brak redirectu do `/login`.

### 3. `patronApi.getAuthHeader` - statyczny token
Gdy `IS_LOCAL_MODE`: zwraca `Authorization: Bearer local`. Backend sqlite ignoruje wartosc (bypass), ale naglowek musi byc obecny.

### 4. `lib/supabase.ts` - bezpieczny import bez env
`createClient` z pustym URL rzuca przy imporcie. Placeholdery (`http://localhost:54321` / placeholder-key) sprawiaja, ze modul jest import-safe w trybie local (gdzie Supabase nie jest uzywany). W trybie Supabase realne env nadpisuja placeholdery.

---

## Alternatywy odrzucone

1. **Usunac Supabase z frontendu calkowicie**. Odrzucone: tryb Supabase (multi-tenant SaaS) ma zostac (vendor-neutral, lustro dual-mode backendu). Flaga przelacza, nie kasuje.
2. **Mockowac sesje Supabase (fake JWT)**. Odrzucone: niepotrzebna zlozonosc. Backend i tak bypassuje token w trybie sqlite; statyczny "local" wystarczy.
3. **Osobny build frontendu dla desktopu**. Odrzucone: jedna baza kodu + flaga env jest prostsza w utrzymaniu niz dwa buildy.
4. **Gate po stronie serwera (middleware Next)**. Odrzucone: istniejacy gate jest client-side (useAuth w layoucie); local mode wpina sie w ten sam punkt bez przebudowy architektury auth.

---

## Bramki PRZED merge (wynik faktyczny)

- **TSC clean frontend** (`npx tsc --noEmit` exit 0).
- **Zero regresji dla trybu Supabase**: bez flagi `IS_LOCAL_MODE=false` -> wszystkie branche to no-opy; placeholder w supabase.ts nieuzywany (realne env). Bezpieczne dla dzialajacej instancji multi-tenant.
- **Zmiana minimalna**: 4 pliki (localMode.ts nowy + AuthContext + patronApi + supabase.ts import-safe), male branche.
- **Weryfikacja LIVE w przegladarce odlozona**: w czasie pracy dzialala rownolegle instancja PATRON (backend :3001 + frontend :3000) - nie zaklocano jej. Render single-user (brak ekranu logowania, lista czatow/dokumentow z `Bearer local`) do potwierdzenia gdy instancja wolna lub w spakowanym .exe. To jedyny niezweryfikowany element.
- **Marko-PL review PENDING** (2x runda przed merge).

## Co NIE jest w ADR-0062

- **Weryfikacja live render** (browser) - odlozona (powyzej).
- **Welcome name** pokazuje local-part email ("local") - kosmetyka, mozna ustawic `NEXT_PUBLIC_PATRON_LOCAL_EMAIL` lub display "Mecenas" (znany bug nazwy z sesji nocnej).
- **Opcjonalny PIN / Windows Hello** przy starcie (Konstytucja prywatnosc) -> rezerwacja (ADR-0053 tez to odlozyl).
- **Electron: wstrzykniecie env (NEXT_PUBLIC_PATRON_LOCAL_MODE) + boot backendu w trybie sqlite** -> sesja desktop/packaging.
- **UI wyboru modelu / panel pamieci / Draft odpowiedzi / graf / Folder Sprawy** -> osobne jednostki frontendowe.
