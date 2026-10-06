#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 MateMatic Solutions
"""Kontrola pozytywna bramki pre-push (scripts/pre_push_gate.py) - stdlib.

Prawdziwe repo gita w katalogu tymczasowym + "publiczny" bare remote. Numer
NIP do testow jest WYLICZANY (suma kontrolna), nie wpisany - w tym pliku nie
ma zadnego identyfikatora, ktory bramka drzewa moglaby zlapac.

    python scripts/pre_push_gate_selftest.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pre_push_gate import ZERO, jest_publiczny, sprawdz  # noqa: E402
from publication_gate import stem_hash  # noqa: E402


def nip_testowy(start: int = 123456780) -> str:
    wagi = [6, 5, 7, 2, 3, 4, 5, 6, 7]
    for poczatek in range(start, start + 1000):
        d = [int(c) for c in str(poczatek)]
        k = sum(w * x for w, x in zip(wagi, d)) % 11
        if k != 10:
            return str(poczatek) + str(k)
    raise AssertionError("brak poprawnego NIP w zakresie")


class BramkaPrePush(unittest.TestCase):
    def _git(self, *a: str, cwd: Path | None = None) -> str:
        return subprocess.run(
            ["git", "-C", str(cwd or self.root), "-c", "user.name=t", "-c", "user.email=t@t", *a],
            check=True, capture_output=True, text=True).stdout.strip()

    def _commit(self, rel: str, tresc: str, msg: str) -> str:
        (self.root / rel).parent.mkdir(parents=True, exist_ok=True)
        (self.root / rel).write_text(tresc, encoding="utf-8")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", msg)
        return self._git("rev-parse", "HEAD")

    def setUp(self):
        tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.publiczne = tmp / "publiczne.git"
        self.prywatne = tmp / "prywatne.git"
        for b in (self.publiczne, self.prywatne):
            subprocess.run(["git", "init", "-q", "--bare", str(b)], check=True)
        self.root = tmp / "repo"
        self.root.mkdir()
        self._git("init", "-q")
        self._git("symbolic-ref", "HEAD", "refs/heads/main")
        (self.root / ".git" / "info" / "exclude").write_text(".publication-gate.json\n", encoding="utf-8")
        (self.root / ".publication-gate.json").write_text(
            json.dumps({"deny_term_hashes": [stem_hash("kowalsk")],
                        "deny_paths": [".matematic/", ".claude/"]}), encoding="utf-8")
        self.baza = self._commit("README.md", "czysto\n", "init")
        self._git("remote", "add", "mat", str(self.publiczne))
        self._git("remote", "add", "origin", str(self.prywatne))
        self._git("push", "-q", "mat", "main")
        self._git("push", "-q", "origin", "main")
        self._git("fetch", "-q", "mat")
        self.env = {"PATRON_PUBLIC_REPO": str(self.publiczne)}

    def _push(self, sha: str, remote: str = "mat", url: str | None = None, env=None):
        url = url or str(self.publiczne if remote == "mat" else self.prywatne)
        linia = f"refs/heads/main {sha} refs/heads/main {self.baza}\n"
        return sprawdz(self.root, remote, url, linia, env if env is not None else self.env)

    def test_rozpoznaje_adres_publiczny_w_kazdej_postaci(self):
        for u in ("https://github.com/matematicsolutions/patron.git",
                  "git@github.com:matematicsolutions/patron.git",
                  "https://github.com/MateMaticSolutions/Patron/"):
            self.assertTrue(jest_publiczny(u, "matematicsolutions/patron"), u)
        for u in ("https://github.com/mazurwieslaw2022-cmd/patron-desktop.git",
                  "https://github.com/matematicsolutions/patron-desktop.git"):
            self.assertFalse(jest_publiczny(u, "matematicsolutions/patron"), u)

    def test_czysty_commit_przechodzi(self):
        sha = self._commit("docs/a.md", "zwykla zmiana\n", "docs: zmiana")
        rc, out = self._push(sha)
        self.assertEqual(rc, 0, out)
        self.assertIn("OK", out)

    def test_numer_w_tresci_pliku_blokuje(self):
        sha = self._commit("docs/a.md", f"numer {nip_testowy()}\n", "docs: notatka")
        rc, out = self._push(sha)
        self.assertEqual(rc, 1, out)
        self.assertIn("BLOKADA", out)

    def test_numer_dodany_i_usuniety_tez_blokuje(self):
        # Drzewo koncowe czyste - zostaje tylko historia, ktorej bramka drzewa nie widzi.
        self._commit("docs/a.md", f"numer {nip_testowy()}\n", "wip")
        sha = self._commit("docs/a.md", "czysto\n", "sprzatanie")
        rc, out = self._push(sha)
        self.assertEqual(rc, 1, out)

    def test_numer_w_tresci_commita_blokuje(self):
        sha = self._commit("docs/a.md", "zmiana\n", f"fix: dla {nip_testowy()}")
        rc, out = self._push(sha)
        self.assertEqual(rc, 1, out)
        self.assertIn("tresc commita", out)

    def test_push_na_prywatny_nie_jest_sprawdzany(self):
        sha = self._commit("docs/a.md", f"numer {nip_testowy()}\n", "wip")
        rc, out = self._push(sha, remote="origin")
        self.assertEqual(rc, 0, out)
        self.assertEqual(out, "")

    def test_push_wprost_na_url_znajduje_remote(self):
        sha = self._commit("docs/a.md", f"numer {nip_testowy()}\n", "wip")
        rc, out = sprawdz(self.root, str(self.publiczne), str(self.publiczne),
                          f"refs/heads/main {sha} refs/heads/main {self.baza}\n", self.env)
        self.assertEqual(rc, 1, out)

    def test_brak_refow_sledzacych_blokuje(self):
        sha = self._commit("docs/a.md", "zwykla zmiana\n", "docs: zmiana")
        for r in self._git("for-each-ref", "--format=%(refname)", "refs/remotes/mat").split():
            self._git("update-ref", "-d", r)
        rc, out = self._push(sha)
        self.assertEqual(rc, 1, out)
        self.assertIn("nie wiem, co jest publiczne", out)

    def test_nieznany_url_publiczny_blokuje(self):
        sha = self._commit("docs/a.md", "zwykla zmiana\n", "docs: zmiana")
        inny = str(self.publiczne.parent / "inny" / "publiczne.git")
        rc, out = sprawdz(self.root, inny, inny,
                          f"refs/heads/main {sha} refs/heads/main {self.baza}\n",
                          {"PATRON_PUBLIC_REPO": "publiczne"})
        self.assertEqual(rc, 1, out)

    def test_samo_usuniecie_galezi_przechodzi(self):
        rc, out = sprawdz(self.root, "mat", str(self.publiczne),
                          f"(delete) {ZERO} refs/heads/stara {self.baza}\n", self.env)
        self.assertEqual(rc, 0, out)

    def test_prawdziwy_git_push_przez_hook(self):
        # Pelna sciezka: git -> hook sh -> python main() -> stdin z refami. Testy
        # wyzej wolaja logike bezposrednio; ten sprawdza, ze hook NAPRAWDE
        # zatrzymuje push, a repo publiczne nie dostaje commita.
        import os
        import shlex
        hooks = self.root.parent / "hooks"
        hooks.mkdir()
        skrypt = (Path(__file__).resolve().parent / "pre_push_gate.py").as_posix()
        (hooks / "pre-push").write_text(
            f'#!/bin/sh\nexec python {shlex.quote(skrypt)} "$1" "$2"\n', encoding="utf-8")
        os.chmod(hooks / "pre-push", 0o755)
        self._git("config", "core.hooksPath", hooks.as_posix())
        env = {**os.environ, **self.env, "PYTHONUTF8": "1"}

        def push() -> subprocess.CompletedProcess[str]:
            return subprocess.run(["git", "-C", str(self.root), "push", "mat", "HEAD:main"],
                                  capture_output=True, text=True, env=env)

        zly = self._commit("docs/a.md", f"numer {nip_testowy()}\n", "wip")
        r = push()
        self.assertNotEqual(r.returncode, 0, r.stderr)
        self.assertIn("BLOKADA", r.stderr)
        publiczne_main = subprocess.run(["git", "-C", str(self.publiczne), "rev-parse", "main"],
                                        capture_output=True, text=True).stdout.strip()
        self.assertEqual(publiczne_main, self.baza)   # nic nie wyszlo
        self.assertNotEqual(publiczne_main, zly)
        # Po usunieciu tresci z historii (nowa galaz od czystej bazy) push przechodzi.
        self._git("reset", "-q", "--hard", self.baza)
        self._commit("docs/a.md", "czysto\n", "docs: zmiana")
        r = push()
        self.assertEqual(r.returncode, 0, r.stderr)

    # --- R-TI-07 (2026-10-02): sondy backend/audit-2609/sondy/ jako testy -------

    def test_a_plik_z_prywatnego_warsztatu_blokuje(self):
        sha = self._commit(".matematic/releases/x/README.md", "plan wydania\n", "docs: notatka")
        rc, out = self._push(sha)
        self.assertEqual(rc, 1, out)
        self.assertIn("denied_path", out)

    def test_b_git_mv_z_dopisanym_numerem_blokuje(self):
        # Plik dosc duzy, by git uznal zmiane za rename (status R), nie D + A.
        tresc = "".join(f"linia {i} tresci publicznej\n" for i in range(40))
        self._git("update-ref", "refs/remotes/mat/main", self._commit("docs/duzy.md", tresc, "duzy"))
        self._git("mv", "docs/duzy.md", "CZYTAJ.md")
        (self.root / "CZYTAJ.md").write_text(f"{tresc}numer {nip_testowy()}\n", encoding="utf-8")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", "przenies")
        rc, out = self._push(self._git("rev-parse", "HEAD"))
        self.assertEqual(rc, 1, out)
        self.assertIn("CZYTAJ.md", out)

    def test_c_numer_w_rozwiazaniu_merge_blokuje(self):
        self._git("checkout", "-q", "-b", "x")
        self._commit("docs/x.md", "x\n", "x")
        self._git("checkout", "-q", "main")
        self._commit("docs/y.md", "y\n", "y")
        subprocess.run(["git", "-C", str(self.root), "merge", "-q", "--no-commit", "--no-ff", "x"],
                       capture_output=True)
        (self.root / "docs" / "y.md").write_text(f"y\nnumer {nip_testowy()}\n", encoding="utf-8")
        self._git("add", "-A")
        self._git("commit", "-q", "-m", "Merge branch x")
        rc, out = self._push(self._git("rev-parse", "HEAD"))
        self.assertEqual(rc, 1, out)
        self.assertIn("docs/y.md", out)

    def test_d_blad_odczytu_historii_blokuje(self):
        sha = self._commit("docs/a.md", "zwykla zmiana\n", "docs: zmiana")
        blob = self._git("rev-parse", f"{sha}:docs/a.md")
        obj = self.root / ".git" / "objects" / blob[:2] / blob[2:]
        obj.chmod(0o644)  # Windows: obiekt gita jest tylko-do-odczytu
        obj.unlink()
        rc, out = self._push(sha)
        self.assertEqual(rc, 1, out)
        self.assertIn("history scan FAILED", out)

    def _tag(self, nazwa: str, msg: str, cel: str, data: str | None = None) -> str:
        import os
        env = {**os.environ, "GIT_COMMITTER_DATE": data} if data else None
        subprocess.run(["git", "-C", str(self.root), "-c", "user.name=t", "-c", "user.email=t@t",
                        "-c", "advice.nestedTag=false", "tag", "-a", nazwa, "-m", msg, cel], check=True, env=env)
        return self._git("rev-parse", f"refs/tags/{nazwa}")

    def _push_tagu(self, sha: str, nazwa: str):
        linia = f"refs/tags/{nazwa} {sha} refs/tags/{nazwa} {ZERO}\n"
        return sprawdz(self.root, "mat", str(self.publiczne), linia, self.env)

    def test_e_tresc_tagu_adnotowanego_blokuje(self):
        sha = self._tag("v9", "Wydanie dla kancelarii Kowalskiego", self.baza)
        rc, out = self._push_tagu(sha, "v9")
        self.assertEqual(rc, 1, out)
        self.assertIn("tresc tagow", out)
        self.assertNotIn("kowalsk", out.lower())   # nazwy nigdy nie drukujemy

    def test_e_tag_na_tag_tez_jest_rozwijany(self):
        wew = self._tag("wew", "Wydanie dla Kowalskiej", self.baza)
        zew = self._tag("zew", "czysty opis", wew)
        rc, out = self._push_tagu(zew, "zew")
        self.assertEqual(rc, 1, out)

    def test_e_czysty_tag_przechodzi_a_czas_w_naglowku_to_nie_numer(self):
        # Znacznik czasu tagu (10 cyfr) wybrany tak, by mial poprawna sume NIP:
        # naglowek tagu nie jest trescia i nie moze blokowac.
        czas = int(nip_testowy(175900000))
        sha = self._tag("v10", "Wydanie 1.4.0", self.baza, f"@{czas} +0000")
        self.assertIn(str(czas), self._git("cat-file", "tag", sha))
        rc, out = self._push_tagu(sha, "v10")
        self.assertEqual(rc, 0, out)

    def test_e_tag_na_blob_blokuje(self):
        blob = self._git("rev-parse", f"{self.baza}:README.md")
        sha = self._tag("plik", "opis", blob)
        rc, out = self._push_tagu(sha, "plik")
        self.assertEqual(rc, 1, out)
        self.assertIn("blob", out)

    def test_nazwa_galezi_z_denylisty_blokuje(self):
        sha = self._commit("docs/a.md", "zwykla zmiana\n", "docs: zmiana")
        linia = f"refs/heads/main {sha} refs/heads/dla-kowalskiej {ZERO}\n"
        rc, out = sprawdz(self.root, "mat", str(self.publiczne), linia, self.env)
        self.assertEqual(rc, 1, out)

    def test_f_numer_sklejony_z_litera_a_f_blokuje(self):
        sha = self._commit("docs/a.md", f"klient id=a{nip_testowy()}\n", "docs: notatka")
        rc, out = self._push(sha)
        self.assertEqual(rc, 1, out)

    def _origin_z_pushurl_publicznym(self, prywatny_stan: str) -> None:
        self._git("config", "--add", "remote.origin.pushurl", str(self.prywatne))
        self._git("config", "--add", "remote.origin.pushurl", str(self.publiczne))
        self._git("update-ref", "refs/remotes/origin/main", prywatny_stan)

    def test_g_pushurl_publiczny_bierze_stan_z_remote_publicznego(self):
        # origin pobiera z PRYWATNEGO; jego refy maja commit z numerem, ktorego
        # na publicznym nie ma. Bramka ma wziac refy 'mat' (url publiczny).
        prywatny = self._commit("notatki/klient.md", f"numer {nip_testowy()}\n", "notatka")
        self._origin_z_pushurl_publicznym(prywatny)
        sha = self._commit("README.md", "czysto 2\n", "popraw readme")
        rc, out = self._push(sha, remote="origin", url=str(self.publiczne))
        self.assertEqual(rc, 1, out)
        self.assertIn("notatki/klient.md", out)

    def test_g_pushurl_publiczny_bez_remote_publicznego_blokuje(self):
        prywatny = self._commit("docs/a.md", "zwykla zmiana\n", "docs: zmiana")
        self._origin_z_pushurl_publicznym(prywatny)
        self._git("remote", "remove", "mat")
        rc, out = self._push(prywatny, remote="origin", url=str(self.publiczne))
        self.assertEqual(rc, 1, out)
        self.assertIn("pobiera z innego adresu", out)

    def test_g_rozne_zapisy_tego_samego_adresu_to_jeden_remote(self):
        from pre_push_gate import _norm
        warianty = ("git@github.com:matematicsolutions/patron.git",
                    "ssh://git@github.com/matematicsolutions/patron",
                    "https://github.com/MateMaticSolutions/patron.git/")
        self.assertEqual({_norm(u) for u in warianty}, {"github.com/matematicsolutions/patron"})

    def test_nieczytelna_linia_refow_blokuje(self):
        rc, out = sprawdz(self.root, "mat", str(self.publiczne), "smiec\n", self.env)
        self.assertEqual(rc, 1, out)

    def test_obejscie_tylko_swiadome_i_glosne(self):
        sha = self._commit("docs/a.md", f"numer {nip_testowy()}\n", "wip")
        rc, out = self._push(sha, env={**self.env, "PUSH_MIMO_BRAMKI": "tak"})
        self.assertEqual(rc, 1, out)   # zla wartosc nie omija
        rc, out = self._push(sha, env={**self.env, "PUSH_MIMO_BRAMKI": "tak-wiem-co-robie"})
        self.assertEqual(rc, 0)
        self.assertIn("OMINIETA", out)


if __name__ == "__main__":
    unittest.main(verbosity=1)
