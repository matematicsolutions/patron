# Patron - runbook wdrożeniowy

Self-host Patrona dla kancelarii prawnej. Stack zero-cloud: dane nie opuszczają
infrastruktury klienta.

## Co stawiamy

```
┌─────────────────────────────────────────────────┐
│ Frontend (Next.js)         port 3000            │
│ Backend  (Express + 6 MCP) port 3001            │
└─────────────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────┐
│ Supabase self-host         port 8000 (Kong)     │
│ MinIO (S3-compat)          port 9000            │
└─────────────────────────────────────────────────┘
```

Powłoka (frontend + backend) idzie z tego docker-compose. Supabase + MinIO są
osobnymi stackami - typowa kancelaria stawia je raz, na poziomie systemu.

## Krok po kroku

### 1) Wymagania

- Docker 24+ z plugin `docker compose`
- 4 GB RAM minimum dla powłoki Patrona (+ 6 GB dla Supabase, + 1 GB dla MinIO)
- Linux / macOS / Windows 11 z WSL2
- Git
- Node 20+ (TYLKO do bundlowania serwerów MCP przed buildem)

### 2) Sklonuj repo

```bash
mkdir patron-stack && cd patron-stack
git clone https://github.com/matematicsolutions/patron.git
git clone https://github.com/matematicsolutions/mcp-saos.git
git clone https://github.com/matematicsolutions/mcp-nsa.git
git clone https://github.com/matematicsolutions/mcp-isap.git
git clone https://github.com/matematicsolutions/mcp-krs.git
git clone https://github.com/matematicsolutions/mcp-eu-sparql.git
```

Struktura:
```
patron-stack/
├── patron/          ← powłoka (frontend + backend + docker-compose)
├── mcp-saos/        ← konektor: sądy powszechne, SN, TK, KIO
├── mcp-nsa/         ← konektor: NSA + 16 WSA (sądy administracyjne)
├── mcp-isap/        ← konektor: Sejm ELI (Dziennik Ustaw + Monitor Polski)
├── mcp-krs/         ← konektor: Krajowy Rejestr Sądowy (MS)
└── mcp-eu-sparql/   ← konektor: prawo UE (EUR-Lex + CJEU)
```

### 3) Zbuduj serwery MCP

```bash
for d in mcp-saos mcp-nsa mcp-isap mcp-krs mcp-eu-sparql; do
  (cd $d && npm install && npm run build)
done
```

### 4) Zbundluj MCP do obrazu backendu

Bundler kopiuje `dist/` każdego konektora do `patron/backend/mcp-bundled/`.

```bash
cd patron
node scripts/bundle-mcp.cjs
```

Po wykonaniu zobaczysz:
```
patron/backend/mcp-bundled/{saos,nsa,isap,krs,eu-sparql}/
patron/backend/mcp-servers.docker.json
```

### 5) Postaw Supabase + MinIO

Każdy ma swój sposób - typowe ścieżki:
- Supabase: `git clone https://github.com/supabase/supabase && cd supabase/docker && cp .env.example .env && docker compose up -d`
- MinIO: `docker run -d --name minio -p 9000:9000 -p 9001:9001 -v /opt/minio-data:/data minio/minio server /data --console-address ":9001"`

Po uruchomieniu Supabase weź klucze (anon + service_role) z `docker/utils/generate-keys.sh`.

### 6) Skonfiguruj `.env.docker`

```bash
cd patron
cp .env.docker.example .env.docker
# edytuj .env.docker - wypełnij SUPABASE_URL, klucze, secrets
```

Generowanie sekretów:
```bash
openssl rand -hex 32     # → DOWNLOAD_SIGNING_SECRET
openssl rand -hex 32     # → USER_API_KEYS_ENCRYPTION_SECRET
```

### 7) Załaduj schemat bazy do Supabase

```bash
# Połącz się z Postgresem Supabase i wykonaj:
psql "postgres://postgres:HASLO@localhost:5432/postgres" -f patron/backend/schema.sql
```

### 8) Postaw bucket MinIO

```bash
mc alias set local http://localhost:9000 minioadmin <R2_SECRET_ACCESS_KEY>
mc mb local/patron
```

### 9) Build + up

```bash
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d
```

### 10) Sprawdź

```bash
curl http://localhost:3001/health        # → {"ok":true}
open http://localhost:3000               # → frontend Patrona
docker compose logs -f backend | head    # → "[MCP] Connected to ..." × 4
```

W logach backendu zobaczysz:
```
[MCP] Connected to "saos" - 3 tool(s) registered
[MCP] Connected to "nsa" - 3 tool(s) registered
[MCP] Connected to "isap" - 3 tool(s) registered
[MCP] Connected to "krs" - 3 tool(s) registered
[MCP] Connected to "eu-sparql" - 3 tool(s) registered
```

### 11) Weryfikator audit trail (po pierwszych zapytaniach)

```bash
docker compose exec backend npm run audit:verify
# → [verify] OK - N wpisów (id=1..N) zweryfikowanych w 0.45s
```

## Aktualizacje

```bash
cd patron-stack
for d in patron mcp-saos mcp-nsa mcp-isap mcp-krs mcp-eu-sparql; do
  (cd $d && git pull && [ -f package.json ] && npm install && npm run build || true)
done
cd patron
node scripts/bundle-mcp.cjs
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d
```

## Backup (RODO art. 32)

Patron przechowuje:
- **Postgres (Supabase)** - dokumenty, czaty, użytkownicy, audit_log
- **MinIO** - pliki .docx / .pdf

Minimalna kopia codzienna:
```bash
# Postgres
docker compose exec supabase-db pg_dump -U postgres -Fc postgres > backups/patron-$(date +%F).dump

# MinIO
mc mirror --overwrite local/patron backups/minio-$(date +%F)/patron/
```

Szyfrowanie przed wysyłką poza maszynę (jeśli kancelaria archiwizuje off-site):
```bash
age -e -r <pub-key> backups/patron-$(date +%F).dump > backups/patron-$(date +%F).dump.age
```

## Troubleshooting

### „[MCP] Could not connect to server X"

Sprawdź, czy bundler przeszedł do końca:
```bash
ls patron/backend/mcp-bundled/
# powinno być: saos/  nsa/  isap/  eu-sparql/
```

Jeśli brakuje - uruchom ponownie `node scripts/bundle-mcp.cjs`.

### „certificate verify failed" przy MCP-NSA

CBOSA (orzeczenia.nsa.gov.pl) ma niekompletny certyfikat chain.
`mcp-nsa` ma już to obejście (rejectUnauthorized: false dla tej domeny).
Jeśli widzisz błąd - sprawdź czy używasz najnowszej wersji `mcp-nsa`.

### Frontend nie ładuje czata

Sprawdź, że `NEXT_PUBLIC_API_BASE_URL` w `.env.docker` wskazuje na PUBLICZNY
adres backendu (z punktu widzenia przeglądarki użytkownika), nie nazwę
kontenera. Lokalnie: `http://localhost:3001`. Za reverse proxy: `https://api.patron.kancelaria.pl`.

### Brak miejsca na dysku

```bash
docker system prune -a --volumes      # usuwa nieużywane obrazy/volumeny
```

## Pliki w tym katalogu

- `README.md` - ten dokument (runbook)

Pliki do dorzucenia w kolejnych iteracjach:
- `nginx.conf` - reverse proxy + TLS (Caddy / nginx-proxy-manager też w grze)
- `docker-compose.prod.yml` - overlay produkcyjny (Traefik / TLS / autoupdate)
- `backup.sh` - skrypt kopii zapasowej (cron)
