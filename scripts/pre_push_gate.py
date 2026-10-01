#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 MateMatic Solutions
"""Bramka pre-push dla linii publicznej - przed faktem, nie po.

Po co to istnieje
-----------------
Bramka publikacji w CI repo publicznego przy zwyklym pushu dziala dopiero PO
pushu, kiedy tresc jest juz publiczna (a GitHub trzyma commity pod SHA nawet
po force-pushu). Przed publikacja chronila tylko sciezka przez PR. Ten hook
uruchamia te sama bramke (`publication_gate.py`) na tym, co push DOKLADA do
repo publicznego, i odmawia pushu, jesli cos znajdzie.

Co sprawdza, przy pushu na remote publiczny:
  - historie, ktora push doklada (`--candidate <sha> --public-ref refs/remotes/<remote>/*`),
  - tresc kazdego dokladanego commita (`--commit-msg`).
Push na kazdy inny remote (prywatny `origin`) przechodzi bez zmian.

Fail-closed: nieznany remote dla URL, brak refow sledzacych, blad bramki -
BLOKADA. Nieaktualne refy sledzace daja ocene OSTRZEJSZA (wiecej commitow
liczy sie jako nowe), nigdy lagodniejsza; wtedy `git fetch <remote>` i ponow.

Obejscie tylko swiadome: PUSH_MIMO_BRAMKI=tak-wiem-co-robie.

    .githooks/pre-push  ->  python scripts/pre_push_gate.py <remote> <url>  (stdin: refy)
"""
from __future__ import annotations

import contextlib
import io
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from publication_gate import main as gate_main  # noqa: E402

ZERO = "0" * 40
PUBLICZNE_DOMYSLNIE = "matematicsolutions/patron"
OBEJSCIE = ("PUSH_MIMO_BRAMKI", "tak-wiem-co-robie")


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True,
                          text=True, encoding="utf-8", errors="replace")


def _norm(url: str) -> str:
    u = url.strip().rstrip("/").lower()
    if u.endswith(".git"):
        u = u[:-4]
    return u.replace("\\", "/").replace(":", "/")


def jest_publiczny(url: str, publiczne: str) -> bool:
    """`git@github.com:org/repo.git`, `https://github.com/org/repo` i sciezka
    lokalna (testy) sprowadzone do jednej postaci; porownanie konca adresu."""
    cel = _norm(publiczne)
    return _norm(url).endswith("/" + cel) or _norm(url) == cel


def nazwa_remote(root: Path, remote: str, url: str) -> str | None:
    """Git podaje jako $1 nazwe remote albo - przy pushu wprost na URL - sam URL.
    Refy sledzace sa pod nazwa, wiec URL tlumaczymy na skonfigurowany remote."""
    if _git(root, "config", "--get", f"remote.{remote}.url").returncode == 0:
        return remote
    lista = _git(root, "remote").stdout.split()
    for r in lista:
        u = _git(root, "config", "--get", f"remote.{r}.url").stdout.strip()
        if u and _norm(u) == _norm(url):
            return r
    return None


def _bramka(*argv: str) -> tuple[int, str]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        rc = gate_main(list(argv))
    return rc, out.getvalue()


def sprawdz(root: Path, remote: str, url: str, wejscie: str,
            env: dict[str, str] | None = None) -> tuple[int, str]:
    env = dict(os.environ) if env is None else env
    log: list[str] = []
    publiczne = env.get("PATRON_PUBLIC_REPO", PUBLICZNE_DOMYSLNIE)
    if not jest_publiczny(url, publiczne):
        return 0, ""
    if env.get(OBEJSCIE[0]) == OBEJSCIE[1]:
        return 0, (f"pre-push: BRAMKA OMINIETA ({OBEJSCIE[0]}) - push na repo publiczne "
                   "bez skanu. To swiadoma decyzja, nie nawyk.")
    nowe = []
    for linia in wejscie.splitlines():
        czesci = linia.split()
        if len(czesci) != 4:
            continue
        _lref, lsha, _rref, _rsha = czesci
        if lsha != ZERO:   # usuniecie galezi nie publikuje tresci
            nowe.append(lsha)
    if not nowe:
        return 0, "pre-push: brak tresci do publikacji (tylko usuniecia)."
    nazwa = nazwa_remote(root, remote, url)
    if nazwa is None:
        return 1, ("pre-push: BLOKADA - push na repo publiczne przez URL, ktorego nie ma "
                   "wsrod remote'ow; bez refow sledzacych nie wiem, co jest publiczne. "
                   "Dodaj remote i zrob `git fetch`.")
    if not _git(root, "for-each-ref", f"refs/remotes/{nazwa}").stdout.strip():
        return 1, (f"pre-push: BLOKADA - brak refow refs/remotes/{nazwa}/*, wiec nie wiem, "
                   f"co jest publiczne. Zrob `git fetch {nazwa}` i ponow.")
    rc = 0
    for sha in nowe:
        r, out = _bramka(str(root), "--candidate", sha, "--public-ref", f"refs/remotes/{nazwa}/*")
        log.append(out.rstrip())
        if r != 0:
            rc = 1
        commity = _git(root, "rev-list", sha, "--not", f"--remotes={nazwa}").stdout.split()
        for c in commity:
            tresc = _git(root, "log", "-1", "--format=%B", c).stdout
            with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False,
                                             encoding="utf-8") as f:
                f.write(tresc)
                sciezka = f.name
            try:
                r, out = _bramka(str(root), "--commit-msg", sciezka)
            finally:
                os.unlink(sciezka)
            if r != 0:
                rc = 1
                log.append(f"{out.rstrip()}\n^ tresc commita {c[:7]}")
    log.append("pre-push: " + ("BLOKADA - push na repo publiczne zatrzymany, nic nie wyszlo."
                               if rc else "OK - bramka publikacji zielona."))
    return rc, "\n".join(x for x in log if x)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print("uzycie: pre_push_gate.py <remote> <url>  (stdin: refy z git pre-push)",
              file=sys.stderr)
        return 2
    root = Path(_git(Path.cwd(), "rev-parse", "--show-toplevel").stdout.strip() or ".")
    rc, tekst = sprawdz(root, argv[1], argv[2], sys.stdin.read())
    if tekst:
        print(tekst, file=sys.stderr)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
