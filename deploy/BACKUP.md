# Patron - backup szyfrowany (RODO art. 32)

Skrypt `backup.sh` robi codzienny szyfrowany snapshot:
- `pg_dump` Postgresa (Supabase): czaty, dokumenty, audit_log
- `mc mirror` MinIO: pliki .docx / .pdf użytkowników
- szyfrowanie `age` publicznym kluczem odbiorcy
- manifest SHA-256 do wykrycia uszkodzenia lub podmianki
- retencja: usuwa starsze niż N dni (domyślnie 30)

## Po co `age` zamiast `gpg` / `openssl`

- `age` (https://github.com/FiloSottile/age) działa z jednego klucza. Bez konfiguracji, bez „web of trust", bez kluczy, które tracą ważność.
- Każdy szyfrogram jest niezależny. Do odtworzenia wystarczy klucz prywatny, nie trzeba zarządzać keyringiem jak w GPG.
- Format pliku jest stabilny i daje się sprawdzić przez `age --version`.

## Generowanie kluczy

```bash
sudo mkdir -p /root/.config/patron
sudo age-keygen -o /root/.config/patron/age.key
sudo chmod 600 /root/.config/patron/age.key
# wypisze: "Public key: age1xyz..."
```

Klucz prywatny (`age.key`) zostaje w kancelarii. Zalecana druga kopia w sejfie offline. Bez tego klucza nikt nie odszyfruje backupu, włącznie z MateMatic.

Klucz publiczny (`age1xyz...`) idzie do `.env.backup` jako `AGE_RECIPIENT`.

## Konfiguracja jednorazowa

```bash
cd /opt/patron/deploy   # albo katalog patron/deploy w Twojej instalacji
cp .env.backup.example .env.backup
nano .env.backup        # wypełnij AGE_RECIPIENT, BACKUP_DIR, MINIO_ALIAS

# Upewnij się że masz mc skonfigurowany:
mc alias set local http://minio:9000 "<R2_ACCESS_KEY_ID>" "<R2_SECRET_ACCESS_KEY>"

# Sprawdź czy age jest zainstalowany:
age --version
# Jeśli nie:
# Ubuntu/Debian: apt install age
# macOS: brew install age

chmod +x backup.sh restore.sh
```

## Pierwsze uruchomienie

```bash
./backup.sh
```

Spodziewane wyjście:

```
[02:00:01] Krok 1/4: pg_dump Postgresa...
[02:00:03]   -> /var/backups/patron/patron-2026-05-20-020001.postgres.dump (12345678 bytes)
[02:00:03] Krok 2/4: mc mirror MinIO bucket 'patron'...
[02:00:15]   -> /var/backups/patron/patron-2026-05-20-020001.minio.tar (987654321 bytes)
[02:00:15] Krok 3/4: age encrypt...
[02:00:18]   -> ...postgres.dump.age + ...minio.tar.age + ...sha256
[02:00:18] Krok 4/4: retencja (>30 dni)...
[02:00:18] OK patron-2026-05-20-020001 - postgres 12345678B + minio 987654321B zaszyfrowane do /var/backups/patron
```

## Cron (operator)

```bash
sudo crontab -e
```

Dorzuć:
```
0 2 * * *  /opt/patron/deploy/backup.sh >> /var/log/patron-backup.log 2>&1
```

Codziennie o 02:00. Log trafia do `/var/log/patron-backup.log`. Rotacją zajmuje się `logrotate` (Ubuntu/Debian: `apt install logrotate`).

## Test odtworzenia (OBOWIĄZKOWO przed go-live + raz na kwartał)

```bash
./restore.sh patron-2026-05-20-020001
```

Skrypt:
1. Sprawdza SHA-256.
2. Odszyfrowuje `age` (potrzebuje `age.key`).
3. Tworzy bazę testową `patron_restore_test` w Supabase Postgres.
4. Robi `pg_restore` do tej bazy.
5. Wypisuje liczby wierszy w `chat_messages`, `documents` i `audit_log`.

Jeśli liczby są większe od zera, backup jest żywy.
Po weryfikacji usuń bazę testową. Komenda jest na końcu wyjścia restore.sh.

## Walidacja audit chain w odtworzonej bazie

```bash
cd /opt/patron/backend
# Na czas weryfikacji wskaż backendowi bazę testową:
SUPABASE_URL=http://localhost:8000 \
SUPABASE_SECRET_KEY="$(grep SERVICE_ROLE_KEY /opt/supabase/docker/.env | cut -d= -f2)" \
PGDATABASE=patron_restore_test \
npm run audit:verify
```

Powinno zwrócić `[verify] OK - N wpisów zweryfikowanych`. Jeśli backup jest spójny, weryfikator znajdzie nietkniętą historię.

## Off-site (zalecane)

`/var/backups/patron/` na hoście to jedna kopia. RODO art. 32 wymaga odporności na utratę. Zrób kopię poza maszyną: rsync na NAS, S3 u innego dostawcy albo płyta szyfrowana w sejfie.

```bash
# Przykład: nightly rsync na NAS po backup.sh
rsync -a --delete /var/backups/patron/ nas:/volume1/backups/patron/
```

Pliki są już zaszyfrowane publicznym kluczem age. Można je trzymać u dowolnego dostawcy storage bez ujawniania treści.

## Co jest w backupie

| Komponent | Co zawiera | Wrażliwość |
|---|---|---|
| `*.postgres.dump.age` | Czaty, dokumenty (metadata), audit log, użytkownicy | Wysoka, tajemnica zawodowa |
| `*.minio.tar.age` | Pliki .docx / .pdf | Wysoka, pełna treść dokumentów klientów |
| `*.sha256` | Hashe artefaktów (nieszyfrowane) | Niska, niczego nie zdradza |

## Czego NIE ma w backupie

- Sekretów `.env`. Operator trzyma je osobno, poza repozytorium, w password managerze.
- Logów dockera. Jeśli potrzebne, agreguj przez Loki albo OpenSearch.
- Konfiguracji `mcp-servers.json`. Generuje ją `bundle-mcp.cjs`, źródło siedzi w repo.

## Test ataku na łańcuch: co backup chroni

Jeśli ktoś na maszynie produkcyjnej zmodyfikuje wpis `audit_log`:
1. `npm run audit:verify` wykryje to natychmiast (hash-chain).
2. Backup z dnia poprzedniego zawiera wersję sprzed manipulacji. Można porównać i udowodnić atak.
3. Modyfikacja wpisu w backupie (`*.postgres.dump.age`) wymaga klucza prywatnego `age.key`. Atakujący na hoście go nie ma.

To jest wielowarstwowe record-keeping, którego wymaga AI Act art. 12.
