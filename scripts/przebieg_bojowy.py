#!/usr/bin/env python3
"""Przebieg bojowy PATRONa - sprawdza DZIALAJACA instalacje, nie repozytorium.

Po co to istnieje
-----------------
Zielone repo nie znaczy dzialajacy produkt. 2026-08-21 przebieg bojowy wyciagnal
19 defektow przy calkowicie zielonych testach; 2026-08-22 - martwy eksport teczki
dowodowej i martwa weryfikacje pieczeci Merkle, mimo ze istniala bramka na
dokladnie te regresje (skanowala za waski katalog).

Ten skrypt automatyzuje te czesc przebiegu, ktora da sie zmierzyc bez wydawania
pieniedzy na model: powierzchnie governance, lancuch audytu, pieczec Merkle,
eksport teczki dowodowej i URUCHOMIENIE weryfikatora z paczki. Rozmowa z modelem
zostaje do recznego sprawdzenia - kosztuje.

Uzycie
------
    python scripts/przebieg_bojowy.py              # aplikacja na domyslnych portach
    python scripts/przebieg_bojowy.py --port 3001

Kod wyjscia: 0 = wszystko przeszlo, 1 = cokolwiek padlo (nadaje sie do CI).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile

TOKEN = "local"  # tryb desktop single-user; backend sqlite i tak bypassuje
TIMEOUT = 20


class Wynik:
    def __init__(self) -> None:
        self.ok = 0
        self.bledy: list[str] = []

    def zdał(self, co: str, szczegol: str = "") -> None:
        self.ok += 1
        print(f"  ok    {co}" + (f"  ({szczegol})" if szczegol else ""))

    def padł(self, co: str, szczegol: str) -> None:
        self.bledy.append(f"{co}: {szczegol}")
        print(f"  BLAD  {co}  ({szczegol})")


def zapytaj(base: str, sciezka: str, metoda: str = "GET") -> tuple[int, bytes]:
    req = urllib.request.Request(
        f"{base}{sciezka}",
        method=metoda,
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as odp:
            return odp.status, odp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001 - chcemy kazdy blad jako wynik, nie wyjatek
        return 0, str(e).encode()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=3001)
    args = ap.parse_args()
    base = f"http://localhost:{args.port}"
    w = Wynik()

    print(f"\nPRZEBIEG BOJOWY - {base}\n")

    # 1. Backend zyje i przedstawia sie wlasnym identyfikatorem instancji
    print("[1] backend")
    kod, tresc = zapytaj(base, "/health")
    if kod == 200 and b'"ok":true' in tresc.replace(b" ", b""):
        w.zdał("/health odpowiada", json.loads(tresc).get("instance_id", "")[:8])
    else:
        w.padł("/health", f"kod {kod}")
        print("\nBackend nie odpowiada - uruchom PATRONa i powtorz.\n")
        return 1

    # 2. Powierzchnie governance, ktore front pokazuje w perymetrze
    print("[2] powierzchnie governance")
    for nazwa, sciezka in [
        ("polityka egress", "/api/config/egress"),
        ("bramka MCP", "/api/security/mcp-status"),
    ]:
        kod, tresc = zapytaj(base, sciezka)
        if kod == 200:
            w.zdał(nazwa, tresc[:60].decode(errors="replace"))
        else:
            w.padł(nazwa, f"kod {kod}")

    # 3. Sprawy - czy w ogole sa dane do pracy
    print("[3] sprawy")
    kod, tresc = zapytaj(base, "/projects")
    sprawy = json.loads(tresc) if kod == 200 else []
    if kod == 200:
        w.zdał("lista spraw", f"{len(sprawy)} szt.")
    else:
        w.padł("lista spraw", f"kod {kod}")

    # 4. Lancuch audytu - AI Act art. 12
    print("[4] lancuch audytu")
    kod, tresc = zapytaj(base, "/api/audit/log?limit=1")
    event_id = None
    if kod == 200:
        zdarzenia = json.loads(tresc).get("events", [])
        if zdarzenia:
            e = zdarzenia[0]
            event_id = e["id"]
            ma_lancuch = bool(e.get("hash")) and bool(e.get("prev_hash"))
            if ma_lancuch:
                w.zdał("zdarzenie z hashem i poprzednikiem", f"id {event_id}")
            else:
                w.padł("lancuch skrotow", "zdarzenie bez hash/prev_hash")
        else:
            w.padł("dziennik audytu", "pusty")
    else:
        w.padł("dziennik audytu", f"kod {kod}")

    # 5. Pieczec Merkle + eksport teczki + WERYFIKATOR Z PACZKI
    #    To jest jedyna funkcja w tej kategorii, ktorej nie ma konkurencja -
    #    i dokladnie ona byla martwa w UI 2026-08-22.
    print("[5] teczka dowodowa")
    if event_id is None:
        w.padł("eksport teczki", "brak zdarzenia do eksportu")
    else:
        kod, _ = zapytaj(base, "/api/audit/merkle/compute-now", metoda="POST")
        if kod == 200:
            w.zdał("pieczec Merkle policzona")
        else:
            w.padł("pieczec Merkle", f"kod {kod}")

        kod, paczka = zapytaj(base, f"/api/audit/export/{event_id}")
        if kod != 200:
            w.padł("eksport teczki", f"kod {kod}")
        else:
            with tempfile.TemporaryDirectory() as kat:
                zip_path = os.path.join(kat, "teczka.zip")
                with open(zip_path, "wb") as f:
                    f.write(paczka)
                try:
                    with zipfile.ZipFile(zip_path) as z:
                        nazwy = z.namelist()
                        z.extractall(kat)
                except zipfile.BadZipFile:
                    w.padł("eksport teczki", "to nie jest archiwum ZIP")
                    return 1 if w.bledy else 0

                w.zdał("eksport teczki", f"{len(paczka)} B, {len(nazwy)} plikow")

                # Weryfikator MUSI byc w paczce - odbiorca nie ma repozytorium.
                for wymagany in ("verify.py", "SPRAWDZ-TEN-PLIK.html"):
                    if any(n.endswith(wymagany) for n in nazwy):
                        w.zdał(f"{wymagany} w paczce")
                    else:
                        w.padł(f"{wymagany}", "brak w paczce")

                artefakt = next((n for n in nazwy if n.endswith(".json")), None)
                verify = next((n for n in nazwy if n.endswith("verify.py")), None)
                if artefakt and verify:
                    proc = subprocess.run(
                        [sys.executable, os.path.join(kat, verify),
                         os.path.join(kat, artefakt)],
                        capture_output=True, text=True, timeout=120,
                        env={**os.environ, "PYTHONUTF8": "1"},
                    )
                    if proc.returncode == 0 and "nienaruszony" in proc.stdout:
                        w.zdał("weryfikator orzekl: artefakt nienaruszony")
                    else:
                        w.padł("weryfikator z paczki",
                               f"kod {proc.returncode}; {proc.stdout[-160:].strip()}")

    print(f"\nWYNIK: {w.ok} przeszlo, {len(w.bledy)} padlo")
    for b in w.bledy:
        print(f"  - {b}")
    if not w.bledy:
        print("\nZmierzone bez wydawania pieniedzy na model. Do RECZNEGO sprawdzenia")
        print("zostaje rozmowa z modelem, grounding cytatu i redlining pisma.\n")
    return 1 if w.bledy else 0


if __name__ == "__main__":
    sys.exit(main())
