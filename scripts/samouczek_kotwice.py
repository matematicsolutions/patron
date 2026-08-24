#!/usr/bin/env python3
"""Bramka + naprawa: kotwice spisu tresci w samouczkach muszą trafiac w naglowki.

Powod istnienia: link `[Krok 3](#6-passo-3-legislacao)` wyglada poprawnie i nic
nie zglasza, gdy naglowek brzmi `## 6. Passo 3: legislação`. Klikniecie po prostu
nie robi nic. Zmierzone 2026-08-24: francuski samouczek mial kotwice `#...etape...`
przy naglowkach `## ... Étape ...` OD POCZATKU - GitHub zachowuje znaki
diakrytyczne w slugu, wiec `Étape` daje `étape`, nie `etape`.

Reguly sluga GitHuba, ktore odtwarzamy: male litery, usuniecie znakow innych niz
litery/cyfry/spacja/lacznik (kropka, dwukropek, przecinek, nawiasy, apostrof),
spacje na lacznik. Znaki diakrytyczne ZOSTAJA.

Uzycie:
  python scripts/samouczek_kotwice.py            # raport (exit 20 gdy rozjazd)
  python scripts/samouczek_kotwice.py --napraw   # przepisuje kotwice wg naglowkow
"""
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
WZ_NAGLOWEK = re.compile(r"^#{2,3}\s+(.+?)\s*$", re.M)
WZ_LINK = re.compile(r"\[([^\]]*)\]\(#([^)]+)\)")


def slug(naglowek: str) -> str:
    """Slug w stylu GitHuba - znaki diakrytyczne zachowane."""
    s = naglowek.strip().lower()
    s = unicodedata.normalize("NFC", s)
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)  # \w obejmuje litery z akcentami
    s = re.sub(r"[\s_]+", "-", s)
    return s.strip("-")


def analizuj(plik: Path):
    tekst = plik.read_text(encoding="utf-8")
    slugi = {slug(h) for h in WZ_NAGLOWEK.findall(tekst)}
    zle = []
    for etykieta, kotwica in WZ_LINK.findall(tekst):
        if kotwica not in slugi:
            zle.append((etykieta, kotwica))
    return tekst, slugi, zle


def bez_akcentow(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def napraw(plik: Path) -> int:
    tekst, slugi, zle = analizuj(plik)
    if not zle:
        return 0
    # dopasowanie: kotwica bez akcentow == slug bez akcentow
    mapa = {bez_akcentow(s): s for s in slugi}
    poprawione = 0

    def na_link(m):
        nonlocal poprawione
        etykieta, kotwica = m.group(1), m.group(2)
        if kotwica in slugi:
            return m.group(0)
        cel = mapa.get(bez_akcentow(kotwica))
        if not cel:
            # Kotwice bywaly SKRACANE recznie ("#13-cheat-sheet" przy naglowku
            # "13. Cheat sheet: ready-made prompts"). Numer sekcji niesie i link,
            # i naglowek - dopasowujemy po nim, bo to jedyna czesc, ktora na pewno
            # znaczy to samo po obu stronach.
            num = re.match(r"(\d+)-", kotwica)
            if num:
                pasujace = [s for s in slugi if s.startswith(num.group(1) + "-")]
                if len(pasujace) == 1:
                    cel = pasujace[0]
        if not cel:
            return m.group(0)
        poprawione += 1
        return f"[{etykieta}](#{cel})"

    nowy = WZ_LINK.sub(na_link, tekst)
    if poprawione:
        plik.write_text(nowy, encoding="utf-8", newline="\n")
    return poprawione


def main() -> int:
    napraw_tryb = "--napraw" in sys.argv
    pliki = sorted(DOCS.glob("SAMOUCZEK*.md"))
    if not pliki:
        print("[kotwice] brak samouczkow")
        return 10
    total_zle = 0
    total_nap = 0
    for p in pliki:
        _, _, zle = analizuj(p)
        if napraw_tryb and zle:
            n = napraw(p)
            total_nap += n
            _, _, zle = analizuj(p)
        if zle:
            total_zle += len(zle)
            print(f"[kotwice] {p.name}: {len(zle)} kotwic bez naglowka")
            for etykieta, kotwica in zle[:4]:
                print(f"      #{kotwica}   (link: {etykieta[:45]})")
        else:
            print(f"[kotwice] {p.name}: OK")
    if napraw_tryb:
        print(f"\n[kotwice] przepisano {total_nap} kotwic")
    if total_zle:
        print(f"[kotwice] BLOKADA - {total_zle} kotwic nie trafia w zaden naglowek")
        return 20
    print("[kotwice] OK - kazda kotwica trafia w naglowek")
    return 0


if __name__ == "__main__":
    sys.exit(main())
