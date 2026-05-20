#!/usr/bin/env bash
# Patron - codzienny backup szyfrowany (RODO art. 32).
#
# Wymagania:
#   - docker compose (Patron + Supabase w sasiednim katalogu lub komendzie)
#   - mc (MinIO client)  -> https://min.io/docs/minio/linux/reference/minio-mc.html
#   - age                -> https://github.com/FiloSottile/age
#
# Konfiguracja przez env (patrz .env.backup.example):
#   BACKUP_DIR              katalog docelowy (default: ./backups)
#   BACKUP_RETENTION_DAYS   ile dni trzymac (default: 30)
#   AGE_RECIPIENT           publiczny klucz age odbiorcy (kancelaria)
#   SUPABASE_DOCKER_DIR     katalog docker compose Supabase (default: /opt/supabase/docker)
#   MINIO_ALIAS             alias mc dla MinIO (default: local)
#   MINIO_BUCKET            bucket do backupu (default: patron)
#   HEALTHCHECK_URL         opcjonalny ping (uptime kuma / healthchecks.io)
#
# Uruchomienie:
#   ./backup.sh
#
# Crontab (operator kancelarii):
#   0 2 * * *  /opt/patron/deploy/backup.sh >> /var/log/patron-backup.log 2>&1

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.backup"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    . "$ENV_FILE"
fi

BACKUP_DIR="${BACKUP_DIR:-${SCRIPT_DIR}/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
SUPABASE_DOCKER_DIR="${SUPABASE_DOCKER_DIR:-/opt/supabase/docker}"
MINIO_ALIAS="${MINIO_ALIAS:-local}"
MINIO_BUCKET="${MINIO_BUCKET:-patron}"

if [ -z "${AGE_RECIPIENT:-}" ]; then
    echo "[backup] FATAL: AGE_RECIPIENT nie ustawiony. Wygeneruj klucz:"
    echo "  age-keygen -o /root/.config/patron/age.key"
    echo "i ustaw AGE_RECIPIENT na publiczna czesc (linijka 'public key' w wyjsciu)."
    exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F-%H%M%S)"
LABEL="patron-${STAMP}"

log() { echo "[$(date +%H:%M:%S)] $*"; }

cleanup_on_error() {
    log "FAIL ($?) - czyszcze niedokonczone artefakty $LABEL"
    rm -f "${BACKUP_DIR}/${LABEL}".*.{dump,tar,age,sha256} 2>/dev/null || true
}
trap cleanup_on_error ERR

# ---------------------------------------------------------------------------
# 1. Postgres dump (przez docker compose w katalogu Supabase)
# ---------------------------------------------------------------------------

log "Krok 1/4: pg_dump Postgresa..."
PG_DUMP_FILE="${BACKUP_DIR}/${LABEL}.postgres.dump"
docker compose -f "${SUPABASE_DOCKER_DIR}/docker-compose.yml" exec -T db \
    pg_dump -U postgres -Fc -d postgres > "$PG_DUMP_FILE"
PG_DUMP_SIZE=$(stat -c%s "$PG_DUMP_FILE" 2>/dev/null || stat -f%z "$PG_DUMP_FILE")
log "  -> ${PG_DUMP_FILE} (${PG_DUMP_SIZE} bytes)"

# ---------------------------------------------------------------------------
# 2. MinIO mirror -> tar
# ---------------------------------------------------------------------------

log "Krok 2/4: mc mirror MinIO bucket '${MINIO_BUCKET}'..."
MINIO_DIR="${BACKUP_DIR}/${LABEL}.minio"
mc mirror --overwrite --quiet "${MINIO_ALIAS}/${MINIO_BUCKET}" "$MINIO_DIR" > /dev/null
MINIO_TAR="${BACKUP_DIR}/${LABEL}.minio.tar"
tar -cf "$MINIO_TAR" -C "$BACKUP_DIR" "$(basename "$MINIO_DIR")"
rm -rf "$MINIO_DIR"
MINIO_TAR_SIZE=$(stat -c%s "$MINIO_TAR" 2>/dev/null || stat -f%z "$MINIO_TAR")
log "  -> ${MINIO_TAR} (${MINIO_TAR_SIZE} bytes)"

# ---------------------------------------------------------------------------
# 3. age encrypt obu artefaktow
# ---------------------------------------------------------------------------

log "Krok 3/4: age encrypt..."
age -r "$AGE_RECIPIENT" -o "${PG_DUMP_FILE}.age" "$PG_DUMP_FILE"
age -r "$AGE_RECIPIENT" -o "${MINIO_TAR}.age" "$MINIO_TAR"
rm -f "$PG_DUMP_FILE" "$MINIO_TAR"   # pelne czyste szyfrowanie - oryginaly usuniete

# SHA-256 + manifest do detekcji uszkodzenia / podmianki
sha256sum "${PG_DUMP_FILE}.age" "${MINIO_TAR}.age" \
    > "${BACKUP_DIR}/${LABEL}.sha256"
log "  -> ${PG_DUMP_FILE}.age + ${MINIO_TAR}.age + ${LABEL}.sha256"

# ---------------------------------------------------------------------------
# 4. Retencja - usun starsze niz BACKUP_RETENTION_DAYS
# ---------------------------------------------------------------------------

log "Krok 4/4: retencja (>${BACKUP_RETENTION_DAYS} dni)..."
find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name "patron-*.age" -o -name "patron-*.sha256" \) \
    -mtime +"${BACKUP_RETENTION_DAYS}" -delete -print | \
    while read -r f; do log "  removed: $f"; done

# ---------------------------------------------------------------------------
# Healthcheck ping (opcjonalny)
# ---------------------------------------------------------------------------

if [ -n "${HEALTHCHECK_URL:-}" ]; then
    log "Healthcheck ping: ${HEALTHCHECK_URL}"
    curl -fsS --max-time 10 "$HEALTHCHECK_URL" > /dev/null || \
        log "WARN: healthcheck ping failed (backup OK)"
fi

trap - ERR
log "OK ${LABEL} - postgres ${PG_DUMP_SIZE}B + minio ${MINIO_TAR_SIZE}B zaszyfrowane do ${BACKUP_DIR}"
