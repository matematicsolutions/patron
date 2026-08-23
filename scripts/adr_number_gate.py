#!/usr/bin/env python3
"""Bramka numeracji ADR i migracji Postgres (plan 2.0.0 pkt 5, audyt 2026-08-18 W1-Low).

Powod istnienia: numery ADR i migracji byly rezerwowane "na oko" na rownoleglych
galeziach -> kolizje (2x migracja 014; ADR 0109/0110 i 0141/0142 miedzy liniami,
rozwiazane renumeracja przy scaleniu). Rejestr wolnych numerow w
`.matematic/releases/<wydanie>/README.md` jest regula bez bramki - a regula bez
bramki nie trzyma. Ta bramka jest mechaniczna i pada na:

  1. duplikacie prefiksu numeru w governance/adr/ (NNNN-*.md),
  2. duplikacie prefiksu numeru w backend/migrations/ (NNN_*.sql),
  3. rejestrze wskazujacym numer <= najwyzszego zajetego (rejestr nie podbity).

Zero zaleznosci, zero egressu. Exit 0 = OK, 1 = kolizja/rozjazd, 2 = blad srodowiska.
Uzycie: python scripts/adr_number_gate.py [KATALOG_REPO]
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path


def collect(dirpath: Path, pattern: str) -> tuple[dict[str, list[str]], int]:
    rx = re.compile(pattern)
    by_num: dict[str, list[str]] = defaultdict(list)
    highest = -1
    for p in sorted(dirpath.iterdir()):
        m = rx.match(p.name)
        if not m:
            continue
        by_num[m.group(1)].append(p.name)
        highest = max(highest, int(m.group(1)))
    return by_num, highest


def registry_next(readme: Path, label: str) -> int | None:
    if not readme.exists():
        return None
    text = readme.read_text(encoding="utf-8", errors="replace")
    m = re.search(rf"\*\*{re.escape(label)}:\*\*\s*`(\d+)`", text)
    return int(m.group(1)) if m else None


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    adr_dir = root / "governance" / "adr"
    mig_dir = root / "backend" / "migrations"
    if not adr_dir.is_dir() or not mig_dir.is_dir():
        print(f"adr_number_gate: brak {adr_dir} lub {mig_dir}", file=sys.stderr)
        return 2

    problems: list[str] = []

    adr_by_num, adr_max = collect(adr_dir, r"^(\d{4})-.*\.md$")
    for num, files in sorted(adr_by_num.items()):
        if len(files) > 1:
            problems.append(f"ADR duplikat numeru {num}: {', '.join(files)}")

    mig_by_num, mig_max = collect(mig_dir, r"^(\d{3})_.*\.sql$")
    for num, files in sorted(mig_by_num.items()):
        if len(files) > 1:
            problems.append(f"migracja duplikat numeru {num}: {', '.join(files)}")

    # Rejestr wolnych numerow (najnowsze wydanie = katalog o najwyzszej nazwie).
    releases = root / ".matematic" / "releases"
    readme = None
    if releases.is_dir():
        dirs = sorted([d for d in releases.iterdir() if d.is_dir()])
        if dirs:
            readme = dirs[-1] / "README.md"
    if readme is None:
        # Katalog `.matematic/` jest PRYWATNY (nie publikujemy warsztatu), wiec w
        # klonie publicznym i w CI rejestru po prostu nie ma. Kontrola duplikatow
        # numerow dziala dalej - ta jedna nie. Mowimy to GLOSNO, bo bramka, ktora
        # po cichu pomija polowe swojego zakresu, jest grozniejsza niz jej brak.
        print("adr_number_gate: rejestr wolnych numerow NIEDOSTEPNY "
              "(.matematic/ jest prywatny) - kontrola podbicia licznika POMINIETA; "
              "kontrola duplikatow numerow wykonana")
    if readme is not None:
        nxt_adr = registry_next(readme, "Nastepny ADR")
        nxt_mig = registry_next(readme, "Nastepna migracja Postgres")
        if nxt_adr is not None and nxt_adr <= adr_max:
            problems.append(
                f"rejestr ADR wskazuje {nxt_adr:04d}, a najwyzszy zajety to {adr_max:04d} "
                f"({readme.relative_to(root)}) - podbij licznik w tym samym commicie"
            )
        if nxt_mig is not None and nxt_mig <= mig_max:
            problems.append(
                f"rejestr migracji wskazuje {nxt_mig:03d}, a najwyzsza zajeta to {mig_max:03d} "
                f"({readme.relative_to(root)}) - podbij licznik w tym samym commicie"
            )

    print(
        f"adr_number_gate: ADR {len(adr_by_num)} numerow (max {adr_max:04d}), "
        f"migracje {len(mig_by_num)} numerow (max {mig_max:03d})"
    )
    if problems:
        for p in problems:
            print(f"FAIL {p}")
        print("RESULT: FAIL")
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
