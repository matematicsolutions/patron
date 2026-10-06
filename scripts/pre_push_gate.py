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
  - historie, ktora push doklada (`--candidate <sha> --public-ref refs/remotes/<remote>/*`):
    dodane linie (takze po rename'ie i w rozwiazaniu merge'a) oraz sciezki z
    `deny_paths` (`.matematic/`, `.claude/` ...),
  - tresc kazdego dokladanego commita (`--commit-msg`),
  - tresc kazdego pushowanego tagu adnotowanego i nazwy pushowanych refow (`--text`).
Push na kazdy inny remote (prywatny `origin`) przechodzi bez zmian.

Skad wiemy, co jest juz publiczne: z refow sledzacych remote'u, ktory POBIERA
(url, nie pushurl) z repo publicznego. Remote z `url` prywatnym i `pushurl`
publicznym (lustro "push do obu") ma pod refs/remotes/<nazwa>/* stan PRYWATNY -
uznanie go za publiczny przepuszczaloby prywatna historie (pomiar 2026-10-02,
sonda probe_pushurl.py). Wtedy bierzemy refy innego remote'u z publicznym url,
a gdy takiego nie ma - BLOKADA.

Fail-closed: nieznany remote dla URL, brak refow sledzacych, blad bramki albo
gita, tag na cos innego niz commit, nieczytelna linia z refami - BLOKADA.
Nieaktualne refy sledzace daja ocene OSTRZEJSZA (wiecej commitow liczy sie jako
nowe), nigdy lagodniejsza; wtedy `git fetch <remote>` i ponow.

Obejscie tylko swiadome: PUSH_MIMO_BRAMKI=tak-wiem-co-robie.

    .githooks/pre-push  ->  python scripts/pre_push_gate.py <remote> <url>  (stdin: refy)
"""
from __future__ import annotations

import contextlib
import io
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from publication_gate import main as gate_main  # noqa: E402

ZERO = "0" * 40
PUBLICZNE_DOMYSLNIE = "matematicsolutions/patron"
OBEJSCIE = ("PUSH_MIMO_BRAMKI", "tak-wiem-co-robie")
_SCHEMAT = re.compile(r"^[a-z][a-z0-9+.-]*://")
_UZYTKOWNIK = re.compile(r"^[^/@]+@")
_PODPIS = re.compile(r"-----BEGIN (?:PGP|SSH) SIGNATURE-----.*?-----END (?:PGP|SSH) SIGNATURE-----",
                     re.DOTALL)


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True,
                          text=True, encoding="utf-8", errors="replace")


def _norm(url: str) -> str:
    """Jedna postac adresu: bez schematu, uzytkownika, `.git` i koncowego `/`.
    `git@github.com:org/repo.git`, `ssh://git@github.com/org/repo` i
    `https://github.com/org/repo/` daja `github.com/org/repo`."""
    u = url.strip().replace("\\", "/").rstrip("/").lower()
    if u.endswith(".git"):
        u = u[:-4]
    u = _SCHEMAT.sub("", u)
    u = _UZYTKOWNIK.sub("", u)
    return u.replace(":", "/")


def jest_publiczny(url: str, publiczne: str) -> bool:
    """`git@github.com:org/repo.git`, `https://github.com/org/repo` i sciezka
    lokalna (testy) sprowadzone do jednej postaci; porownanie konca adresu."""
    cel = _norm(publiczne)
    return _norm(url).endswith("/" + cel) or _norm(url) == cel


def _url_pobierania(root: Path, remote: str) -> str:
    return _git(root, "config", "--get", f"remote.{remote}.url").stdout.strip()


def remoty_publiczne(root: Path, remote: str, url: str) -> tuple[list[str], str]:
    """Remote'y, ktorych refy sledzace opisuja stan repo, NA KTORE idzie push.

    Git podaje jako $1 nazwe remote albo - przy pushu wprost na URL - sam URL.
    Refy sledzace pochodza z `fetch`, wiec liczy sie `remote.<n>.url`, nie
    `pushurl`: remote pobierajacy z repo prywatnego nie wie nic o publicznym.
    Zwraca (nazwy, powod_blokady); pusta lista = blokada z podanym powodem."""
    lista = _git(root, "remote").stdout.split()
    cel = _norm(url)
    if remote in lista and _norm(_url_pobierania(root, remote)) == cel:
        return [remote], ""
    pasujace = [r for r in lista if _norm(_url_pobierania(root, r)) == cel]
    if pasujace:
        return pasujace, ""
    if remote in lista:
        return [], (f"pre-push: BLOKADA - remote '{remote}' pushuje na repo publiczne "
                    f"(pushurl), ale pobiera z innego adresu, wiec refs/remotes/{remote}/* "
                    "to NIE jest stan repo publicznego. Dodaj remote pobierajacy z repo "
                    "publicznego (`git remote add <nazwa> <url-publiczny>`), zrob "
                    "`git fetch <nazwa>` i ponow.")
    return [], ("pre-push: BLOKADA - push na repo publiczne przez URL, ktorego nie ma "
                "wsrod remote'ow; bez refow sledzacych nie wiem, co jest publiczne. "
                "Dodaj remote i zrob `git fetch`.")


def nazwa_remote(root: Path, remote: str, url: str) -> str | None:
    """Zgodnosc wsteczna: pierwszy remote opisujacy repo docelowe albo None."""
    nazwy, _ = remoty_publiczne(root, remote, url)
    return nazwy[0] if nazwy else None


def _bramka(*argv: str) -> tuple[int, str]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        rc = gate_main(list(argv))
    return rc, out.getvalue()


def _bramka_na_tekscie(root: Path, tryb: str, tresc: str, etykieta: str) -> tuple[int, str]:
    with tempfile.NamedTemporaryFile("w", prefix=f"{etykieta}-", suffix=".txt", delete=False,
                                     encoding="utf-8") as f:
        f.write(tresc)
        sciezka = f.name
    try:
        return _bramka(str(root), tryb, sciezka)
    finally:
        os.unlink(sciezka)


def rozwin_tagi(root: Path, sha: str) -> tuple[str | None, list[tuple[str, str]], str]:
    """Obiekt pushowany -> (commit, [(nazwa_tagu, tresc_tagu)], blad).

    Tag adnotowany niesie WLASNA tresc, ktora wychodzi razem z pushem
    (pomiar 2026-10-02, sonda S5: nazwa z denylisty w tresci tagu przeszla, bo
    bramka patrzyla tylko na commit, na ktory tag wskazuje). Tag na tag
    rozwijamy do konca; tag na drzewo albo blob to BLOKADA - takiej tresci
    bramka historii nie umie ocenic."""
    tagi: list[tuple[str, str]] = []
    obiekt = sha
    for _ in range(32):
        typ = _git(root, "cat-file", "-t", obiekt)
        if typ.returncode != 0:
            return None, tagi, f"nie moge odczytac obiektu {obiekt[:12]}: {typ.stderr.strip()}"
        rodzaj = typ.stdout.strip()
        if rodzaj == "commit":
            return obiekt, tagi, ""
        if rodzaj != "tag":
            return None, tagi, f"push publikuje obiekt typu '{rodzaj}' ({obiekt[:12]}) - bramka ocenia tylko commity"
        surowy = _git(root, "cat-file", "tag", obiekt)
        if surowy.returncode != 0:
            return None, tagi, f"nie moge odczytac tagu {obiekt[:12]}: {surowy.stderr.strip()}"
        naglowek, _, tresc = surowy.stdout.partition("\n\n")
        pola = dict(l.split(" ", 1) for l in naglowek.splitlines() if " " in l)
        # Naglowek (object/type/tagger z czasem unix) to nie tresc: 10-cyfrowy
        # znacznik czasu ma przypadkiem sume NIP. Podpis tez nie (base64).
        tagi.append((pola.get("tag", "?"), _PODPIS.sub("", tresc)))
        obiekt = pola.get("object", "")
    return None, tagi, f"lancuch tagow dluzszy niz 32 od {sha[:12]}"


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
    nowe: list[tuple[str, str]] = []
    for linia in wejscie.splitlines():
        if not linia.strip():
            continue
        czesci = linia.split()
        if len(czesci) != 4:
            return 1, f"pre-push: BLOKADA - nieczytelna linia refow od gita: {linia!r}"
        _lref, lsha, rref, _rsha = czesci
        if lsha != ZERO:   # usuniecie galezi nie publikuje tresci
            nowe.append((lsha, rref))
    if not nowe:
        return 0, "pre-push: brak tresci do publikacji (tylko usuniecia)."
    nazwy, powod = remoty_publiczne(root, remote, url)
    if not nazwy:
        return 1, powod
    z_refami = [n for n in nazwy if _git(root, "for-each-ref", f"refs/remotes/{n}").stdout.strip()]
    if not z_refami:
        n = nazwy[0]
        return 1, (f"pre-push: BLOKADA - brak refow refs/remotes/{n}/*, wiec nie wiem, "
                   f"co jest publiczne. Zrob `git fetch {n}` i ponow.")
    public_ref = [a for n in z_refami for a in ("--public-ref", f"refs/remotes/{n}/*")]
    rc = 0
    # Nazwy refow na repo publicznym tez sa publiczne (galaz nazwana po kliencie).
    tekst = "\n".join(rref for _, rref in nowe) + "\n"
    for lsha, rref in nowe:
        commit, tagi, blad = rozwin_tagi(root, lsha)
        for nazwa_tagu, tresc in tagi:
            tekst += f"{nazwa_tagu}\n{tresc}\n"
        if commit is None:
            rc = 1
            log.append(f"pre-push: BLOKADA - {rref}: {blad}")
            continue
        r, out = _bramka(str(root), "--candidate", commit, *public_ref)
        log.append(out.rstrip())
        if r != 0:
            rc = 1
        lista = _git(root, "rev-list", commit, "--not",
                     *[f"--remotes={n}" for n in z_refami])
        if lista.returncode != 0:
            rc = 1
            log.append(f"pre-push: BLOKADA - rev-list {commit[:7]}: {lista.stderr.strip()}")
            continue
        for c in lista.stdout.split():
            msg = _git(root, "log", "-1", "--format=%B", c)
            if msg.returncode != 0:
                rc = 1
                log.append(f"pre-push: BLOKADA - nie moge odczytac tresci commita {c[:7]}")
                continue
            r, out = _bramka_na_tekscie(root, "--commit-msg", msg.stdout, f"commit-{c[:7]}")
            if r != 0:
                rc = 1
                log.append(f"{out.rstrip()}\n^ tresc commita {c[:7]}")
    r, out = _bramka_na_tekscie(root, "--text", tekst, "refy-i-tagi")
    if r != 0:
        rc = 1
        log.append(f"{out.rstrip()}\n^ nazwy refow / tresc tagow adnotowanych")
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
