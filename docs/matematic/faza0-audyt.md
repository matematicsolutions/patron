# Faza 0 - Audyt architektoniczny hard forka willchen96/mike

**Data audytu:** 2026-05-19  
**Commit:** d39f580  
**Audytor:** MateMatic / Claude Sonnet 4.6  
**Cel:** Decyzja - hard fork, modularny fork, czy od zera

---

## 1. Architektura backendu

**Ocena: ZDROWA**

Struktura `backend/src/` jest czytelnie podzielona na trzy warstwy:

```
index.ts              <- punkt wejscia, Express setup, rate limiting
routes/               <- warstwa HTTP (kontrolery)
lib/                  <- logika domenowa (chatTools, storage, convert, llm/)
middleware/auth.ts    <- warstwa bezpieczenstwa
```

`index.ts:1-127` - czysty setup Express z rate limiterami (chat/upload/ogolny), helmet, CORS, bez zadnej logiki biznesowej. Wzorcowe.

`routes/*.ts` - kazdy router odpowiada za: walidacje inputu, autoryzacje przez `requireAuth`, wywolanie logiki z `lib/`, odpowiedz HTTP. Nie ma "fat controllers" z logikaproduktu wewnatrz tras.

`lib/chatTools.ts` - logika kontekstu dokumentow, budowania wiadomosci LLM, runner petli tool-calling. Jedyne zastrzezenie: plik ma 3000+ linii (zbyt duzy), ale wewnetrznie jest modularny przez eksportowane funkcje.

`lib/llm/` - wzorowo oddzielony provider adapter. Patrz sekcja 3.

**Warstwy sa czysto rozdzielone.** Logika biznesowa nie przebija sie do HTTP i odwrotnie.

---

## 2. Punkty sprzezenia z chmura - analiza Fazy 1 (zero-cloud)

### (a) Supabase Auth

**Backend:** `middleware/auth.ts:1-37` - uwierzytelnienie przez `admin.auth.getUser(token)` wywolywane na kazde zadanie. Jeden plik, jeden wzorzec. Identyczna funkcja duplikat w `lib/supabase.ts:20-44` (`getUserIdFromRequest`) - nie jest uzywana w Express routes (tylko w starszej sciezce Next.js App Router).

**Frontend:** `contexts/AuthContext.tsx:1-91` - `supabase.auth.signIn/signOut/onAuthStateChange`. Caly auth state management opiera sie na Supabase JS SDK.

**Login:** `app/login/page.tsx:31` - `supabase.auth.signInWithPassword`. Bezposrednie wywolanie Supabase SDK.

**lib/mikeApi.ts:40-46** - token Bearer pobierany z `supabase.auth.getSession()` i doklejany do kazdego zadania do backendu.

**Diagnoza:** Auth jest zcentrowane - backend ma jeden plik middleware, frontend ma jeden kontekst. Podmiana na self-hosted Supabase (lokalny `supabase start`) wymaga TYLKO zmiany zmiennych srodowiskowych `SUPABASE_URL` i `SUPABASE_SECRET_KEY`. Podmiana na Keycloak/Auth.js wymagalaby przepisania `middleware/auth.ts` (37 linii) i `AuthContext.tsx` (91 linii). Praca: **0.5-1 dzien**.

### (b) Supabase Postgres

**Dostepu do DB** uzywa WYLACZNIE `createServerSupabase()` z `lib/supabase.ts:7-13`. Kazdy route wywoluje go lokalnie:

```typescript
// routes/chat.ts:19
const db = createServerSupabase();

// routes/documents.ts
const db = createServerSupabase();
```

Wszystkie zapytania uzywaja Supabase JS client (`.from("table").select(...)`) - nie ma raw SQL, nie ma ORM poza klientem Supabase. Schema w `schema.sql` jest standardowy PostgreSQL z rozszerzeniem pgcrypto.

**Diagnoza:** Self-hosted Supabase (lokalny postgres + REST layer) wymaga TYLKO zmiany `SUPABASE_URL`/`SUPABASE_SECRET_KEY`. Migracja do Drizzle/Prisma z czystym PostgreSQL to 3-5 dni przepisywania queries. Dla Fazy 1 (local Supabase): **0 dni kodu, konfiguracja srodowiska**.

### (c) Cloudflare R2 / S3 Storage

**`lib/storage.ts:1-202`** - jedyny plik storage. Uzywa `@aws-sdk/client-s3` z konfigurowalnymi env varami:

```typescript
// storage.ts:24-35
cachedClient = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT_URL!,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});
```

SDK jest **S3-compatible** - `R2_ENDPOINT_URL` to dowolny endpoint S3 (MinIO, LocalStack, AWS S3, Cloudflare R2). Podmiana na MinIO wymaga tylko zmiany zmiennych srodowiskowych.

`storageEnabled = Boolean(process.env.R2_ENDPOINT_URL && ...)` - `storage.ts:39-43` - aplikacja gracefully degraduje gdy storage nie jest skonfigurowany (zwraca `null` zamiast rzucac wyjatkiem przy odczycie).

**Diagnoza:** Absolutnie wymienne. **0 dni kodu, konfiguracja env**.

### (d) Resend email

**UWAGA:** Resend jest w `package.json:29` i `.env.example:19`, ale NIE ma zadnego `import ... from "resend"` ani uzywania API Resend w zadnym pliku `.ts` w `backend/src/`. Funkcjonalnosc emailowa nie jest zaimplementowana lub zostala usunieta. Resend jest "dead dependency".

**Diagnoza:** Brak kodu do podmieniania. Jezeli bedzie potrzebny email (zaproszenia do projektu, weryfikacja), to implementacja od zera z dowolnym providerem (SMTP/Resend/Mailgun). **0 dni blokujacych Faze 1**.

---

## 3. Warstwa modeli i narzedzi - MCP readiness

**`lib/llm/index.ts:1-30`** - fasada: `streamChatWithTools(params)` i `completeText(params)` jako jedyne publiczne API. Wewnatrz routuje po providerze na podstawie nazwy modelu.

**`lib/llm/types.ts:1-65`** - kluczowy interfejs:

```typescript
export type StreamChatParams = {
    model: string;
    systemPrompt: string;
    messages: LlmMessage[];
    tools?: OpenAIToolSchema[];      // narzedzia w formacie OpenAI
    runTools?: (calls: NormalizedToolCall[]) => Promise<NormalizedToolResult[]>;
    // ...
};
```

Architektura tool-callingu jest **callback-based**: caller przekazuje `runTools` jako funkcje. LLM wywoluje tool -> `runTools` sie uruchamia -> wynik wraca do LLM. Petla implementowana w kazdym providerze (`claude.ts`, `openai.ts`, `gemini.ts`).

**`lib/llm/tools.ts:1-74`** - schema adaptery: OpenAI format jest kanonicznym wspolnym formatem, konwertowany do Claude/Gemini przy wywolaniu.

**Gdzie wpiecie MCP:**  
MCP klient musialby byc dodany jako **nowe zrodlo narzedzi** obok istniejacych `TOOLS` i `PROJECT_EXTRA_TOOLS` z `chatTools.ts`. Najprostsze miejsce:

```typescript
// lib/mcpClient.ts (nowy plik)
export async function discoverMcpTools(): Promise<OpenAIToolSchema[]> { ... }
export async function callMcpTool(name, args): Promise<string> { ... }
```

W `chatTools.ts` w funkcji `runLLMStream` (ok. linia 2800+) dodac dynamiczne doklejanie MCP tools do listy `TOOLS` przed startem streamu oraz routing `runTools` do MCP klienta dla narzedzi MCP.

**Architektura na to pozwala bez przepisywania rdzenia.** Interfejs `runTools: (calls) => Promise<results>` jest idealnym miejscem do podpiecia proxy MCP. Praca: **2-3 dni** dla pelnego MCP klienta z dynamic tool discovery.

---

## 4. Warstwa auth - glebokosc wrascniecia Supabase

### Backend

Supabase Auth uzywany jest w **jednym miejscu**: `middleware/auth.ts:24-28`:

```typescript
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const { data } = await admin.auth.getUser(token);
```

Poza tym backend operuje wylacznie na `userId` (UUID string) i `userEmail` (string) przekazywanych przez `res.locals`. Zadna logika biznesowa nie importuje Supabase Auth bezposrednio.

Duplikat `getUserIdFromRequest` w `lib/supabase.ts:20-44` (dla Next.js App Router) jest martwy w Express context.

### Frontend

Supabase Auth jest w trzech miejscach:
1. `lib/supabase.ts:7` - singleton klient (`createClient`)
2. `contexts/AuthContext.tsx:31-60` - `getSession`, `onAuthStateChange`, `signOut`
3. `app/login/page.tsx:31` i `app/signup/page.tsx` - `signInWithPassword`, `signUp`

**Podmiana na self-hosted Supabase**: tylko zmiana `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`. Nic w kodzie.

**Podmiana na Auth.js / Keycloak**: przepisanie `AuthContext.tsx` (91 linii), `lib/supabase.ts` (7 linii), stron login/signup (~80 linii kazda) i `lib/auth.ts` (55 linii). Suma: ~230 linii frontendu + 37 linii backendu.

**Ocena:** Auth jest dobrze wyizolowany. **Nie jest wraszniety** - nie ma rozproszonych importow Supabase Auth po komponentach. Praca wymiany na inny provider: **1-2 dni**.

---

## 5. Jakosc kodu

### Obsluga bledow

Spjna. Kazdy route zwraca JSON `{ detail: string }` z wlasciwym statusem HTTP. Rate limiter w `index.ts:39-50` tez uzywa `{ detail: ... }`. Bledny format we frontendzie: `lib/mikeApi.ts:62` czyta `.text()` zamiast `.json()` dla bledow - moze byc nieczytelne dla uzytkownika.

Niebezpieczny pattern w `routes/documents.ts:635-818` (`handleEditResolution`): nadmierny `console.log` na kazdym kroku operacji - potencjalnie leakuje wewnetrzna strukture danych w logach produkcyjnych.

### Walidacja inputu

Dobra. Kazdy endpoint ma dedykowane parsery (np. `parseChatMessages`, `parseOptionalModel` w `routes/chat.ts:57-91`). Pliki uploadowane przez multer `lib/upload.ts` maja limit 100MB i whitelist typow (`ALLOWED_TYPES = new Set(["pdf", "docx", "doc"])`).

### Bezpieczenstwo

**Pozytywne:**
- Helmet + CORS + rate limiting w `index.ts` - wzorcowe
- RLS wyrewokowalne: `schema.sql:353-368` - REVOKE ALL na wszystkich tabelach dla `anon/authenticated`. Frontend NIE ma bezposredniego dostepu do danych przez Supabase klienta
- Klucze API uzytkownikow szyfrowane AES-256-GCM: `lib/userApiKeys.ts:47-81`
- Download URL podpisywane HMAC: `lib/downloadTokens.ts` (patrz backend)
- Autoryzacja przed kazdym dostepem do dokumentu/projektu przez `ensureDocAccess`/`checkProjectAccess`

**Czerwona flaga 1:** `middleware/auth.ts:24-27` - na KAZDE zadanie HTTP tworzony jest nowy Supabase klient (`createClient`) i wykonywane jest wywolanie sieciowe do Supabase Auth (`getUser`). Brak cache JWT. Przy 10 req/s to 10 wywolan auth/s do zewnetrznego serwisu. Moze byc waskim gardlem przy ruchu.

**Czerwona flaga 2:** `frontend/src/lib/auth.ts:28-34` - frontend tworzy klienta Supabase z kluczem `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (anon key) do weryfikacji JWT. To powinno byc service role lub przynajmniej nie publicznie eksponowane w kontekscie weryfikacji. W praktyce nie jest to blad bezpieczenstwa (anon key to publiczny klucz), ale pattern jest mylacy.

**Czerwona flaga 3:** `schema.sql:70-78` - kolumna `user_id text not null` w tabeli `projects` (i `documents`, `chats`, `workflows`). Zamiast `uuid` - jest `text`. Wynika z tego brak typowej integralnosci referencyjnej z `auth.users`. Nie jest blokujace, ale jest zapachem.

### Testy

**Brak.** Zero plikow `.test.ts`, `.spec.ts`, nie ma vitest ani jest w `package.json`. Jest to powazna luka dla projektu legal AI. Kod produkcyjny bez testow.

### Spojnosc

Wysoka. Caly backend uzywa TypeScript strict, spojny format odpowiedzi, spojny model autoryzacji. Brak ORMa jest swiadomym wyborem (Supabase JS client jako query builder).

---

## 6. Przetwarzanie dokumentow

Pipeline: `routes/documents.ts:833-969` (`handleDocumentUpload`):

1. **Upload**: multer (memory storage) -> walidacja typu -> `uploadFile(key, content, contentType)` do R2/S3
2. **Konwersja**: DOCX/DOC -> PDF przez `lib/convert.ts:69-73` (LibreOffice `libreoffice-convert`). PDF zapisywany osobno w `converted-pdfs/` w R2.
3. **Ekstrakcja struktury**: `extractStructureTree` (pdfjs-dist dla PDF, mammoth dla DOCX) - tworzy spis tresci / outline
4. **DB**: wpisywany rekord `document_versions` z `storage_path` i `pdf_storage_path`, `current_version_id` wskazuje na najnowsza wersje

**Sprzezenia:**
- LibreOffice musi byc zainstalowany na serwerze (blokujaca zaleznosc). `convert.ts:9` - lazy import przez `libreoffice-convert`. Brak LibreOffice = DOCX bez podgladu PDF, ale aplikacja nie padnie - `catch` w `documents.ts:901-909`.
- `downloadTokens.ts` generuje podpisane HMAC URL-e do pobierania (nie signed URL R2 dla kazdego pliku - to swiadoma decyzja architektoniczna dla bezpieczenstwa).

**Ekstrakcja tekstu dla LLM**: `chatTools.ts:694+` - `extractPdfText` przez pdfjs-dist (strona po stronie), `extractDocxText` przez mammoth. Oba dzialaja na bajkach z R2/S3 (download -> process in-memory). Skalowanie: przy duzych dokumentach (>500 stron) moze byc problem z pamieccia (caly PDF w RAM). Dla etapu MVP to akceptowalne.

---

## 7. Werdykt

### **(B) Czesciowo - hard fork z selektywnym przepisaniem**

Architektura JEST dobra. To nie jest "zgnily" kod. Ale kilka modulow wymaga przepisania lub rozszerzenia dla kontekstu polskiego legal AI.

**Wziaj i pinuj (bez zmian lub minimalne):**
- `lib/llm/` - caly adapter LLM (claude.ts, gemini.ts, openai.ts, tools.ts, types.ts, models.ts) - wzorcowy, gotowy do MCP
- `lib/storage.ts` - gotowy S3-compatible, podmiana na MinIO = env vars
- `lib/access.ts` - logika autoryzacji, kompletna
- `lib/userApiKeys.ts` - szyfrowanie kluczy AES-256-GCM, profesjonalne
- `middleware/auth.ts` - wystarczy zmiana env vars dla self-hosted Supabase
- `routes/documents.ts`, `routes/projects.ts`, `routes/workflows.ts` - solidne
- `lib/convert.ts` - modularny, izolowany
- `backend/schema.sql` - dobra baza, wymaga drobnych polskich rozszerzen (np. tabela kancelarii, role RBAC)
- `frontend/src/lib/mikeApi.ts` - kompletny klient API, nie wymaga zmian przy zachowaniu backendu

**Przepisz lub rozszerz:**
- `lib/chatTools.ts` - PLIK ZA DUZY (3000+ linii). Rozbic na: `lib/tools/document-tools.ts`, `lib/tools/workflow-tools.ts`, `lib/tools/docx-tools.ts`, `lib/llm-runner.ts`. Przy okazji: wpiac klienta MCP. Praca: 3-4 dni.
- `middleware/auth.ts` - dodac cache JWT (np. node-cache lub LRU) zeby nie robic network call do Supabase na kazde zadanie. Czerwona flaga 1. Praca: 0.5 dnia.
- `backend/schema.sql` - dodac tabele polskiego kontekstu: `law_firms`, `attorneys`, `matters` (sprawy), RBAC per kancelaria. Praca: 1 dzien.
- `lib/chatTools.ts:84` (`SYSTEM_PROMPT`) - spolszczyc i dolozyc kontekst prawa polskiego (RODO, KPC, KC, AI Act). Praca: 0.5 dnia.
- **Testy**: dodac Vitest dla `lib/llm/`, `lib/access.ts`, `lib/userApiKeys.ts`. Minimalny coverage krytycznych sciezek. Praca: 2-3 dni.

**Zaimplementuj od zera (brak w fork):**
- Klient MCP (eu-sparql-search, SAOS, LEX): nowy `lib/mcpClient.ts`. Praca: 2-3 dni.
- Integracja SAOS (orzecznictwo polskie): nowy route + lib. Praca: 3-5 dni.
- Multi-tenancy (kancelaria jako jednostka, nie user): rozszerzenie schematu + access layer. Praca: 3-5 dni.
- Resend/SMTP (zaproszenia do kancelarii): martwa dependencja w forku - implementacja od zera. Praca: 1 dzien.

---

## 8. Oszacowanie pracy Fazy 1 (zero-cloud)

Faza 1 = uruchomienie na lokalnej infrastrukturze (self-hosted Supabase + MinIO jako S3) bez zadnych zewnetrznych SaaS.

| Zadanie | Praca |
|---------|-------|
| Self-hosted Supabase (docker-compose, env vars) | 0.5 dnia |
| MinIO jako R2 (docker, env vars, test upload) | 0.5 dnia |
| LibreOffice na serwerze docelowym | 0.5 dnia |
| JWT cache w middleware/auth.ts | 0.5 dnia |
| Weryfikacja end-to-end (login, upload, chat) | 0.5 dnia |
| **RAZEM Faza 1 strict zero-cloud** | **2.5 dnia** |

Jezeli Faza 1 zawiera tez spolszczenie systemu i wpiat MCP:

| Zadanie | Praca |
|---------|-------|
| Faza 1 strict | 2.5 dnia |
| Rozbicie chatTools.ts + klient MCP | 4 dni |
| SYSTEM_PROMPT PL + polskie modele prawne | 0.5 dnia |
| Schema PL (kancelaria, sprawy) | 1 dzien |
| Testy jednostkowe krytycznych sciezek | 2 dni |
| **RAZEM Faza 1 rozszerzona** | **~10 dni** |

---

## 9. Najwazniejsze ustalenia (top 5)

1. **Storage jest wymienialny bez kodu** - `lib/storage.ts` to czysty S3-compatible adapter. MinIO = zmiana 3 zmiennych srodowiskowych. Brak zaleznosci od konkretnego dostawcy chmury.

2. **Warstwa LLM jest profesjonalna i gotowa na MCP** - `lib/llm/` z callback `runTools` jest naturalnym miejscem wpiecia klienta MCP. Nie trzeba przepisywac rdzenia - wystarczy nowy plik `lib/mcpClient.ts` i doklejenie go w `chatTools.ts`.

3. **Auth jest slabo skalowalny (cache JWT!)** - `middleware/auth.ts` wywoluje Supabase network request na KAZDE zadanie HTTP. To czerwona flaga dla MVP pod obciazen production.

4. **Brak testow** - projekt legal AI bez testow to ryzyko compliance. Dla polskiego klienta (kancelaria) brak testow = brak mozliwosci audytu jakosci. Musi byc naprawione przed pilotazem.

5. **chatTools.ts jest monolitem (3000+ linii)** - nie blokuje Fazy 1, ale przy kazdej rozbudowie o nowe narzedzia (SAOS, EUR-Lex) stanie sie bariera. Rozbicie jest priorytetetem Fazy 2.

---

*Raport wygenerowany: 2026-05-19 | Rewizja: 0.1 | Status: projekt MateMatic - wewnetrzny*
