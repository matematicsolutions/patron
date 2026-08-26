#!/usr/bin/env bash
# OpenRouter catalog -> per-MTok prices for one vendor.
#
# The catalog is ~700KB of per-token floats; this fetches it once, caches it for the
# day, and prints the columns a pricing row needs. Batch and -fast variants are dropped
# because Patron uses neither.
#
#   catalog-prices.sh anthropic          # all anthropic/* models
#   catalog-prices.sh google gemini-3    # narrow further with a substring
#   catalog-prices.sh --refresh openai   # force a re-fetch
#
# Columns: id, input $/MTok, output $/MTok, context window.
set -euo pipefail

CACHE="${TMPDIR:-/tmp}/openrouter-models.json"
MAX_AGE_SECONDS=86400

command -v jq >/dev/null || { echo "needs jq (brew install jq)" >&2; exit 1; }

if [ "${1:-}" = "--refresh" ]; then rm -f "$CACHE"; shift; fi

VENDOR="${1:-}"
FILTER="${2:-}"
[ -n "$VENDOR" ] || { echo "usage: $(basename "$0") [--refresh] <vendor> [substring]" >&2; exit 1; }

stale=1
if [ -f "$CACHE" ]; then
    now=$(date +%s)
    mtime=$(stat -f %m "$CACHE" 2>/dev/null || stat -c %Y "$CACHE")
    [ $((now - mtime)) -lt "$MAX_AGE_SECONDS" ] && stale=0
fi

if [ "$stale" -eq 1 ]; then
    echo "fetching openrouter.ai/api/v1/models ..." >&2
    curl -sS --max-time 30 https://openrouter.ai/api/v1/models -o "$CACHE"
fi

# Round to 6dp: the catalog stores 0.19999999999999998 for what is really $0.20.
jq -r --arg vendor "$VENDOR" --arg filter "$FILTER" '
  .data[]
  | select(.id | startswith($vendor + "/"))
  | select($filter == "" or (.id | contains($filter)))
  | select(.id | test(":batch$|-fast$") | not)
  | [ .id,
      ((.pricing.prompt|tonumber) * 1000000 * 1000000 | round / 1000000),
      ((.pricing.completion|tonumber) * 1000000 * 1000000 | round / 1000000),
      .context_length ]
  | @tsv' "$CACHE" \
  | sort \
  | awk 'BEGIN { printf "%-46s %10s %10s %12s\n", "MODEL ID", "IN/MTok", "OUT/MTok", "CONTEXT" }
         { printf "%-46s %10s %10s %12s\n", $1, $2, $3, $4 }'
