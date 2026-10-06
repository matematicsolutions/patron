#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 MateMatic Solutions
"""matematic-publication-gate — pre-publication leak scanner for MateMatic repos.

Blocks Polish client/PII data, court signatures, KRS numbers, secrets and
internal MateMatic markers from entering a public repository — in the working
tree and (optionally) in git history.

Design notes
------------
- Stdlib only. Runs in CI (non-zero exit on hard findings) and locally.
- Structured PL identifiers are checksum-validated (PESEL/NIP/REGON), so a random
  11-digit invoice number does not trip the gate. This is the difference between
  a usable gate and a false-positive generator.
- Heuristic detectors (court signatures) report at WARN level by default; use
  --strict to make warnings fail the build too.
- Denylist (client names, internal path markers) is loaded from
  `.publication-gate.json` at the repo root or via --config.

Exit codes: 0 = clean (or only warnings without --strict), 1 = hard findings,
2 = usage/config error, or git history/text could not be read (fail-closed:
a gate that read nothing never says PASS).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------- #
# Severity
# --------------------------------------------------------------------------- #
HARD = "HARD"   # validated PII / secret / explicit denylist hit -> fail
WARN = "WARN"   # heuristic (signature-like) -> fail only with --strict

# Directories/extensions never scanned (artifacts, vendored, binaries).
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist",
             "build", ".code-review-graph", ".next", "out", "target",
             ".pytest_cache", ".mypy_cache"}
SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip",
            ".gz", ".tar", ".lock", ".woff", ".woff2", ".ttf", ".otf", ".eot",
            ".mp3", ".mp4", ".wav", ".db", ".sqlite", ".bin", ".pfb",
            ".tsbuildinfo", ".min.js", ".map"}
MAX_BYTES = 2_000_000  # skip files larger than 2 MB


# --------------------------------------------------------------------------- #
# Checksum validators for Polish structured identifiers
# --------------------------------------------------------------------------- #
def valid_pesel(d: str) -> bool:
    if len(d) != 11 or not d.isdigit() or len(set(d)) == 1:
        return False
    # Month field encodes the century (01-12, 21-32, 41-52, 61-72, 81-92).
    mm = int(d[2:4])
    if mm % 20 not in range(1, 13) or mm % 20 == 0:
        return False
    dd = int(d[4:6])
    if not 1 <= dd <= 31:
        return False
    w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
    s = sum(int(d[i]) * w[i] for i in range(10))
    return (10 - s % 10) % 10 == int(d[10])


def valid_nip(d: str) -> bool:
    if len(d) != 10 or not d.isdigit() or len(set(d)) == 1:
        return False
    w = [6, 5, 7, 2, 3, 4, 5, 6, 7]
    c = sum(int(d[i]) * w[i] for i in range(9)) % 11
    return c != 10 and c == int(d[9])


def _looks_like_timestamp(d: str) -> bool:
    """14-digit YYYYMMDDhhmmss — e.g. a backup label like patron-2026-05-20-020001.
    Such strings collide with the REGON-14 checksum ~1/11 of the time."""
    if len(d) != 14:
        return False
    y, mo, da = int(d[0:4]), int(d[4:6]), int(d[6:8])
    h, mi, s = int(d[8:10]), int(d[10:12]), int(d[12:14])
    return 1900 <= y <= 2099 and 1 <= mo <= 12 and 1 <= da <= 31 \
        and h < 24 and mi < 60 and s < 60


def valid_regon(d: str) -> bool:
    if not d.isdigit() or len(d) not in (9, 14) or len(set(d)) == 1:
        return False
    if len(d) == 14 and _looks_like_timestamp(d):
        return False  # backup/date label, not a REGON
    if len(d) == 9:
        w = [8, 9, 2, 3, 4, 5, 6, 7]
        c = sum(int(d[i]) * w[i] for i in range(8)) % 11 % 10
        return c == int(d[8])
    w = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8]
    c = sum(int(d[i]) * w[i] for i in range(13)) % 11 % 10
    return c == int(d[13])


# --------------------------------------------------------------------------- #
# Detectors
# --------------------------------------------------------------------------- #
# 9-11 digit runs (allowing spaces/dashes) -> normalize -> checksum-validate.
_DIGIT_RUN = re.compile(r"(?<!\d)(\d[\d \-]{7,16}\d)(?!\d)")
_ISO_DATE = re.compile(r"(?:19|20)\d\d-[01]\d-[0-3]\d(?:\D|$)")


def _placeholder(d: str) -> bool:
    """Kolejne cyfry ("0123456789", "0000123456") to przyklad, nie numer."""
    return d in "01234567890123456789" or "123456789".startswith(d.lstrip("0"))


# Polish court signature heuristic, e.g. "I C 123/24", "II AKa 45/23", "III CZP 1/22".
_SYGN = re.compile(r"\b[IVXLC]{1,4} [A-Z][A-Za-z]{0,3} \d{1,5}/\d{2,4}\b")
_KRS = re.compile(r"\bKRS[:\s-]*?(\d{10})\b", re.IGNORECASE)

_SECRETS = [
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private_key_block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("github_pat", re.compile(r"\b(?:ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{60,})\b")),
    ("github_token", re.compile(r"\bgh[ousr]_[0-9A-Za-z]{36}\b")),
    ("anthropic_key", re.compile(r"\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_\-]{20,}")),
    # Stary sk-<alnum> oraz klucze projektowe i serwisowe (sk-proj-, sk-svcacct-, sk-admin-).
    ("openai_key", re.compile(r"\bsk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_\-]{20,}|[A-Za-z0-9]{20,}\b)")),
    ("huggingface_token", re.compile(r"\bhf_[A-Za-z0-9]{30,}\b")),
    ("pypi_token", re.compile(r"\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_\-]{50,}")),
    ("npm_token", re.compile(r"\bnpm_[A-Za-z0-9]{36}\b")),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("slack_token", re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{10,}\b")),
]


@dataclass
class Finding:
    severity: str
    kind: str
    path: str
    line: int
    excerpt: str


# Inline suppression marker — put it on the same line as an intentional fixture.
ALLOW_MARKER = "pubgate:allow"


@dataclass
class Config:
    deny_terms: list[str] = field(default_factory=list)
    deny_term_hashes: list[str] = field(default_factory=list)
    deny_paths: list[str] = field(default_factory=list)
    allow_paths: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, root: Path, explicit: Path | None) -> "Config":
        p = explicit or (root / ".publication-gate.json")
        if not p.exists():
            return cls()
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"config error in {p}: {e}", file=sys.stderr)
            sys.exit(2)
        return cls(deny_terms=[t for t in raw.get("deny_terms", []) if t],
                   deny_term_hashes=[h.lower() for h in raw.get("deny_term_hashes", []) if h],
                   deny_paths=raw.get("deny_paths", []),
                   allow_paths=raw.get("allow_paths", []))


# --------------------------------------------------------------------------- #
# Denylist nazw bez wpisywania nazw do repo publicznego
# --------------------------------------------------------------------------- #
# Problem, ktory to rozwiazuje: nazwiska klienta i nazwy leadow NIE MOGA stac
# otwartym tekstem w publicznym `.publication-gate.json` - bramka chroniaca przed
# wyciekiem sama bylaby wyciekiem. Dlatego przez pol roku `deny_terms` bylo puste,
# a bramka swiecila na zielono, bo nie miala czego szukac (pomiar 2026-08-23:
# przepuscila nazwe kancelarii pilotazowej w 8 plikach i nazwe leada w 2).
#
# Rozwiazanie: config trzyma sha256 RDZENIA slowa, nie samo slowo. Rdzen (>= 4
# znaki) lapie polska odmiane: jeden hash pokrywa mianownik, dopelniacz i reszte.
#
# UCZCIWA GRANICA: to obfuskacja, nie tajemnica. Sha256 czterech liter zlamie
# kazdy slownikiem w sekunde. Chroni przed grepem, indeksem wyszukiwarki i okiem
# czytelnika repo - NIE przed kims, kto juz zna nazwisko i chce je potwierdzic.
# Pelna lista otwartym tekstem zyje poza repo: --config .publication-gate.private.json
MIN_STEM = 4
DIAKRYTYKI = "ąćęłńóśżźĄĆĘŁŃÓŚŻŹ"
_TOKEN = re.compile(r"[0-9a-z]+")


def _fold(text: str) -> str:
    """Lowercase + bez ogonkow, zeby 'Kowalskiego' i 'KOWALSKA' zlozyly sie do jednego rdzenia."""
    low = text.lower().replace("ł", "l")          # l z kreska nie rozklada sie w NFKD
    nfkd = unicodedata.normalize("NFKD", low)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def stem_hash(term: str) -> str:
    """Hash rdzenia do wpisania w `deny_term_hashes`. Uzycie: --hash <slowo>"""
    return hashlib.sha256(_fold(term).encode("utf-8")).hexdigest()


def _hash_hits(line: str, deny_hashes: set[str]) -> list[str]:
    """Zwraca tokeny z linii, ktorych jakikolwiek prefiks >= MIN_STEM jest na liscie.

    Token krotszy niz MIN_STEM (dwuliterowy akronim firmy) sprawdzamy w calosci,
    ale TYLKO gdy w oryginalnej linii stoi WERSALIKAMI. Bez tego warunku bramka
    tonie w szumie: base64 w `package-lock.json` rozpada sie na tokeny i zawiera
    dwuliterowe ciagi na kazdej dlugosci - zmierzone, 1 falszywe trafienie na
    597 plikow. Falszywe trafienie kosztuje wiecej niz przeoczone, bo uczy
    ludzi wylaczac bramke.
    """
    hits: list[str] = []
    for m in _TOKEN.finditer(_fold(line)):
        tok = m.group(0)
        if hashlib.sha256(tok.encode("utf-8")).hexdigest() in deny_hashes:
            if len(tok) >= MIN_STEM or tok.upper() in line:
                hits.append(tok)
                continue
        for n in range(MIN_STEM, len(tok) + 1):
            if hashlib.sha256(tok[:n].encode("utf-8")).hexdigest() in deny_hashes:
                hits.append(tok)
                break
    return hits


def _redact(match: str) -> str:
    """Show enough to locate, hide the payload — never echo full secrets/PII."""
    m = match.strip()
    if len(m) <= 4:
        return "*" * len(m)
    return m[:2] + "*" * (len(m) - 4) + m[-2:]


_HEX_TOKEN = re.compile(r"[0-9a-fA-F]+")
# Najkrotszy token hex, ktory uznajemy za hash. Pelny git SHA ma 40 (SHA-256: 64)
# znakow, w prozie bywa uciety do 20 (przyklad z 2026-10-01 nizej). Najdluzszy
# polski identyfikator to REGON-14, wiec numer sklejony z maksymalnie piecioma
# literami a-f (`a<NIP>`, `ab<PESEL>`, `f<REGON-14>`) zostaje ponizej progu
# i JEST sprawdzany. Skrocony SHA 7-12 znakow nie miesci w sobie numeru z
# poprawna suma bez wyjatkowego zbiegu okolicznosci - wtedy pelny SHA w tresci.
MIN_HASH_LEN = 20


def _w_hashu(line: str, start: int, end: int) -> bool:
    """Ciag cyfr jest czescia hasha (git SHA, sha256): token z samych znakow
    0-9a-f, co najmniej MIN_HASH_LEN znakow, z choc jedna litera a-f.

    Zmierzone 2026-10-01: syntetyczny commit scalenia PR na GitHubie (pelny SHA
    w "Merge <sha> into <sha>") zawieral 10 kolejnych cyfr z poprawna suma NIP
    - i bramka zablokowala PR. Gola liczba (bez liter wokol) dalej jest
    identyfikatorem do sprawdzenia.

    Zmierzone 2026-10-02 (R-TI-07): pierwsza wersja uznawala za hash KAZDY token
    hex >= 7 znakow z litera a-f, wiec `id=a<NIP>` (litera + 10 cyfr) przechodzil
    jako "hash". Teraz token musi miec dlugosc hasha, nie numeru z prefiksem.
    """
    while start > 0 and line[start - 1].isalnum():
        start -= 1
    while end < len(line) and line[end].isalnum():
        end += 1
    tok = line[start:end]
    return (len(tok) >= MIN_HASH_LEN and bool(_HEX_TOKEN.fullmatch(tok))
            and any(c in "abcdefABCDEF" for c in tok))


def scan_text(path_label: str, text: str, cfg: Config) -> list[Finding]:
    out: list[Finding] = []
    deny_lc = [(t, t.lower()) for t in cfg.deny_terms]
    deny_hashes = set(cfg.deny_term_hashes)
    for ln, line in enumerate(text.splitlines(), 1):
        if ALLOW_MARKER in line:        # intentional fixture — suppress this line
            continue
        for run in _DIGIT_RUN.finditer(line):
            if _ISO_DATE.match(run.group(1)):
                continue  # "2026-09-07 12:23" sklada sie w 10 cyfr z poprawna suma NIP
            digits = re.sub(r"[ \-]", "", run.group(1))
            if _placeholder(digits):
                continue
            if _w_hashu(line, run.start(1), run.end(1)):
                continue  # cyfry wewnatrz hasha gita, nie numer osoby ani firmy
            kind = ("pesel" if valid_pesel(digits) else
                    "nip" if valid_nip(digits) else
                    "regon" if valid_regon(digits) else None)
            if kind:
                out.append(Finding(HARD, kind, path_label, ln, _redact(run.group(1))))
        for m in _KRS.finditer(line):
            if _placeholder(m.group(1)):
                continue  # placeholder w rodzaju "KRS 0000123456", nie numer podmiotu
            out.append(Finding(HARD, "krs", path_label, ln, _redact(m.group(0))))
        for name, rx in _SECRETS:
            for m in rx.finditer(line):
                out.append(Finding(HARD, name, path_label, ln, _redact(m.group(0))))
        low = line.lower()
        for term, term_lc in deny_lc:
            if term_lc in low:
                out.append(Finding(HARD, "denylist", path_label, ln, f"term '{term}'"))
        for tok in _hash_hits(line, deny_hashes):
            out.append(Finding(HARD, "denylist_hash", path_label, ln,
                               f"token '{_redact(tok)}'"))
        for m in _SYGN.finditer(line):
            out.append(Finding(WARN, "court_signature?", path_label, ln, m.group(0)))
    return out


# --------------------------------------------------------------------------- #
# Sources
# --------------------------------------------------------------------------- #
def _tracked_files(root: Path) -> list[Path] | None:
    """Git-tracked files only — what actually reaches a public repo. Returns
    None when not a git repo (caller falls back to a full filesystem walk)."""
    if not (root / ".git").exists():
        return None
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z"],
            capture_output=True, check=True,
        ).stdout.decode("utf-8", "replace")
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return [root / rel for rel in out.split("\0") if rel]


def denied_path_findings(rel: str, label: str, cfg: Config) -> list[Finding]:
    """Trafienia `deny_paths` dla jednej sciezki - wspolne dla drzewa i historii."""
    return [Finding(HARD, "denied_path", label, 0, d) for d in cfg.deny_paths if d in rel]


def iter_tree(root: Path, cfg: Config, all_files: bool = False) -> tuple[list[Finding], int]:
    findings: list[Finding] = []
    tracked = None if all_files else _tracked_files(root)
    candidates = tracked if tracked is not None else root.rglob("*")
    scanned = 0
    for p in candidates:
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if any(part in SKIP_DIRS for part in p.relative_to(root).parts):
            continue
        # Sciezka zabroniona PRZED wyjatkami rozszerzen i allow_paths:
        # `.matematic/plan.pdf` albo `.claude/x.test.ts` to dalej prywatny
        # warsztat, choc tresci takiego pliku nie skanujemy.
        findings.extend(denied_path_findings(rel, rel, cfg))
        if p.suffix.lower() in SKIP_EXT:
            continue
        if any(a in rel for a in cfg.allow_paths):   # allowlisted fixtures
            continue
        try:
            if p.stat().st_size > MAX_BYTES:
                continue
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binary or unreadable -> skip content scan
        scanned += 1
        findings.extend(scan_text(rel, text, cfg))
    return findings, scanned


class HistoryScanError(RuntimeError):
    """Skan historii sie nie odbyl. Bramka NIE moze wtedy powiedziec PASS."""


# Wspolne opcje `git log` dla skanu historii. Kazda zamyka konkretna dziure
# (pomiar 2026-10-02, R-TI-07 - sondy w backend/audit-2609/sondy/):
#   --no-renames      rename to D + A z PELNA trescia pliku pod nowa sciezka.
#                     Z wykrywaniem rename'ow `git mv` + dopisany NIP mial status R
#                     i `--diff-filter=AM` go pomijal; a czysty rename z
#                     allow_paths do zwyklej sciezki nie pokazalby tresci wcale.
#   --diff-filter=ACMRT  wszystko, co zostawia tresc w drzewie (D nie publikuje).
#   --cc              commit merge pokazuje diff kombinowany: hunki, w ktorych
#                     wynik rozni sie od KAZDEGO rodzica - czyli tresc dodana
#                     w rozwiazaniu merge'a. Bez tego `git log -p` merge'a nie
#                     pokazuje wcale (NIP wpisany przy rozwiazywaniu konfliktu
#                     przechodzil). Zwykly merge PR-a bez konfliktu daje pusty diff.
#   prefiksy/zewnetrzne diffy przypiete - lokalny config (diff.noprefix,
#                     diff.external, textconv) nie moze zmienic formatu, ktory parsujemy.
_LOG_HISTORY = ["-c", "core.quotePath=false", "-c", "diff.noprefix=false",
                "-c", "diff.mnemonicPrefix=false", "log", "--no-color", "--no-ext-diff",
                "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", "--cc",
                "--no-renames", "--diff-filter=ACMRT", "--format=commit:%H"]


_COMMIT_MARK = re.compile(r"commit:(?:[0-9a-f]{40}|[0-9a-f]{64})")


def _git_log(root: Path, *args: str) -> str:
    """`git log` dla skanu historii; kazdy blad to HistoryScanError (fail-closed).

    Zmierzone 2026-10-02: blad `git log -p` (brakujacy blob w klonie
    --filter=blob:none bez sieci) konczyl sie komunikatem "history scan
    unavailable" i PUSTA lista trafien - czyli PASS. Bramka, ktora nie umie
    przeczytac historii, nie wie nic, wiec nie moze przepuscic."""
    try:
        r = subprocess.run(["git", "-C", str(root), *_LOG_HISTORY, *args],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
    except FileNotFoundError as e:
        raise HistoryScanError(f"git not available: {e}") from e
    if r.returncode != 0:
        raise HistoryScanError(f"`git log {' '.join(args[:3])} ...` exited {r.returncode}: "
                               f"{r.stderr.strip()[:500]}")
    return r.stdout


_C_ESCAPES = {"a": 7, "b": 8, "t": 9, "n": 10, "v": 11, "f": 12, "r": 13, '"': 34, "\\": 92}


def _unquote_c(s: str) -> str:
    """Sciezka w cudzyslowie z naglowka diffu gita (`"b/x\\ty.md"`, `\\303\\244`)."""
    if len(s) < 2 or s[0] != '"' or s[-1] != '"':
        return s
    body, out, i = s[1:-1], bytearray(), 0
    while i < len(body):
        c = body[i]
        if c == "\\" and i + 1 < len(body):
            n = body[i + 1]
            if n in "01234567":
                out.append(int(body[i + 1:i + 4], 8) & 0xFF)
                i += 4
                continue
            out.append(_C_ESCAPES.get(n, ord(n) if ord(n) < 128 else 63))
            i += 2
            continue
        out += c.encode("utf-8")
        i += 1
    return out.decode("utf-8", "replace")


def _history_paths(root: Path, cfg: Config, revs: list[str]) -> list[Finding]:
    """`deny_paths` dla sciezek, ktore commity z zakresu DOKLADAJA do drzewa.

    Tryb drzewa sprawdzal `deny_paths` od zawsze, tryb historii (--candidate,
    czyli pre-push i CI) nie: commit dodajacy `.matematic/...` bez PII przechodzil
    (sonda S1, 2026-10-02). `-z`, bo sciezka moze zawierac spacje i znaki nowej linii."""
    out = _git_log(root, "--name-only", "-z", *revs)
    findings: list[Finding] = []
    commit = "?"
    for tok in out.split("\0"):
        tok = tok.lstrip("\n")
        if not tok:
            continue
        if _COMMIT_MARK.fullmatch(tok):
            commit = tok[7:14]
            continue
        if any(p in SKIP_DIRS for p in Path(tok).parts):
            continue
        findings.extend(denied_path_findings(tok, f"history@{commit}:{tok}", cfg))
    return findings


def iter_history(root: Path, cfg: Config, revs: list[str] | None = None) -> list[Finding]:
    """Scan added lines across git history (opt-in, slower).

    `revs` limits the walk (e.g. `[candidate, "--not", *public_tips]` = what a
    publication would add); default is every ref. Raises HistoryScanError when
    git cannot produce the history - never returns a silent empty list."""
    revs = revs or ["--all"]
    findings = _history_paths(root, cfg, revs)
    diff = _git_log(root, "-p", *revs)
    commit, cur_path, skip, cols = "?", "", False, 0
    for raw in diff.splitlines():
        if _COMMIT_MARK.fullmatch(raw):
            commit, cols = raw[7:14], 0
        elif raw.startswith("diff "):
            cols, cur_path, skip = 0, "", True   # naglowek pliku: do hunka nie ma tresci
        elif cols == 0 and raw.startswith("+++ "):
            # Ta sama polityka co iter_tree. Bez sciezki allow_paths nie dzialalo
            # w historii: 236 z 285 trafien 2026-09-21 to syntetyczne fixtury.
            # Sciezka nierozpoznana NIE wycisza tresci - skanujemy ja pod "?".
            sciezka = _unquote_c(raw[4:].rstrip("\t"))
            cur_path = sciezka[2:] if sciezka.startswith("b/") else "?"
            parts = Path(cur_path).parts
            skip = (any(p in SKIP_DIRS for p in parts)
                    or Path(cur_path).suffix.lower() in SKIP_EXT
                    or any(a in cur_path for a in cfg.allow_paths))
        elif raw.startswith("@@"):
            # "@@ ... @@" zwykly diff (1 kolumna), "@@@ ... @@@" merge z 2
            # rodzicami (2 kolumny prefiksu) itd.
            cols = len(raw) - len(raw.lstrip("@")) - 1
        elif cols and not skip and raw[:cols] == "+" * cols:
            # Tylko linie nowe wzgledem KAZDEGO rodzica. "+ " albo " +" w merge'u
            # to tresc jednego z rodzicow - skanowana w jego wlasnym commicie
            # (albo juz publiczna), wiec liczona drugi raz dalaby falszywe trafienia.
            findings.extend(scan_text(f"history@{commit}:{cur_path}", raw[cols:], cfg))
    return findings


def scan_commit_msg(path: Path, cfg: Config) -> list[Finding]:
    """Skan TRESCI commita. Powod istnienia: 2026-08-22 nazwa leada i imie osoby
    trzeciej wyszly na repo publiczne nie plikiem, tylko komunikatem commita -
    czyli jedynym kanalem, ktorego bramka drzewa z definicji nie widzi. Tresci
    commita nie da sie potem poprawic bez przepisania historii, wiec to musi byc
    bramka WEJSCIOWA (hook `commit-msg`), nie kontrola po fakcie."""
    # Blad odczytu leci wyzej (OSError): pusta lista trafien wygladalaby jak
    # czysta tresc, a bramka, ktora niczego nie przeczytala, nie moze przepuscic.
    text = path.read_text(encoding="utf-8")
    keep = [l for l in text.splitlines() if not l.lstrip().startswith("#")]
    out = scan_text(f"commit-msg:{path.name}", "\n".join(keep), cfg)
    # Konwencja organizacji (AGENTS.md): zero polskich diakrytykow w tresci
    # commita. Regula istniala od dawna i nie trzymala - w tej samej sesji,
    # w ktorej ja opisywalismy, zlamalismy ja. Regula bez bramki nie trzyma.
    for ln, line in enumerate(keep, 1):
        zle = sorted({c for c in line if c in DIAKRYTYKI})
        if zle:
            out.append(Finding(HARD, "diakrytyki", f"commit-msg:{path.name}",
                               ln, "".join(zle)))
    return out


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
# Lista znanych trafien w historii: commity sprzed czyszczenia, ktorych nie
# przepisujemy (decyzja WM 2026-09-21, wariant A). Kluczem jest SHA commita,
# wiec lista nie wycisza niczego, co powstanie pozniej. Bez nazw - sama lista
# jest publiczna.
#
# Lista uznaje to, co JUZ wyszlo, i nic poza tym: wpis dziala tylko dla commita
# osiagalnego z refa publicznego (--public-ref). Powod, zmierzony 2026-10-01:
# lista powstala z `git log --all`, wiec weszly do niej dwa commity z prywatnej
# galezi, ktorych na repo publicznym nigdy nie bylo - merge tej galezi i push
# przeszlyby po cichu. Bez --public-ref nie wiemy, co jest publiczne, wiec
# lista nie wycisza niczego.
BASELINE_FILE = ".publication-gate-history-baseline.txt"


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True,
                          text=True, encoding="utf-8", errors="replace")


def resolve_public_tips(root: Path, refs: list[str]) -> list[str]:
    """Pelne SHA czubkow refow publicznych. Ref z `*?[` to glob gita (dopasowuje
    tez zagniezdzone: `refs/public/*`). Ref, ktorego nie ma, albo glob bez
    trafien to ValueError - pusty zbior "publicznych" wygladalby jak wynik."""
    tips: list[str] = []
    for ref in refs:
        if any(c in ref for c in "*?["):
            got = _git(root, "rev-parse", f"--glob={ref}").stdout.split()
            if not got:
                raise ValueError(f"--public-ref {ref}: glob matches no ref")
        else:
            r = _git(root, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}")
            if r.returncode != 0:
                raise ValueError(f"--public-ref {ref}: not a commit in this clone")
            got = [r.stdout.strip()]
        tips.extend(got)
    return sorted(set(tips))


def published_sha7(root: Path, tips: list[str]) -> set[str]:
    """Skroty (7 znakow, jak w etykiecie `history@sha7`) commitow osiagalnych z tips."""
    r = _git(root, "rev-list", *tips)
    if r.returncode != 0:
        raise ValueError(f"rev-list over public refs failed: {r.stderr.strip()}")
    return {line[:7] for line in r.stdout.split()}


def load_baseline(root: Path) -> set[tuple[str, str, str]]:
    """Linie `sha7 kind path`; `#` i puste pomijane."""
    p = root / BASELINE_FILE
    if not p.exists():
        return set()
    out: set[tuple[str, str, str]] = set()
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            sha, kind, path = line.split(" ", 2)
            out.add((sha, kind, path))
    return out


def split_baseline(findings: list[Finding], baseline: set[tuple[str, str, str]]
                   ) -> tuple[list[Finding], list[Finding]]:
    """(zywe, uznane). Dotyczy tylko trafien z historii (`history@sha:path`)."""
    live: list[Finding] = []
    known: list[Finding] = []
    for f in findings:
        if f.path.startswith("history@") and ":" in f.path:
            sha, path = f.path[len("history@"):].split(":", 1)
            if (sha, f.kind, path) in baseline:
                known.append(f)
                continue
        live.append(f)
    return live, known


def split_published_paths(findings: list[Finding], published: set[str]
                          ) -> tuple[list[Finding], list[Finding]]:
    """(zywe, juz_opublikowane) dla trafien `denied_path` z historii."""
    live: list[Finding] = []
    out: list[Finding] = []
    for f in findings:
        if (f.kind == "denied_path" and f.path.startswith("history@")
                and f.path[len("history@"):].split(":", 1)[0] in published):
            out.append(f)
        else:
            live.append(f)
    return live, out


def _history_failed(e: HistoryScanError) -> int:
    """Fail-closed: skan historii, ktory sie nie odbyl, to blad, nie zielone swiatlo."""
    print(f"history scan FAILED: {e}", file=sys.stderr)
    print("Bramka nie przeczytala historii, wiec nie wie, co wychodzi. Typowo: brak "
          "obiektow (klon --filter / --depth bez sieci) - `git fetch --unshallow` "
          "albo `git fetch --refetch` i ponow.", file=sys.stderr)
    print("RESULT: BLOCK")
    return 2


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="MateMatic pre-publication leak scanner")
    ap.add_argument("path", nargs="?", default=".", help="repo root (default: .)")
    ap.add_argument("--config", type=Path, help="path to .publication-gate.json")
    ap.add_argument("--history", action="store_true", help="also scan git history")
    ap.add_argument("--public-ref", action="append", default=[], metavar="REF",
                    help="ref/glob already public (repeatable, e.g. 'refs/public/*'); "
                         "history baseline is honoured only for commits reachable from these")
    ap.add_argument("--candidate", metavar="REV",
                    help="scan only the history REV would add to --public-ref "
                         "(REV --not public); tree and commit-msg are not scanned")
    ap.add_argument("--all-files", action="store_true",
                    help="scan every file, not just git-tracked (default: tracked only in a git repo)")
    ap.add_argument("--strict", action="store_true", help="WARN findings also fail")
    ap.add_argument("--commit-msg", type=Path, metavar="FILE",
                    help="skanuj tresc commita zamiast drzewa (hook commit-msg)")
    ap.add_argument("--text", type=Path, metavar="FILE",
                    help="skanuj dowolny tekst (tresc tagu adnotowanego, nazwy refow) "
                         "tymi samymi detektorami co drzewo; bez reguly diakrytykow")
    ap.add_argument("--hash", metavar="TERM",
                    help="wypisz sha256 rdzenia TERM do wklejenia w deny_term_hashes i zakoncz")
    ap.add_argument("--allow-empty-denylist", action="store_true",
                    help="pozwol przejsc mimo pustej listy nazw (repo bez klientow)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args(argv)

    if args.hash:
        print(stem_hash(args.hash))
        return 0

    root = Path(args.path).resolve()
    if not root.is_dir():
        print(f"not a directory: {root}", file=sys.stderr)
        return 2
    cfg = Config.load(root, args.config)

    # Kontrola POZYTYWNA wlasnego mianownika: bramka bez ani jednej nazwy na
    # liscie przechodzi zawsze i to jest grozniejsze niz jej brak, bo wyglada
    # jak dowod. Dokladnie tak przepuscilismy nazwy 2026-08-23.
    if not cfg.deny_terms and not cfg.deny_term_hashes and not args.allow_empty_denylist:
        print("BLOCK: denylist nazw jest PUSTA - bramka nie ma czego szukac.", file=sys.stderr)
        print("       Dodaj deny_term_hashes (patrz --hash TERM) w .publication-gate.json", file=sys.stderr)
        print("       albo swiadomie przepusc: --allow-empty-denylist", file=sys.stderr)
        return 1

    if args.candidate and not args.public_ref:
        print("--candidate needs --public-ref: without it every commit counts as new",
              file=sys.stderr)
        return 2
    public_tips: list[str] | None = None
    if args.public_ref:
        try:
            public_tips = resolve_public_tips(root, args.public_ref)
        except ValueError as e:
            print(f"public ref error: {e}", file=sys.stderr)
            return 2

    if args.commit_msg:
        try:
            findings = scan_commit_msg(args.commit_msg, cfg)
        except (OSError, UnicodeDecodeError) as e:
            print(f"nie moge odczytac {args.commit_msg}: {e}\nRESULT: BLOCK", file=sys.stderr)
            return 2
        scanned = 1
    elif args.text:
        try:
            text = args.text.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:   # nieprzeczytany != czysty
            print(f"nie moge odczytac {args.text}: {e}\nRESULT: BLOCK", file=sys.stderr)
            return 2
        findings = scan_text(f"text:{args.text.name}", text, cfg)
        scanned = 1
    elif args.candidate:
        r = _git(root, "rev-parse", "--verify", "--quiet", f"{args.candidate}^{{commit}}")
        if r.returncode != 0:
            print(f"--candidate {args.candidate}: not a commit in this clone", file=sys.stderr)
            return 2
        revs = [r.stdout.strip(), "--not", *(public_tips or [])]
        cnt = _git(root, "rev-list", "--count", *revs)
        if cnt.returncode != 0:
            print(f"history scan FAILED: rev-list {args.candidate}: {cnt.stderr.strip()}\n"
                  "RESULT: BLOCK (nie wiem, co publikacja doda)", file=sys.stderr)
            return 2
        scanned = int(cnt.stdout.strip() or 0)
        try:
            findings = iter_history(root, cfg, revs)
        except HistoryScanError as e:
            return _history_failed(e)
    else:
        findings, scanned = iter_tree(root, cfg, args.all_files)
        if args.history:
            try:
                findings.extend(iter_history(root, cfg))
            except HistoryScanError as e:
                return _history_failed(e)

    baseline = load_baseline(root)
    try:
        published = published_sha7(root, public_tips) if public_tips else set()
    except ValueError as e:
        print(f"public ref error: {e}", file=sys.stderr)
        return 2
    honoured = {e for e in baseline if e[0] in published}
    findings, known = split_baseline(findings, honoured)
    # Pelna historia (--history): sciezka z deny_paths w commicie JUZ osiagalnym
    # z refa publicznego jest nieodwracalna - liczymy ja jawnie, ale nie blokuje
    # (pomiar 2026-10-02: ~100 takich wpisow sprzed czyszczenia warsztatu). Ta sama
    # sciezka w commicie spoza publicznego blokuje. W --candidate nic nie jest
    # opublikowane z definicji, wiec ten podzial tam nie zachodzi.
    paths_out: list[Finding] = []
    if args.history and not (args.candidate or args.commit_msg or args.text):
        findings, paths_out = split_published_paths(findings, published)
    history_scanned = bool(args.history or args.candidate) and not (args.commit_msg or args.text)

    hard = [f for f in findings if f.severity == HARD]
    warn = [f for f in findings if f.severity == WARN]

    if args.json:
        print(json.dumps([f.__dict__ for f in findings], ensure_ascii=False, indent=2))
    else:
        for f in findings:
            print(f"{f.severity:4} {f.kind:18} {f.path}:{f.line}  {f.excerpt}")
        scope = ("commit message" if args.commit_msg else "text" if args.text else
                 "commit(s) to publish" if args.candidate else
                 "all files" if args.all_files else "git-tracked files")
        print(f"\n{len(hard)} hard, {len(warn)} warn finding(s) "
              f"over {scanned} scanned {scope}.")
        if args.candidate:   # pusty zakres to tez wynik - mowimy go glosno
            print(f"range: {args.candidate} --not {len(public_tips or [])} public tip(s); "
                  f"{scanned} commit(s) to publish.")
        if known:   # mianownik: wyciszone liczymy jawnie, nie znikaja
            print(f"{len(known)} known historical finding(s) acknowledged in {BASELINE_FILE}.")
        if paths_out:
            print(f"{len(paths_out)} denied_path finding(s) in commits already reachable "
                  f"from --public-ref (published, irreversible; not blocking).")
        if history_scanned and len(honoured) < len(baseline):
            why = ("commit not reachable from --public-ref" if public_tips is not None
                   else "no --public-ref given, so nothing counts as published")
            print(f"{len(baseline) - len(honoured)} of {len(baseline)} {BASELINE_FILE} "
                  f"entr(y/ies) NOT honoured: {why}.")

    failed = bool(hard) or (args.strict and bool(warn))
    if not args.json:
        print("RESULT:", "BLOCK" if failed else "PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
