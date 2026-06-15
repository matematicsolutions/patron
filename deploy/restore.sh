#!/usr/bin/env bash
# Patron - test odtworzenia z szyfrowanego backupu.
# Operator MUSI wykonac ten test PRZED produkcyjnym wdrozeniem
# i nastepnie cyklicznie (zalecane co kwartal).
#
# Wymagania: age (z prywatnym kluczem), docker compose, mc.
#
# Uruchomienie:
#   ./restore.sh <label>           # np. ./restore.sh patron-2026-05-20-020001
#
# UWAGA: skrypt zwraca dane do osobnego storage (db-restore-test, minio-restore-test)
# zeby NIE nadpisac produkcji. Po weryfikacji - reczne usuniecie.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.backup"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    . "$ENV_FILE"
fi

BACKUP_DIR="${BACKUP_DIR:-${SCRIPT_DIR}/backups}"
AGE_KEY_FILE="${AGE_KEY_FILE:-${HOME}/.config/patron/age.key}"

LABEL="${1:-}"
if [ -z "$LABEL" ]; then
    echo "Uzycie: $0 <label>"
    echo
    echo "Dostepne labele:"
    ls "${BACKUP_DIR}"/patron-*.sha256 2>/dev/null | sed 's|.*/||; s/\.sha256$//' | tail -10
    exit 2
fi

PG_AGE="${BACKUP_DIR}/${LABEL}.postgres.dump.age"
MINIO_AGE="${BACKUP_DIR}/${LABEL}.minio.tar.age"
SHA_FILE="${BACKUP_DIR}/${LABEL}.sha256"

if [ ! -f "$PG_AGE" ] || [ ! -f "$MINIO_AGE" ]; then
    echo "FATAL: brak artefaktow dla ${LABEL}:"
    echo "  ${PG_AGE}"
    echo "  ${MINIO_AGE}"
    exit 1
fi

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ---------------------------------------------------------------------------
# 1. Weryfikuj integralnosc SHA-256
# ---------------------------------------------------------------------------

log "Krok 1/4: SHA-256 verify..."
if [ -f "$SHA_FILE" ]; then
    (cd "$BACKUP_DIR" && sha256sum -c "$(basename "$SHA_FILE")")
    log "  OK"
else
    log "  WARN: brak ${SHA_FILE} - skipping integrity check"
fi

# ---------------------------------------------------------------------------
# 2. Decrypt
# ---------------------------------------------------------------------------

if [ ! -f "$AGE_KEY_FILE" ]; then
    echo "FATAL: brak klucza prywatnego age (${AGE_KEY_FILE}). Bez tego nie odszyfrujesz."
    exit 3
fi

log "Krok 2/4: age decrypt..."
WORK_DIR="${BACKUP_DIR}/.restore-${LABEL}"
mkdir -p "$WORK_DIR"
age -d -i "$AGE_KEY_FILE" -o "${WORK_DIR}/postgres.dump" "$PG_AGE"
age -d -i "$AGE_KEY_FILE" -o "${WORK_DIR}/minio.tar" "$MINIO_AGE"
log "  -> ${WORK_DIR}/postgres.dump + minio.tar"

# ---------------------------------------------------------------------------
# 3. Restore do osobnej bazy "patron_restore_test"
# ---------------------------------------------------------------------------

log "Krok 3/4: restore Postgres do bazy 'patron_restore_test'..."
SUPABASE_DOCKER_DIR="${SUPABASE_DOCKER_DIR:-/opt/supabase/docker}"
docker compose -f "${SUPABASE_DOCKER_DIR}/docker-compose.yml" exec -T db \
    psql -U postgres -c "DROP DATABASE IF EXISTS patron_restore_test;"
docker compose -f "${SUPABASE_DOCKER_DIR}/docker-compose.yml" exec -T db \
    psql -U postgres -c "CREATE DATABASE patron_restore_test;"
docker compose -f "${SUPABASE_DOCKER_DIR}/docker-compose.yml" exec -T db \
    pg_restore -U postgres -d patron_restore_test < "${WORK_DIR}/postgres.dump"
log "  OK"

# ---------------------------------------------------------------------------
# 4. Smoke test: chat_messages + audit_log policzone
# ---------------------------------------------------------------------------

log "Krok 4/4: smoke test (county wierszy)..."
docker compose -f "${SUPABASE_DOCKER_DIR}/docker-compose.yml" exec -T db \
    psql -U postgres -d patron_restore_test -c "
        SELECT 'chat_messages' AS t, COUNT(*) FROM public.chat_messages
        UNION ALL
        SELECT 'documents',     COUNT(*) FROM public.documents
        UNION ALL
        SELECT 'audit_log',     COUNT(*) FROM public.audit_log;
    "
log "  jezeli liczby > 0 = backup w porzadku."

# ---------------------------------------------------------------------------
# Cleanup hint
# ---------------------------------------------------------------------------

cat <<EOF

==============================================================
RESTORE TEST OK dla ${LABEL}.
Po weryfikacji wynikow:
  1. Sprawdz audit chain w odtworzonej bazie:
     cd backend && SUPABASE_URL=... npm run audit:verify
     (uzyj polaczenia do patron_restore_test)
  2. Usun baze testowa:
     docker compose -f ${SUPABASE_DOCKER_DIR}/docker-compose.yml \\
         exec db psql -U postgres -c "DROP DATABASE patron_restore_test;"
  3. Usun katalog ${WORK_DIR}:
     rm -rf "${WORK_DIR}"
==============================================================
EOF
