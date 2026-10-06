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
    BASELINE_FILE, HARD, Config, Finding, _fold, _hash_hits, iter_history, iter_tree,
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

    def test_formaty_tokenow_ktorych_uzywamy(self):
        # Wszystkie siedem przechodzilo do 2026-09-24. Tokeny skladane w locie,
        # zeby ten plik nie zatrzymal bramki sam na sobie.
        przypadki = {
            "anthropic_key": "sk-" + "ant-api03-" + "A1b2" * 20,
            "openai_key": "sk-" + "proj-" + "Z9y8" * 12,
            "github_pat": "github" + "_pat_" + "1A" * 11 + "_" + "Bc" * 30,
            "github_token": "gh" + "o_" + "C3" * 18,
            "huggingface_token": "hf" + "_" + "D4" * 17,
            "pypi_token": "pypi-" + "AgEIcHlwaS5vcmc" + "E5" * 30,
            "npm_token": "npm" + "_" + "F6" * 18,
        }
        for rodzaj, token in przypadki.items():
            with self.subTest(rodzaj=rodzaj):
                self.assertIn(rodzaj, {f.kind for f in scan_text("x.md", f"t {token} t", Config())})
        for podobne in ["hf_hub_download(repo)", "npm_config_cache", "sk-learn to biblioteka",
                        "github_pat_ placeholder"]:
            with self.subTest(podobne=podobne):
                self.assertFalse(scan_text("x.md", podobne, Config()))


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
        import os
        if os.name == "nt" and any(z in rel for z in '\t"<>|?*:'):
            # NTFS nie dopuszcza tej nazwy w drzewie roboczym, historia gita tak:
            # wpis idzie przez indeks, wyjscie `git log` jest to samo co na POSIX.
            tmp = self.root / ".git" / "selftest-blob.tmp"
            tmp.write_text(tresc, encoding="utf-8")
            blob = self._git("hash-object", "-w", str(tmp))
            tmp.unlink()
            self._git("-c", "core.protectNTFS=false", "update-index", "--add", "--cacheinfo", f"100644,{blob},{rel}")
        else:
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


def nip_testowy(start: int = 123456780) -> str:
    """NIP z poprawna suma WYLICZONY, nie wpisany - w pliku nie ma numeru,
    ktory bramka drzewa moglaby zlapac."""
    wagi = [6, 5, 7, 2, 3, 4, 5, 6, 7]
    for poczatek in range(start, start + 1000):
        d = [int(c) for c in str(poczatek)]
        k = sum(w * x for w, x in zip(wagi, d)) % 11
        if k != 10:
            return str(poczatek) + str(k)
    raise AssertionError("brak poprawnego NIP w zakresie")


class HashANumerSklejony(unittest.TestCase):
    """R-TI-07 (f), 2026-10-02: `_w_hashu` uznawal za hash kazdy token hex >= 7
    znakow z litera a-f, wiec `id=a<NIP>` przechodzil. Hash to dlugosc hasha."""

    def test_nip_sklejony_z_litera_a_f_jest_trafieniem(self):
        nip = nip_testowy()
        for tekst in (f"klient id=a{nip}", f"x {nip}f y", f"ref=ab{nip}cd"):
            with self.subTest(tekst=tekst):
                self.assertEqual([f.kind for f in scan_text("x.md", tekst, Config())], ["nip"])

    def test_pelny_hash_z_tym_samym_numerem_dalej_nie_jest_trafieniem(self):
        nip = nip_testowy()
        sha = ("ab" + nip + "cdef" * 7)[:40]
        self.assertEqual(len(sha), 40)
        self.assertFalse(scan_text("commit-msg", f"Merge {sha} into main", Config()))


class _RepoHistorii(unittest.TestCase):
    """Prawdziwe repo gita w tempdir - parser `git log` sprawdzamy na wyjsciu gita,
    nie na recznie napisanym diffie."""

    def _git(self, *a: str, check: bool = True) -> str:
        import subprocess
        return subprocess.run(
            ["git", "-C", str(self.root), "-c", "user.name=t", "-c", "user.email=t@t", *a],
            check=check, capture_output=True, text=True).stdout.strip()

    def _commit(self, rel: str, tresc: str, msg: str) -> str:
        import os
        if os.name == "nt" and any(z in rel for z in '\t"<>|?*:'):
            # NTFS nie dopuszcza tej nazwy w drzewie roboczym, historia gita tak:
            # wpis idzie przez indeks, wyjscie `git log` jest to samo co na POSIX.
            tmp = self.root / ".git" / "selftest-blob.tmp"
            tmp.write_text(tresc, encoding="utf-8")
            blob = self._git("hash-object", "-w", str(tmp))
            tmp.unlink()
            self._git("-c", "core.protectNTFS=false", "update-index", "--add", "--cacheinfo", f"100644,{blob},{rel}")
        else:
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
        (self.root / ".git" / "info" / "exclude").write_text(".publication-gate.json\n",
                                                            encoding="utf-8")
        self.cfg = Config(deny_term_hashes=[stem_hash("kowalsk")],
                          deny_paths=[".matematic/", ".claude/"], allow_paths=[".test.ts"])
        (self.root / ".publication-gate.json").write_text(json.dumps(
            {"deny_term_hashes": self.cfg.deny_term_hashes, "deny_paths": self.cfg.deny_paths,
             "allow_paths": self.cfg.allow_paths}), encoding="utf-8")
        tresc = "".join(f"linia {i} zwyklego dokumentu\n" for i in range(30))
        self.baza = self._commit("docs/a.md", tresc, "init")
        self._git("update-ref", "refs/public/heads/main", self.baza)

    def _gate(self, *args: str) -> tuple[int, str]:
        import contextlib
        import io
        from publication_gate import main
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            rc = main([str(self.root), *args])
        return rc, out.getvalue()

    def _candidate(self, rev: str = "HEAD") -> tuple[int, str]:
        return self._gate("--candidate", rev, "--public-ref", "refs/public/*")


class SciezkiZabronioneWHistorii(_RepoHistorii):
    """R-TI-07 (a): `deny_paths` dzialalo tylko w drzewie, wiec commit dodajacy
    `.matematic/...` bez PII przechodzil skan zakresu publikacji (pre-push, CI)."""

    def test_candidate_blokuje_plik_z_prywatnego_warsztatu(self):
        self._commit(".matematic/releases/x/README.md", "plan wydania\n", "docs: notatka")
        rc, out = self._candidate()
        self.assertEqual(rc, 1, out)
        self.assertIn("denied_path", out)
        self.assertIn(".matematic/releases/x/README.md", out)

    def test_rename_do_warsztatu_tez_blokuje(self):
        (self.root / ".claude").mkdir()
        self._git("mv", "docs/a.md", ".claude/a.md")
        self._git("commit", "-q", "-m", "przenies")
        rc, out = self._candidate()
        self.assertEqual(rc, 1, out)
        self.assertIn(".claude/a.md", out)

    def test_sciezka_zabroniona_wygrywa_z_allow_paths_i_rozszerzeniem(self):
        self._commit(".matematic/x.test.ts", "test\n", "a")
        self._commit(".matematic/plan.pdf", "pdf\n", "b")
        rc, out = self._candidate()
        self.assertEqual(rc, 1, out)
        self.assertIn(".matematic/x.test.ts", out)
        self.assertIn(".matematic/plan.pdf", out)
        findings, _ = iter_tree(self.root, self.cfg)   # drzewo: ta sama polityka
        self.assertEqual(sorted(f.path for f in findings if f.kind == "denied_path"),
                         [".matematic/plan.pdf", ".matematic/x.test.ts"])

    def test_pelna_historia_liczy_opublikowane_osobno_a_nowe_blokuje(self):
        self._commit(".matematic/stare.md", "x\n", "stare")
        self._git("rm", "-q", ".matematic/stare.md")   # wyszlo, potem usuniete z drzewa
        self._git("commit", "-q", "-m", "sprzatanie")
        self._git("update-ref", "refs/public/heads/main", "HEAD")
        rc, out = self._gate("--history", "--public-ref", "refs/public/*")
        self.assertEqual(rc, 0, out)
        self.assertIn("1 denied_path finding(s) in commits already reachable", out)
        self._commit(".matematic/nowe.md", "y\n", "nowe")
        rc, out = self._gate("--history", "--public-ref", "refs/public/*")
        self.assertEqual(rc, 1, out)
        self.assertRegex(out, r"history@[0-9a-f]{7}:\.matematic/nowe\.md")

    def test_zwykly_plik_przechodzi(self):
        self._commit("docs/b.md", "zwykla zmiana\n", "docs")
        rc, out = self._candidate()
        self.assertEqual(rc, 0, out)


class RenameWHistorii(_RepoHistorii):
    """R-TI-07 (b): `--diff-filter=AM` pomijal status R - `git mv` z dopisanym
    numerem przechodzil. Czysty rename z allow_paths nie pokazywal tresci wcale."""

    def test_git_mv_z_dopisanym_numerem_jest_trafieniem(self):
        self._git("mv", "docs/a.md", "docs/b.md")
        p = self.root / "docs" / "b.md"
        p.write_text(p.read_text(encoding="utf-8") + f"NIP {nip_testowy()}\n", encoding="utf-8")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", "przenies")
        hits = iter_history(self.root, self.cfg, ["HEAD", "--not", self.baza])
        self.assertEqual([(h.kind, h.path.split(":", 1)[1]) for h in hits],
                         [("nip", "docs/b.md")])

    def test_nietypowe_nazwy_plikow_nie_gubia_tresci_ani_sciezki(self):
        # git cytuje w naglowku diffu nazwy z tabulatorem/cudzyslowem i dokleja
        # tabulator do nazw ze spacja; nierozpoznana sciezka nie moze wyciszyc tresci.
        nazwy = ["docs/a b.md", "docs/t\tz.md", 'docs/zólw"q.md']
        for n in nazwy:
            self._commit(n, f"NIP {nip_testowy()}\n", "dodaj")
        hits = iter_history(self.root, self.cfg, ["HEAD", "--not", self.baza])
        self.assertEqual(sorted(h.path.split(":", 1)[1] for h in hits), sorted(nazwy))

    def test_rename_z_allow_paths_do_zwyklej_sciezki_pokazuje_tresc(self):
        self._commit("fixtures/dane.test.ts", f"nip {nip_testowy()}\n", "fixture")
        self._git("update-ref", "refs/public/heads/main", "HEAD")
        self._git("mv", "fixtures/dane.test.ts", "docs/dane.md")
        self._git("commit", "-q", "-m", "przenies fixture")
        rc, out = self._candidate()
        self.assertEqual(rc, 1, out)
        self.assertIn("docs/dane.md", out)


class MergeWHistorii(_RepoHistorii):
    """R-TI-07 (c): `git log -p` nie pokazuje diffu merge'a, wiec numer wpisany
    przy rozwiazywaniu merge'a ("evil merge") przechodzil."""

    def _galezie(self) -> None:
        self._git("checkout", "-q", "-b", "x")
        self._commit("docs/x.md", "x\n", "x")
        self._git("checkout", "-q", "main")
        self._commit("docs/y.md", "y\n", "y")

    def test_numer_dodany_w_rozwiazaniu_merge_jest_trafieniem(self):
        self._galezie()
        self._git("merge", "-q", "--no-commit", "--no-ff", "x", check=False)
        (self.root / "docs" / "y.md").write_text(f"y\nNIP {nip_testowy()}\n", encoding="utf-8")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", "Merge branch x")
        merge = self._git("rev-parse", "HEAD")
        hits = iter_history(self.root, self.cfg, ["HEAD", "--not", self.baza])
        self.assertEqual([(h.kind, h.path) for h in hits],
                         [("nip", f"history@{merge[:7]}:docs/y.md")])

    def test_plik_z_warsztatu_dodany_w_merge_jest_trafieniem(self):
        self._galezie()
        self._git("merge", "-q", "--no-commit", "--no-ff", "x", check=False)
        (self.root / ".claude").mkdir()
        (self.root / ".claude" / "notatka.md").write_text("plan\n", encoding="utf-8")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", "Merge branch x")
        rc, out = self._candidate()
        self.assertEqual(rc, 1, out)
        self.assertIn(".claude/notatka.md", out)

    def test_zwykly_merge_nie_liczy_tresci_rodzica_drugi_raz(self):
        self._git("checkout", "-q", "-b", "x")
        zly = self._commit("docs/x.md", f"NIP {nip_testowy()}\n", "x")
        self._git("checkout", "-q", "main")
        self._commit("docs/y.md", "y\n", "y")
        self._git("merge", "-q", "--no-ff", "-m", "Merge branch x", "x")
        hits = iter_history(self.root, self.cfg, ["HEAD", "--not", self.baza])
        self.assertEqual([h.path for h in hits], [f"history@{zly[:7]}:docs/x.md"])


class HistoriaFailClosed(_RepoHistorii):
    """R-TI-07 (d): blad `git log` dawal "history scan unavailable" i pusta liste
    trafien - czyli PASS. Bramka, ktora nie przeczytala historii, nie przepuszcza."""

    def _zgub_blob(self) -> None:
        s = self._commit("docs/n.md", f"NIP {nip_testowy()}\n", "notatka")
        blob = self._git("rev-parse", f"{s}:docs/n.md")
        obj = self.root / ".git" / "objects" / blob[:2] / blob[2:]
        obj.chmod(0o644)  # Windows: obiekt gita jest tylko-do-odczytu
        obj.unlink()

    def test_brakujacy_obiekt_to_wyjatek_nie_pusta_lista(self):
        from publication_gate import HistoryScanError
        self._zgub_blob()
        with self.assertRaises(HistoryScanError):
            iter_history(self.root, self.cfg, ["HEAD", "--not", self.baza])

    def test_candidate_i_history_koncza_sie_kodem_2_i_blokada(self):
        self._zgub_blob()
        for args in (("--candidate", "HEAD", "--public-ref", "refs/public/*"),
                     ("--history", "--public-ref", "refs/public/*")):
            with self.subTest(args=args):
                rc, out = self._gate(*args)
                self.assertEqual(rc, 2, out)
                self.assertIn("history scan FAILED", out)
                self.assertIn("RESULT: BLOCK", out)

    def test_nieczytelna_tresc_commita_to_blokada(self):
        rc, out = self._gate("--commit-msg", str(self.root / "nie-ma-takiego-pliku"))
        self.assertEqual(rc, 2, out)


class SkanTekstu(_RepoHistorii):
    """`--text`: tresc tagu adnotowanego i nazwy refow (R-TI-07 (e)) - te same
    detektory co drzewo, bez reguly diakrytykow z tresci commita."""

    def _plik(self, tresc: str) -> Path:
        p = self.root / ".git" / "TEKST"
        p.write_text(tresc, encoding="utf-8")
        return p

    def test_nazwa_z_denylisty_blokuje(self):
        rc, out = self._gate("--text", str(self._plik(f"Wydanie dla {NAZWISKO}\n")))
        self.assertEqual(rc, 1, out)
        self.assertNotIn(NAZWISKO.lower(), out.lower())

    def test_czysty_tekst_z_ogonkami_przechodzi(self):
        rc, out = self._gate("--text", str(self._plik("Wydanie 1.4.0: poprawki źródeł\n")))
        self.assertEqual(rc, 0, out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
