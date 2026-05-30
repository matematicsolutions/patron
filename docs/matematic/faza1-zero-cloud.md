# Faza 1 - zero-cloud (RODO-safe)

Cel: produkt dziala bez zaleznosci chmurowych. Trzy komponenty mike sa chmurowe
domyslnie - Supabase (Auth + Postgres), Cloudflare R2 (storage), Resend (e-mail).
Faza 1 strict podmienia je na self-host.

## Stan

| Zadanie | Status | Uwaga |
|---|---|---|
| Cache JWT w auth middleware | ZROBIONE | `backend/src/middleware/auth.ts` - singleton klienta + cache token->user TTL 60s; eliminuje wywolanie sieciowe Supabase na kazde zadanie |
| Storage R2 -> MinIO | KOD GOTOWY | `lib/storage.ts` to czysty adapter S3 z `forcePathStyle: true` - MinIO dziala po podmianie env, zero zmian kodu |
| Resend -> SMTP | NIE DOTYCZY KODU | `grep` po `backend/src` = zero uzyc Resend; e-maile potwierdzajace wysyla Supabase Auth, konfiguracja SMTP po stronie Supabase |
| Self-host Supabase | BLOKADA - brak Dockera | patrz nizej |

## Storage: MinIO zamiast Cloudflare R2

Kod nie wymaga zmian. MinIO ma samodzielny plik wykonywalny na Windows
(`minio.exe`) - Docker NIE jest potrzebny do storage.

Konfiguracja `backend/.env` (nazwy zmiennych zostaja `R2_*` - sa generyczne S3,
rename do `S3_*` ewentualnie w pozniejszej fazie porzadkowej):

```bash
R2_ENDPOINT_URL=http://localhost:9000
R2_ACCESS_KEY_ID=<minio-access-key>
R2_SECRET_ACCESS_KEY=<minio-secret-key>
R2_BUCKET_NAME=patron
```

Uruchomienie MinIO lokalnie (bez Dockera):
```
minio.exe server C:\dane\minio --console-address ":9001"
```
Bucket `patron` zalozyc przez konsole MinIO (`http://localhost:9001`) lub `mc`.

## Self-host Supabase - wymaga Dockera

Supabase do self-hostu dostarczany jest jako stack `docker-compose` (Postgres +
GoTrue/Auth + PostgREST + Storage API + Studio + Kong). **Nie ma sensownej sciezki
bez Dockera.** Na maszynie Wieslawa Docker nie jest zainstalowany - to jedyna
twarda przeszkoda Fazy 1.

Po zainstalowaniu Dockera:
1. `git clone --depth 1 https://github.com/supabase/supabase` -> `docker/`
2. `cp .env.example .env`, ustawic sekrety (`JWT_SECRET`, `ANON_KEY`,
   `SERVICE_ROLE_KEY`, haslo Postgresa)
3. `docker compose up -d`
4. Zaladowac `backend/schema.sql` przez Studio (SQL editor)
5. `backend/.env`: `SUPABASE_URL=http://localhost:8000`, `SUPABASE_SECRET_KEY`
   = lokalny service role key
6. SMTP: skonfigurowac w `.env` Supabase (sekcja GoTrue) - dowolny serwer SMTP
   albo MailHog lokalnie do testow

## Weryfikacja Fazy 1 (kryterium "done")

Backend + frontend wstaja lokalnie, rejestracja + logowanie + upload dokumentu +
czat dzialaja, a w `backend/.env` / `frontend/.env.local` NIE wystepuje zaden
adres `*.supabase.co`, `*.r2.cloudflarestorage.com` ani klucz Resend.
