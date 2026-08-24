#!/bin/bash
# Kontrola PO opublikowaniu wydania - na tym, co widzi swiat, nie na dysku.
#
#   bash desktop/scripts/po-publikacji.sh [tag]      (domyslnie v<wersja z package.json>)
#
# weryfikuj-wydanie.cjs sprawdza artefakty PRZED wgraniem. Ten skrypt sprawdza
# to samo PO publikacji, u zrodla, ktore widzi mecenas - bo miedzy dyskiem
# a wydaniem stoi upload, a upload potrafi sie udac polowicznie.
#
# Trzy rzeczy, ktorych nie da sie sprawdzic lokalnie:
#  1. czy wydanie jest LATEST (na to celuja auto-update i redirecty /pobierz),
#  2. czy CHECKSUMS.txt zgadza sie z polem digest liczonym przez GitHuba,
#     a nie tylko z suma, ktora sami zapisalismy (v1.2.0 mial 17 wierszy na
#     9 plikow - czytelnik strony /pobierz nie mial jak rozstrzygnac, ktora
#     sume porownuje),
#  3. czy trasa /pobierz/<edycja> konczy sie na pliku, ktory istnieje.
set -u
REPO="matematicsolutions/patron"
DESKTOP="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$DESKTOP/dist"
SERWIS="${SERWIS:-$HOME/Projects/www-matematic}"
# Wersja z package.json bez node - sciezka w stylu bash nie przechodzi przez
# require() na Windows, a bramka, ktora nie zna tagu, "nie znajduje wydania".
DOMYSLNY="v$(grep -m1 '"version"' "$DESKTOP/package.json" | cut -d'"' -f4)"
TAG="${1:-$DOMYSLNY}"
TMP_ZDALNE="$(mktemp)"; TMP_DIG="$(mktemp)"
trap 'rm -f "$TMP_ZDALNE" "$TMP_DIG"' EXIT

bledy=0
zle() { echo "  FAIL $*"; bledy=$((bledy+1)); }
zgoda() { echo "  ok   $*"; }

echo "=== 1. Stan wydania $TAG ==="
draft=$(gh release view "$TAG" --repo "$REPO" --json isDraft -q .isDraft)
opub=$(gh release view "$TAG" --repo "$REPO" --json publishedAt -q .publishedAt)
# gh nie ma pola isLatest - ktore wydanie jest najnowsze wie API, nie klient
najnowsze=$(gh api "repos/$REPO/releases/latest" -q .tag_name)
echo "  draft=$draft opublikowane=$opub latest=$najnowsze"
[ "$draft" = "false" ] && zgoda "wydanie nie jest juz draftem" || zle "wydanie nadal jest draftem"
[ "$najnowsze" = "$TAG" ] && zgoda "wydanie jest oznaczone jako latest" \
  || zle "latest to $najnowsze - auto-update i redirecty /pobierz celuja w stare wydanie"

echo
echo "=== 2. Mianownik assetow, w obie strony ==="
gh release view "$TAG" --repo "$REPO" --json assets -q '.assets[] | "\(.name)\t\(.size)"' | sort > "$TMP_ZDALNE"
n=$(wc -l < "$TMP_ZDALNE")
echo "  assetow w wydaniu: $n"
while IFS=$'\t' read -r nazwa rozmiar; do
  lokalny=""
  # KANALY najpierw: w dist/ lezy surowy latest.yml z ostatniego builda,
  # wskazujacy plik spoza wydania. Kolejnosc szukania to nie detal.
  for kand in "$DIST/channels/$nazwa" "$DIST/$nazwa"; do
    [ -f "$kand" ] && lokalny=$(stat -c %s "$kand") && break
  done
  if [ -z "$lokalny" ]; then zle "$nazwa jest w wydaniu, a nie ma go lokalnie"
  elif [ "$lokalny" != "$rozmiar" ]; then zle "$nazwa: API $rozmiar B, lokalnie $lokalny B"
  fi
done < "$TMP_ZDALNE"
[ "$bledy" -eq 0 ] && zgoda "kazdy asset ma swoj plik i zgodny rozmiar"

echo
echo "=== 3. CHECKSUMS.txt wobec pola digest z API GitHuba ==="
gh release view "$TAG" --repo "$REPO" --json assets -q '.assets[] | "\(.name)\t\(.digest)"' | sort > "$TMP_DIG"
pokryte=0
while read -r hash nazwa; do
  api=$(awk -F'\t' -v n="$nazwa" '$1==n {print $2}' "$TMP_DIG" | sed 's/^sha256://')
  if [ -z "$api" ]; then zle "CHECKSUMS opisuje $nazwa, ktorego w wydaniu NIE MA"
  elif [ "$api" != "$hash" ]; then zle "$nazwa: suma w CHECKSUMS != digest z API"
  else pokryte=$((pokryte+1)); fi
done < "$DIST/CHECKSUMS.txt"
echo "  wierszy zgodnych z API: $pokryte"
for nazwa in $(cut -f1 "$TMP_ZDALNE" | grep '\.exe$'); do
  grep -q " $nazwa\$" "$DIST/CHECKSUMS.txt" || zle "$nazwa jest w wydaniu, a nie ma go w CHECKSUMS.txt"
done

echo
echo "=== 4. Kanaly wskazuja assety, ktore ISTNIEJA ==="
for y in $(cut -f1 "$TMP_ZDALNE" | grep '^latest.*\.yml$'); do
  url=$(gh release view "$TAG" --repo "$REPO" --json assets -q ".assets[] | select(.name==\"$y\") | .name" >/dev/null 2>&1; \
        grep -m1 'url:' "$DIST/channels/$y" | sed 's/.*url: *//')
  if cut -f1 "$TMP_ZDALNE" | grep -qx "$url"; then zgoda "$y -> $url"
  else zle "$y -> $url, a takiego assetu w wydaniu NIE MA (auto-update dostanie 404)"; fi
done

echo
echo "=== 5. Bramka wydania na serwisie ==="
if [ -d "$SERWIS" ]; then
  (cd "$SERWIS" && PYTHONUTF8=1 python scripts/wydanie-drift-gate.py) || zle "bramka wydania czerwona"
else
  echo "  pominieto - brak repo serwisu w $SERWIS"
fi

echo
echo "=== 6. Trasy pobierania (kody ASSETOW, nie locale - portugalska to br) ==="
for lang in pl en us gb br it de es fr; do
  cel=$(curl -s -o /dev/null -w "%{redirect_url}" -I "https://matematicsolutions.com/pobierz/$lang")
  case "$cel" in
    *"/releases/latest/download/"*) echo "  ok   /pobierz/$lang -> ${cel##*/}" ;;
    *) zle "/pobierz/$lang nie prowadzi do instalatora (${cel:-brak redirectu})" ;;
  esac
done

echo
[ "$bledy" -eq 0 ] && echo "PO PUBLIKACJI: wszystko zgodne." || echo "PO PUBLIKACJI: $bledy problemow."
exit $([ "$bledy" -eq 0 ] && echo 0 || echo 1)
