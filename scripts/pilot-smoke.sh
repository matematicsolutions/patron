#!/usr/bin/env bash
# pilot-smoke.sh - smoke-test pilotazu PATRON na zywej instalacji (desktop).
#
# Przebiega WSZYSTKIE kluczowe sciezki na realnych dokumentach i raportuje
# zielono/czerwono. Uruchamiaj PRZED kazda instalacja u mecenasa (np. Beaty),
# zeby miec pewnosc, ze swiezy build niesie dzialajacy rdzen.
#
# Wymagania:
#   - Aplikacja PATRON uruchomiona (backend na :3001).
#   - Dzialajacy model (gemini/ollama/openrouter w env albo ALLOW_US_PROVIDERS
#     dla chmury). Domyslnie uzywa gemini-3-flash-preview.
#   - Folder z 1+ dokumentem (PDF/DOCX). Domyslnie patron-demo-sprawa.
#
# Uzycie:
#   bash scripts/pilot-smoke.sh
#   MODEL=ollama/llama3.2:3b CASE_DIR="C:/sciezka/do/sprawy" bash scripts/pilot-smoke.sh
#
# Kod wyjscia: 0 = wszystko zielone, 1 = co najmniej jeden test czerwony.

set -uo pipefail

B="${PATRON_BASE:-http://localhost:3001}"
MODEL="${MODEL:-gemini-3-flash-preview}"
CASE_DIR="${CASE_DIR:-$HOME/patron-demo-sprawa/Kowalski-przeciwko-Nowak-Bud}"

PASS=0; FAIL=0
green(){ printf "  \033[32mPASS\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
red(){   printf "  \033[31mFAIL\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
info(){  printf "\n\033[1m== %s ==\033[0m\n" "$1"; }

# Pierwszy plik PDF/DOCX z folderu sprawy.
DOC_FILE="$(ls "$CASE_DIR"/*.pdf "$CASE_DIR"/*.docx 2>/dev/null | head -1)"
# Konwersja sciezki na format akceptowany przez backend Windows:
#   git-bash /c/Users/...  -> c:/Users/...   oraz backslash -> forward-slash.
CASE_DIR_FWD="$(printf '%s' "$CASE_DIR" | sed -E 's#^/([a-zA-Z])/#\1:/#; s#\\#/#g')"

info "0. Zdrowie backendu ($B)"
if curl -s -m5 "$B/health" | grep -q '"ok":true'; then green "/health 200 ok"; else red "/health - backend nie odpowiada (uruchom PATRON)"; echo; echo "PRZERWANO: brak backendu."; exit 1; fi

info "1. Naprawione bramki (P0 z audytu)"
curl -s -m6 -o /dev/null -w '%{http_code}' "$B/skills" | grep -q 200 && green "/skills 200 (biblioteka umiejetnosci)" || red "/skills != 200"
curl -s -m6 "$B/api/security/mcp-status" | grep -q '"gateway"' && green "/api/security/mcp-status ok (bez 500)" || red "/api/security/mcp-status blad"

info "2. Upload dokumentu + skan input-security"
if [ -z "$DOC_FILE" ]; then red "brak dokumentu w $CASE_DIR"; else
  UP="$(curl -s -m90 -X POST "$B/single-documents" -F "file=@$DOC_FILE" 2>&1)"
  DOCID="$(printf '%s' "$UP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
  if printf '%s' "$UP" | grep -q '"security_status":"allowed"' && [ -n "$DOCID" ]; then
    green "upload $(basename "$DOC_FILE") -> ready/allowed"
  elif printf '%s' "$UP" | grep -q 'zagrozenie bezpieczenstwa'; then
    red "upload ZABLOKOWANY przez input-security (mozliwy false-positive)"
  else red "upload nieoczekiwana odpowiedz: $(printf '%s' "$UP" | head -c 120)"; fi
fi

info "3. Import folderu sprawy (headless ingest)"
ING="$(curl -s -m120 -X POST "$B/folders/ingest" -H 'Content-Type: application/json' -d "{\"path\":\"$CASE_DIR_FWD\"}" 2>&1)"
TOTAL="$(printf '%s' "$ING" | sed -n 's/.*"total":\([0-9]*\).*/\1/p')"
INDEXED="$(printf '%s' "$ING" | sed -n 's/.*"indexed":\([0-9]*\).*/\1/p')"
if [ -n "$TOTAL" ] && [ "$TOTAL" = "$INDEXED" ] && [ "$TOTAL" -gt 0 ]; then green "import folderu: $INDEXED/$TOTAL zaindeksowane"; else red "import folderu: indexed=$INDEXED total=$TOTAL"; fi

info "4. Czat z dokumentem (RAG + grounding), model=$MODEL"
if [ -n "${DOCID:-}" ]; then
  CHAT="$(curl -s -m70 -N -X POST "$B/chat" -H 'Content-Type: application/json' -d "{\"messages\":[{\"role\":\"user\",\"content\":\"Streszcz w jednym zdaniu czego dotyczy ten dokument.\",\"files\":[{\"filename\":\"$(basename "$DOC_FILE")\",\"document_id\":\"$DOCID\"}]}],\"model\":\"$MODEL\"}" 2>&1)"
  if printf '%s' "$CHAT" | grep -q 'egress_blocked'; then red "czat: egress_blocked (wlacz ALLOW_US_PROVIDERS lub wybierz model lokalny)";
  elif printf '%s' "$CHAT" | grep -qE 'content_delta|"type":"content"|doc_read'; then green "czat: model przeczytal dokument i odpowiada";
  else red "czat: brak odpowiedzi ($(printf '%s' "$CHAT" | grep -oE '\"message\":\"[^\"]*\"' | head -1))"; fi
else red "czat: pominiety (brak DOCID z kroku 2)"; fi

info "5. Pipeline obrony (Recenzent/Adwokat/Humanizer), model=$MODEL"
DRAFT="$(curl -s -m120 -X POST "$B/draft/refine" -H 'Content-Type: application/json' -d "{\"text\":\"Wnosze o zasadzenie kwoty 1000 zl. Pozwany nie zaplacil faktury.\",\"model\":\"$MODEL\",\"mode\":\"balanced\"}" 2>&1)"
if printf '%s' "$DRAFT" | grep -q 'egress_blocked'; then red "obrona: egress_blocked";
elif printf '%s' "$DRAFT" | grep -qE '"final":"'; then green "obrona: zwrocila wypolerowany draft";
else red "obrona: brak final ($(printf '%s' "$DRAFT" | head -c 100))"; fi

echo
printf "\033[1m==== WYNIK: %d zielonych / %d czerwonych ====\033[0m\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && { echo "Rdzen dziala - gotowe do instalacji."; exit 0; } || { echo "Sa czerwone - NIE instaluj zanim nie naprawisz."; exit 1; }
