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
2 = usage/config error.
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
# Polish court signature heuristic, e.g. "I C 123/24", "II AKa 45/23", "III CZP 1/22".
_SYGN = re.compile(r"\b[IVXLC]{1,4} [A-Z][A-Za-z]{0,3} \d{1,5}/\d{2,4}\b")
_KRS = re.compile(r"\bKRS[:\s-]*?(\d{10})\b", re.IGNORECASE)

_SECRETS = [
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private_key_block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("github_pat", re.compile(r"\bghp_[0-9A-Za-z]{36}\b")),
    ("openai_key", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")),
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


def scan_text(path_label: str, text: str, cfg: Config) -> list[Finding]:
    out: list[Finding] = []
    deny_lc = [(t, t.lower()) for t in cfg.deny_terms]
    deny_hashes = set(cfg.deny_term_hashes)
    for ln, line in enumerate(text.splitlines(), 1):
        if ALLOW_MARKER in line:        # intentional fixture — suppress this line
            continue
        for run in _DIGIT_RUN.finditer(line):
            digits = re.sub(r"[ \-]", "", run.group(1))
            kind = ("pesel" if valid_pesel(digits) else
                    "nip" if valid_nip(digits) else
                    "regon" if valid_regon(digits) else None)
            if kind:
                out.append(Finding(HARD, kind, path_label, ln, _redact(run.group(1))))
        for m in _KRS.finditer(line):
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
        if p.suffix.lower() in SKIP_EXT:
            continue
        if any(a in rel for a in cfg.allow_paths):   # allowlisted fixtures
            continue
        for dpath in cfg.deny_paths:
            if dpath in rel:
                findings.append(Finding(HARD, "denied_path", rel, 0, dpath))
        try:
            if p.stat().st_size > MAX_BYTES:
                continue
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binary or unreadable -> skip content scan
        scanned += 1
        findings.extend(scan_text(rel, text, cfg))
    return findings, scanned


def iter_history(root: Path, cfg: Config) -> list[Finding]:
    """Scan added lines across full git history (opt-in, slower)."""
    try:
        diff = subprocess.run(
            ["git", "-C", str(root), "log", "-p", "--no-color", "--all",
             "--diff-filter=AM", "--format=commit:%H"],
            capture_output=True, text=True, check=True, encoding="utf-8",
            errors="replace",
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"history scan unavailable: {e}", file=sys.stderr)
        return []
    findings: list[Finding] = []
    commit = "?"
    for raw in diff.splitlines():
        if raw.startswith("commit:"):
            commit = raw[7:14]
        elif raw.startswith("+") and not raw.startswith("+++"):
            findings.extend(scan_text(f"history@{commit}", raw[1:], cfg))
    return findings


def scan_commit_msg(path: Path, cfg: Config) -> list[Finding]:
    """Skan TRESCI commita. Powod istnienia: 2026-08-22 nazwa leada i imie osoby
    trzeciej wyszly na repo publiczne nie plikiem, tylko komunikatem commita -
    czyli jedynym kanalem, ktorego bramka drzewa z definicji nie widzi. Tresci
    commita nie da sie potem poprawic bez przepisania historii, wiec to musi byc
    bramka WEJSCIOWA (hook `commit-msg`), nie kontrola po fakcie."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        print(f"nie moge odczytac {path}: {e}", file=sys.stderr)
        return []
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
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="MateMatic pre-publication leak scanner")
    ap.add_argument("path", nargs="?", default=".", help="repo root (default: .)")
    ap.add_argument("--config", type=Path, help="path to .publication-gate.json")
    ap.add_argument("--history", action="store_true", help="also scan git history")
    ap.add_argument("--all-files", action="store_true",
                    help="scan every file, not just git-tracked (default: tracked only in a git repo)")
    ap.add_argument("--strict", action="store_true", help="WARN findings also fail")
    ap.add_argument("--commit-msg", type=Path, metavar="FILE",
                    help="skanuj tresc commita zamiast drzewa (hook commit-msg)")
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

    if args.commit_msg:
        findings = scan_commit_msg(args.commit_msg, cfg)
        scanned = 1
    else:
        findings, scanned = iter_tree(root, cfg, args.all_files)
        if args.history:
            findings.extend(iter_history(root, cfg))

    hard = [f for f in findings if f.severity == HARD]
    warn = [f for f in findings if f.severity == WARN]

    if args.json:
        print(json.dumps([f.__dict__ for f in findings], ensure_ascii=False, indent=2))
    else:
        for f in findings:
            print(f"{f.severity:4} {f.kind:18} {f.path}:{f.line}  {f.excerpt}")
        scope = ("commit message" if args.commit_msg else
                 "all files" if args.all_files else "git-tracked files")
        print(f"\n{len(hard)} hard, {len(warn)} warn finding(s) "
              f"over {scanned} scanned {scope}.")

    failed = bool(hard) or (args.strict and bool(warn))
    if not args.json:
        print("RESULT:", "BLOCK" if failed else "PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
