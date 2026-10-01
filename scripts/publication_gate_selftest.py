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
    BASELINE_FILE, HARD, Config, Finding, _fold, _hash_hits, iter_history,
    load_baseline, scan_commit_msg, scan_text, split_baseline, stem_hash,
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


class Diakrytyki(unittest.TestCase):
    """Konwencja organizacji: tresc commita bez polskich ogonkow. Regula miala
    pol roku i zadnej bramki - zlamala ja sesja, ktora ja opisywala."""

    def _plik(self, tresc: str) -> Path:
        p = Path(self.enterContext(__import__("tempfile").TemporaryDirectory())) / "MSG"
        p.write_text(tresc, encoding="utf-8")
        return p

    def test_ogonek_w_tresci_jest_trafieniem(self):
        f = self._plik("test: cos\n\nTest umie paść.\n")
        kinds = [x.kind for x in scan_commit_msg(f, cfg_z("kowalsk"))]
        self.assertIn("diakrytyki", kinds)

    def test_tresc_bez_ogonkow_przechodzi(self):
        f = self._plik("test: cos\n\nTest umie padac.\n")
        self.assertFalse(scan_commit_msg(f, cfg_z("kowalsk")))


class Wyciszenia(unittest.TestCase):
    def test_marker_allow_wycisza_linie(self):
        linia = f"const fixture = '{NAZWISKO}';  // pubgate:allow"
        self.assertFalse(scan_text("x.ts", linia, cfg_z("kowalsk")))


class SkanHistorii(unittest.TestCase):
    """2026-09-21: cotygodniowy --history dal 285 trafien HARD, z czego 236
    w syntetycznych fixturach z allow_paths - skan historii gubil sciezke
    pliku, wiec allowlista dzialala tylko na drzewie. Bramka czerwona co
    tydzien z powodu fixtur uczy ignorowac czerwien i chowa prawdziwe trafienia."""

    PESEL_SYNTETYCZNY = "44051401359"  # pubgate:allow - przykladowy PESEL z dokumentacji

    def _repo(self, pliki: dict[str, str]) -> Path:
        import subprocess
        root = Path(self.enterContext(__import__("tempfile").TemporaryDirectory()))
        git = ["git", "-C", str(root), "-c", "user.name=t", "-c", "user.email=t@t"]
        subprocess.run(git[:3] + ["init", "-q"], check=True)
        for rel, tresc in pliki.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(tresc, encoding="utf-8")
        subprocess.run(git + ["add", "-A"], check=True)
        subprocess.run(git + ["commit", "-q", "-m", "init"], check=True)
        return root

    def test_allow_paths_dziala_w_historii(self):
        root = self._repo({"fixtures/dane.test.ts": f"pesel {self.PESEL_SYNTETYCZNY}\n"})
        cfg = Config(allow_paths=[".test.ts"])
        self.assertFalse(iter_history(root, cfg))

    def test_historia_nadal_lapie_poza_allow_paths(self):
        root = self._repo({"docs/notatka.md": f"pesel {self.PESEL_SYNTETYCZNY}\n"})
        hits = iter_history(root, Config(allow_paths=[".test.ts"]))
        self.assertEqual([h.kind for h in hits], ["pesel"])
        self.assertIn("docs/notatka.md", hits[0].path)   # trafienie wskazuje plik

    def test_data_z_godzina_to_nie_nip(self):
        # "2026-09-07 12:23" w ADR-0153 - 10 cyfr z poprawna suma NIP przypadkiem
        self.assertFalse(scan_text("adr.md", "chodzila od 2026-09-07 12:23 przez", Config()))

    def test_placeholder_krs_to_nie_trafienie_a_prawdziwy_tak(self):
        self.assertFalse(scan_text("x.md", "przykladowy KRS 0000123456", Config()))
        self.assertTrue(scan_text("x.md", "KRS 0000512346", Config()))  # pubgate:allow

    def test_cyfry_w_hashu_gita_to_nie_nip(self):
        # 2026-10-01: syntetyczny merge PR "Merge <sha> into <sha>" - w hashu
        # siedzi 10 kolejnych cyfr z poprawna suma NIP.
        msg = "Merge 2deba096f6410451136b7733c3265768ddb3fa92 into 41c45da897da980c98336fff69f6f4fee78db18f"
        self.assertFalse(scan_text("commit-msg", msg, Config()))
        # Ta sama liczba GOLA dalej jest trafieniem - wyjatek dotyczy tylko hasha.
        self.assertTrue(scan_text("x.md", "NIP 6410451136", Config()))  # pubgate:allow
        self.assertTrue(scan_text("x.md", "nip:6410451136.", Config()))  # pubgate:allow

    def test_ciag_kolejnych_cyfr_to_nie_nip(self):
        # hex fixture "0123456789abcdef" w tescie innej bramki - "0123456789" ma sume NIP
        self.assertFalse(scan_text("t.py", '"0123456789abcdef0123456789"', Config()))


class ListaZnanychTrafien(unittest.TestCase):
    """2026-09-21, decyzja WM (wariant A): trafienia sprzed czyszczenia zostaja
    w publicznej historii i sa spisane z nazwy commita. Lista ma wyciszac TYLKO
    te commity - kazdy nowy commit z ta sama nazwa w tym samym pliku blokuje."""

    def _f(self, path: str) -> Finding:
        return Finding(HARD, "denylist_hash", path, 1, "token 'xx'")

    def test_znany_commit_jest_wyciszony_a_nowy_nie(self):
        znane = {("abc1234", "denylist_hash", "docs/adr.md")}
        stare = self._f("history@abc1234:docs/adr.md")
        nowe = self._f("history@def5678:docs/adr.md")
        zywe, uznane = split_baseline([stare, nowe], znane)
        self.assertEqual(zywe, [nowe])
        self.assertEqual(uznane, [stare])

    def test_lista_nie_dotyczy_drzewa(self):
        znane = {("abc1234", "denylist_hash", "docs/adr.md")}
        zywe, _ = split_baseline([self._f("docs/adr.md")], znane)
        self.assertEqual(len(zywe), 1)

    def test_wczytanie_pomija_komentarze(self):
        d = Path(self.enterContext(__import__("tempfile").TemporaryDirectory()))
        (d / BASELINE_FILE).write_text("# komentarz\n\nabc1234 denylist_hash docs/a b.md\n",
                                       encoding="utf-8")
        self.assertEqual(load_baseline(d), {("abc1234", "denylist_hash", "docs/a b.md")})


class ListaTylkoDlaOpublikowanych(unittest.TestCase):
    """2026-10-01: lista znanych trafien powstala z `git log --all`, wiec weszly
    do niej commity z prywatnej galezi, ktorych nigdy nie bylo na repo publicznym.
    Lista miala uznawac to, co JUZ wyszlo, a dawala przepustke na przyszla
    publikacje: merge takiej galezi i push na publiczne przeszlyby po cichu.
    Kontrakt: wpis z listy dziala tylko dla commita osiagalnego z refa publicznego,
    a skan zakresu (--candidate) bierze dokladnie to, co publikacja doda."""

    PLIK = "docs/notatka.md"

    def _git(self, *a: str) -> str:
        import subprocess
        return subprocess.run(
            ["git", "-C", str(self.root), "-c", "user.name=t", "-c", "user.email=t@t", *a],
            check=True, capture_output=True, text=True).stdout.strip()

    def _commit(self, rel: str, tresc: str, msg: str) -> str:
        (self.root / rel).parent.mkdir(parents=True, exist_ok=True)
        (self.root / rel).write_text(tresc, encoding="utf-8")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", msg)
        return self._git("rev-parse", "HEAD")

    def setUp(self):
        import json
        self.root = Path(self.enterContext(__import__("tempfile").TemporaryDirectory()))
        self._git("init", "-q")
        self._git("symbolic-ref", "HEAD", "refs/heads/main")
        # Config i lista poza indeksem gita: cyfry w heksie hasha same skladaja
        # sie czasem w REGON, a test ma mierzyc historie, nie wlasny config.
        (self.root / ".git" / "info" / "exclude").write_text(
            f".publication-gate.json\n{BASELINE_FILE}\n", encoding="utf-8")
        (self.root / ".publication-gate.json").write_text(
            json.dumps({"deny_term_hashes": [stem_hash("kowalsk")]}), encoding="utf-8")
        self._commit("README.md", "czysto\n", "init")
        self._git("update-ref", "refs/public/heads/main", "HEAD")
        self._git("checkout", "-q", "-b", "feat")
        # Nazwa wchodzi jednym commitem i znika nastepnym: drzewo jest czyste,
        # zostaje tylko historia - dokladnie kanal, ktorego bramka drzewa nie widzi.
        self.brudny = self._commit(self.PLIK, f"notatka {NAZWISKO}\n", "wip")
        self._commit(self.PLIK, "notatka\n", "sprzatanie")
        (self.root / BASELINE_FILE).write_text(
            f"{self.brudny[:7]} denylist_hash {self.PLIK}\n", encoding="utf-8")

    def _gate(self, *args: str) -> tuple[int, str]:
        import contextlib
        import io
        from publication_gate import main
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = main([str(self.root), *args])
        tekst = out.getvalue() + err.getvalue()
        self.assertNotIn(NAZWISKO.lower(), tekst.lower())   # nazwy nigdy nie drukujemy
        return rc, tekst

    def test_zakres_publikacji_blokuje_wpis_z_listy_spoza_publicznego(self):
        rc, out = self._gate("--candidate", "feat", "--public-ref", "refs/public/heads/main")
        self.assertEqual(rc, 1, out)
        self.assertIn(f"history@{self.brudny[:7]}:{self.PLIK}", out)
        self.assertIn("2 commit(s) to publish", out)

    def test_pelna_historia_nie_uznaje_wpisu_dla_commita_nieopublikowanego(self):
        rc, out = self._gate("--history", "--public-ref", "refs/public/heads/main")
        self.assertEqual(rc, 1, out)
        self.assertIn("not reachable from --public-ref", out)

    def test_ten_sam_commit_osiagalny_z_publicznego_jest_wyciszony(self):
        self._git("update-ref", "refs/public/heads/feat", "feat")
        rc, out = self._gate("--history", "--public-ref", "refs/public/*")
        self.assertEqual(rc, 0, out)
        self.assertIn("1 known historical finding(s)", out)

    def test_zakres_juz_opublikowany_jest_pusty_i_przechodzi_jawnie(self):
        self._git("update-ref", "refs/public/heads/feat", "feat")
        rc, out = self._gate("--candidate", "feat", "--public-ref", "refs/public/*")
        self.assertEqual(rc, 0, out)
        self.assertIn("0 commit(s) to publish", out)

    def test_bez_refa_publicznego_lista_nie_daje_przepustki(self):
        # "Nie wiem, co jest publiczne" blokuje - nie zgadujemy na korzysc przejscia.
        rc, out = self._gate("--history")
        self.assertEqual(rc, 1, out)
        self.assertIn("--public-ref", out)

    def test_nieistniejacy_ref_publiczny_to_blad_nie_pusty_zbior(self):
        rc, _ = self._gate("--history", "--public-ref", "refs/public/heads/brak")
        self.assertEqual(rc, 2)

    def test_glob_bez_trafien_to_blad_nie_pusty_zbior(self):
        rc, _ = self._gate("--candidate", "feat", "--public-ref", "refs/brak/*")
        self.assertEqual(rc, 2)

    def test_candidate_wymaga_refa_publicznego(self):
        rc, _ = self._gate("--candidate", "feat")
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
