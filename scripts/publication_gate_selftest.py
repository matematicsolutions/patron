#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 MateMatic Solutions
"""Kontrola pozytywna bramki publikacyjnej - stdlib, bez zaleznosci.

Po co to istnieje
-----------------
2026-08-23: bramka `publication_gate.py` przez pol roku swiecila na zielono
z PUSTA lista nazw i przepuscila do repo publicznego nazwe kancelarii
pilotazowej w 8 plikach oraz nazwe klienta korporacyjnego w 2. Recznie
zmierzylismy, ze poprawka dziala - ale pomiar wykonany raz nie jest bramka.
Ten plik zamienia tamten pomiar w test, ktory pada, gdy ktos zepsuje
skladanie rdzenia, wyciszy tryb --commit-msg albo cofnie fail-closed.

Zasada: test sprawdza NIE TYLKO ze bramka lapie, ale tez ze NIE lapie tam,
gdzie nie powinna - falszywe trafienie uczy ludzi wylaczac bramke.

    python scripts/publication_gate_selftest.py
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from publication_gate import (  # noqa: E402
    Config, _fold, _hash_hits, scan_commit_msg, scan_text, stem_hash,
)

NAZWISKO = "Kowalska"          # zastepnik realnej nazwy - test nie potrzebuje prawdziwej
AKRONIM = "XQ"                 # dwuliterowy, krotszy niz MIN_STEM


def cfg_z(*terms: str) -> Config:
    return Config(deny_term_hashes=[stem_hash(t) for t in terms])


class Skladanie(unittest.TestCase):
    def test_ogonki_i_wielkosc_liter_skladaja_sie_do_jednego_rdzenia(self):
        self.assertEqual(_fold("ZAŻÓŁĆ Gęślą"), "zazolc gesla")

    def test_l_z_kreska_nie_ginie(self):
        self.assertEqual(_fold("Łódź"), "lodz")


class OdmianaPolska(unittest.TestCase):
    """Jeden hash rdzenia ma pokryc przypadki gramatyczne - inaczej lista nazw
    musialaby rosnac o kazda forme, czego nikt nie utrzyma."""

    def test_rdzen_lapie_odmiane(self):
        deny = {stem_hash("kowalsk")}
        for forma in ("Kowalska", "Kowalskiej", "Kowalskiego", "KOWALSKI"):
            with self.subTest(forma=forma):
                self.assertTrue(_hash_hits(f"uwaga {forma} z pola", deny), forma)

    def test_nie_lapie_niepowiazanego_slowa(self):
        self.assertFalse(_hash_hits("zwykle zdanie o kodzie", {stem_hash("kowalsk")}))


class KrotkiAkronim(unittest.TestCase):
    """Dwuliterowa nazwa firmy musi byc lapana, ale base64 w package-lock.json
    rozpada sie na tokeny dwuliterowe na kazdej dlugosci - stad warunek wersalikow."""

    def test_lapie_akronim_wersalikami(self):
        self.assertTrue(_hash_hits(f"demo dla {AKRONIM} Polska", {stem_hash(AKRONIM)}))

    def test_nie_lapie_tych_samych_liter_w_base64(self):
        smiec = "sha512-GpVkmM8vF2vQ+xq/lJEnhZw75x"
        self.assertFalse(_hash_hits(smiec, {stem_hash(AKRONIM)}))


class TrescCommita(unittest.TestCase):
    """Kanal, ktorym wyciekly nazwy 2026-08-22 - i jedyny, ktorego nie da sie
    poprawic po fakcie."""

    def _plik(self, tresc: str) -> Path:
        p = Path(self.enterContext(__import__("tempfile").TemporaryDirectory())) / "MSG"
        p.write_text(tresc, encoding="utf-8")
        return p

    def test_nazwa_w_tresci_commita_jest_trafieniem(self):
        f = self._plik(f"fix(x): poprawka\n\nZgloszenie od {NAZWISKO} z pola.\n")
        self.assertTrue(scan_commit_msg(f, cfg_z("kowalsk")))

    def test_komentarze_gita_sa_ignorowane(self):
        f = self._plik(f"fix(x): poprawka\n# szablon gita wspomina {NAZWISKO}\n")
        self.assertFalse(scan_commit_msg(f, cfg_z("kowalsk")))


class Wyciszenia(unittest.TestCase):
    def test_marker_allow_wycisza_linie(self):
        linia = f"const fixture = '{NAZWISKO}';  // pubgate:allow"
        self.assertFalse(scan_text("x.ts", linia, cfg_z("kowalsk")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
