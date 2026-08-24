#!/usr/bin/env python3
"""Znajduje moduly, ktore maja testy i NIE SA importowane nigdzie w produkcie.

Powod istnienia: 2026-08-24 przy budowie publicznego katalogu zdolnosci wyszlo,
ze `lib/citation/heuristicCitations.ts` ma testy, przechodzi je i **nie jest
importowany przez nikogo**. Kod, ktory zieleni sie w CI i nie robi nic, jest
gorszy od braku kodu: wyglada na funkcje w kazdym przegladzie repozytorium
i trafia do opisu produktu jako zdolnosc.

To NIE jest bramka blokujaca - czesc takich modulow to swiadomie wstrzymane
funkcje (jak wlasnie ADR-0144). To raport do przejrzenia przez czlowieka.

Uzycie:
    python scripts/martwe_moduly.py
    python scripts/martwe_moduly.py --katalog backend/src --katalog frontend/src
"""
import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOMYSLNE = ["backend/src", "frontend/src"]
POMIN_KATALOGI = {"node_modules", "dist", ".next", "__pycache__", "migrations"}
# pliki, ktore z natury nie sa importowane (punkty wejscia, konfiguracja, typy)
POMIN_NAZWY = re.compile(
    r"(^index$|^main$|^server$|^app$|^page$|^layout$|^route$|^middleware$|"
    r"^types$|\.d$|^global|config$|\.config$)", re.I
)


def moduly(katalogi):
    out = []
    for k in katalogi:
        baza = REPO / k
        if not baza.exists():
            continue
        for p in baza.rglob("*"):
            if p.suffix not in {".ts", ".tsx"}:
                continue
            if any(cz in POMIN_KATALOGI for cz in p.parts):
                continue
            if ".test." in p.name or ".eval." in p.name or ".spec." in p.name:
                continue
            if POMIN_NAZWY.search(p.stem):
                continue
            out.append(p)
    return out


def zrodla(katalogi):
    tresci = {}
    for k in katalogi:
        baza = REPO / k
        if not baza.exists():
            continue
        for p in baza.rglob("*"):
            if p.suffix not in {".ts", ".tsx"}:
                continue
            if any(cz in POMIN_KATALOGI for cz in p.parts):
                continue
            try:
                tresci[p] = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass
    return tresci


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--katalog", action="append", dest="katalogi")
    a = ap.parse_args()
    katalogi = a.katalogi or DOMYSLNE

    wszystkie = zrodla(katalogi)
    kandydaci = moduly(katalogi)
    martwe = []

    for m in kandydaci:
        nazwa = m.stem
        # import moze isc przez sciezke wzgledna, alias @/ albo indeks katalogu
        wzor = re.compile(r"""from\s+["'][^"']*\b""" + re.escape(nazwa) + r"""(\.js|\.ts)?["']"""
                          r"""|require\(["'][^"']*\b""" + re.escape(nazwa) + r"""(\.js|\.cjs)?["']\)""")
        importujacy = [p for p, t in wszystkie.items() if p != m and wzor.search(t)]
        produkcyjni = [p for p in importujacy
                       if ".test." not in p.name and ".eval." not in p.name and ".spec." not in p.name]
        if importujacy and not produkcyjni:
            martwe.append((m, "TYLKO TESTY", len(importujacy)))
        elif not importujacy:
            ma_test = any(
                (m.parent / f"{nazwa}{s}").exists() for s in (".test.ts", ".test.tsx", ".eval.test.ts")
            )
            if ma_test:
                martwe.append((m, "ZERO IMPORTOW, ale ma test", 0))

    print(f"przeskanowano modulow: {len(kandydaci)} (plikow zrodlowych: {len(wszystkie)})")
    if not martwe:
        print("brak modulow importowanych wylacznie przez testy albo wcale")
        return 0
    print(f"\nDO PRZEJRZENIA - {len(martwe)}:")
    for p, powod, n in sorted(martwe, key=lambda x: str(x[0])):
        print(f"  {p.relative_to(REPO).as_posix()}")
        print(f"      {powod}" + (f" ({n} importow, wszystkie z testow)" if n else ""))
    print("\nTo nie jest blad sam w sobie: czesc takich modulow to swiadomie wstrzymane")
    print("funkcje. Blad zaczyna sie wtedy, gdy taki modul trafia do opisu produktu.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
