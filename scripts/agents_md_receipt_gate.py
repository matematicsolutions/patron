#!/usr/bin/env python3
"""Bramka paragonow AGENTS.md - hashe commitow, sciezki i linki musza istniec.

Powod istnienia: wzorzec "DON'T z paragonem" (hash commita-incydentu jako dowod)
zaadoptowany 2026-08-31 z gridex/gridex razem z jego zmierzona slaboscia: w ich
macos/AGENTS.md hash `6a4aad0` byl cytowany CZTERY razy i nie istnial w historii
(przepisany przez squash-merge) - nikt tego nie zauwazyl, bo paragonow nikt nie
waliduje. Dokumentacja zakotwiczona testem: regula bez bramki nie trzyma.

Bramka jest mechaniczna i pada na:

  1. backtickowanym hashu hex (7-40 znakow), ktorego nie ma w historii gita
     (`git rev-parse --verify <hash>^{commit}`),
  2. linku markdown, ktorego cel nie istnieje na dysku - z `./` albo bez,
     root-relative `](/x)`, z opcjonalnym tytulem `[x](sciezka "Tytul")`,
  3. sciezce kodu ZNALEZIONEJ WEWNATRZ backtickowanego tokenu (podciag z `/` i
     rozszerzeniem kodu - takze w srodku komendy), ktorej nie ma ani od korzenia
     repo, ani pod zadnym z KORZENI_SKROTOW.

MIANOWNIK JEST CZESCIA WYNIKU. Bramka, ktora nie zna wlasnego zakresu, przepuszcza
po cichu: jej pierwsza wersja (2026-08-31) lapala hashe wylacznie 7- i 40-znakowe
(git rozszerza skrot przy kolizji, wiec 8-12 znakow przechodzilo bez sprawdzenia),
linki wylacznie z `./`/`../`, a sciezki wylacznie z zamknietej listy prefiksow i
rozszerzen - przez co DZIEWIEC sciezek w AGENTS.md (m.in. `lib/pipeline/defense.ts`,
`llm/provider.ts`, `mcp/connectors.ts`, `routes/chat.ts`, `shared/types.ts`,
`skills/integrity.ts`) nie bylo sprawdzanych, a `.github/`, `docs/`, `.sh` i
`.yaml` w ogole nie istnialy dla skanu. AGENTS.md deklarowal przy tym "every
commit hash, relative link and code path". Druga wersja wymagala z kolei, zeby
sciezka byla CALA zawartoscia backtickow - wiec dwa tokeny nazywajace SAME bramki
(`python scripts/adr_number_gate.py .`, `python scripts/agents_md_receipt_gate.py .`)
nie byly ani sprawdzane, ani raportowane jako POMINIETE: bramka nie walidowala
sciezki do samej siebie. Tak samo cel linku, ktorego wzorzec nie rozbieral,
wypadal poza OBIE listy. Dlatego kazdy przebieg drukuje POMINIETE z powodem, a
nierozstrzygalne ida na te liste, nigdy poza nia (wzorzec kontroli pozytywnej
mianownika: backend/src/lib/routing/egress-surface-parity.test.ts). Same wzorce
bramki pilnuje --samotest na fixture'ach znanego-zlego.

Klon plytki (`git rev-parse --is-shallow-repository`): brakujacy hash to WARN
zamiast FAIL, bo obiekt moze zyc poza granica shallow; w CI z fetch-depth: 0 kazdy
brak jest twardy. Flaga --strict wymusza FAIL takze na plytkim klonie. W worktree
`.git` jest PLIKIEM, wiec detekcja po `.git/shallow` dawala tam zawsze False -
i plytki klon lecial twardym FAIL-em zamiast WARN-em.

Zero zaleznosci poza gitem, zero egressu. Exit 0 = OK, 1 = martwy paragon,
2 = blad srodowiska / bramka bez przedmiotu.
Uzycie: python scripts/agents_md_receipt_gate.py [KATALOG_REPO] [--plik PLIK.md] [--strict]
        python scripts/agents_md_receipt_gate.py --samotest   # wzorce na znanym-zlym
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

# Rozszerzenia plikow, ktore w tej dokumentacji sa PARAGONAMI (sciezka do kodu,
# konfiguracji albo dokumentu). Lista jest jawna, ale juz nie zamknieta na
# prefiks katalogu - `.github/workflows/*.yml`, `docs/*.md`, `deploy/*.sh` licza
# sie tak samo jak `backend/src/...`.
ROZSZERZENIA = (
    "ts", "tsx", "js", "jsx", "cjs", "mjs", "py", "sql", "md", "json",
    "yml", "yaml", "sh", "ps1", "html", "css", "toml", "cfg", "ini",
)
_EXT = "|".join(ROZSZERZENIA)

# Kazdy backtickowany token - podstawa raportu POMINIETYCH.
TOKEN_RX = re.compile(r"`([^`\n]+)`")
# Hash: 7-40 znakow hex. Git rozszerza skrot przy kolizji, wiec 8-12 znakow tez
# jest legalnym paragonem - stara bramka znala tylko 7 i 40.
HASH_RX = re.compile(r"`([0-9a-f]{7,40})`")
# Wnetrze `](...)` rozbierane jest SKANEM PO BALANSIE nawiasow (cele_linkow),
# nie regexem: `](frontend/src/app/(pages)/workflows/page.tsx)` to sciezka, ktora
# w tym repo naprawde istnieje, a `[^)]+` ucina ja na `app/(pages` i zglasza
# martwy link, ktorego nie ma. Regex ponizej dzieli juz TYLKO gotowa zawartosc
# na cel i opcjonalny tytul `[x](sciezka "Tytul")` - ksztalt, ktorego stara
# wersja nie umiala rozebrac i ktorego nie raportowala jako POMINIETY, wiec
# wypadal poza OBIE listy. Root-relative `](/x)` bylo wykluczone tak samo.
CEL_LINKU_RX = re.compile(r"^(\S+)(?:\s+\"[^\"]*\")?$")
# Schemat URL (`http:`, `mailto:`) - link poza dyskiem, nie paragon lokalny.
SCHEMAT_RX = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
# Sciezka kodu: token z CO NAJMNIEJ jednym `/` i rozszerzeniem z listy. Bez listy
# prefiksow - katalog wynika ze sprawdzenia na dysku, nie z regexa. Szukana
# WEWNATRZ tresci backtickow (finditer), a nie jako CALA ich zawartosc: paragon
# bywa komenda (`python scripts/adr_number_gate.py .`), a stara wersja takiego
# tokenu ani nie sprawdzala, ani nie raportowala jako POMINIETY - przez co
# bramka nie walidowala sciezki nawet do samej siebie (zmierzone: DWA takie
# tokeny w AGENTS.md), a plik deklarowal "any token with a / and a code extension".
CODE_PATH_RX = re.compile(
    r"(?<![A-Za-z0-9_.@/-])"
    r"([A-Za-z0-9_.@-]+(?:/[A-Za-z0-9_.@-]+)+\.(?:" + _EXT + r"))"
    r"(?![A-Za-z0-9_.@-])"
)
# Placeholdery szablonow (`0NNN_nazwa.sql`, `YYYY-MM-DD`) - nie paragony.
PLACEHOLDER_RX = re.compile(r"NNNN|NNN_|YYYY")
# Znaki, ktore same z siebie robia z tokenu szablon/glob, a nie sciezke.
SZABLON_ZNAKI_RX = re.compile(r"[<>*]")
KONCOWKA_PLIKU_RX = re.compile(r"\.(?:" + _EXT + r")$")

# Korzenie, wzgledem ktorych AGENTS.md pisze SKROTY. Lista jest krotka i kazda
# pozycja ma paragon (token, ktory ja wymusil) - inaczej "szukaj wszedzie"
# rozbroiloby bramke: przy dosc dlugiej liscie korzeni rozwiaze sie wszystko.
KORZENIE_SKROTOW: list[tuple[str, str]] = [
    ("", "sciezka pelna od korzenia repo"),
    ("backend/src", "routes/chat.ts, routes/metrics.ts, lib/pipeline/defense.ts"),
    ("backend/src/lib", "llm/provider.ts, mcp/connectors.ts, mcp-security/pipeline.ts, skills/integrity.ts"),
    ("frontend/src/app/components", "shared/types.ts"),
]


def commit_exists(repo: Path, sha: str) -> bool:
    res = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--quiet", "--verify", f"{sha}^{{commit}}"],
        capture_output=True,
    )
    return res.returncode == 0


def czy_plytki(repo: Path) -> bool:
    """Plytkosc pyta GIT, nie system plikow.

    W worktree `.git` jest PLIKIEM ("gitdir: ..."), wiec `.git/shallow` nigdy
    nie istnieje i stara detekcja zwracala tam False - na plytkim klonie
    kazdy brakujacy hash lecial twardym FAIL-em zamiast WARN-em.
    """
    res = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--is-shallow-repository"],
        capture_output=True, text=True,
    )
    return res.returncode == 0 and res.stdout.strip() == "true"


def sciezki_w_tokenie(token: str) -> list[str]:
    """Sciezki kodu ukryte WEWNATRZ backtickowanego tokenu.

    Token bywa cala komenda albo zdaniem; sciezka nie musi byc jego calascia.
    """
    return [m.group(1) for m in CODE_PATH_RX.finditer(token)]


def rozwiaz_sciezke(repo: Path, rel: str) -> str | None:
    """Zwraca korzen, pod ktorym sciezka istnieje, albo None."""
    for korzen, _ in KORZENIE_SKROTOW:
        kandydat = (repo / korzen / rel) if korzen else (repo / rel)
        if kandydat.exists():
            return korzen
    return None


def zbierz_pominiete(
    text: str, sprawdzone: set[str]
) -> list[tuple[str, str]]:
    """Tokeny, ktore WYGLADAJA na paragon, a nie weszly do sprawdzenia.

    Bez tej listy raport "sprawdzono N" jest nie do zweryfikowania: nie widac,
    czy N to caly mianownik, czy tyle, ile akurat zlapal wzorzec.
    """
    pominiete: list[tuple[str, str]] = []
    for token in sorted(set(TOKEN_RX.findall(text))):
        t = token.strip()
        if t in sprawdzone:
            continue
        wyglada_na_plik = bool(KONCOWKA_PLIKU_RX.search(t))
        wyglada_na_hash = bool(re.fullmatch(r"[0-9a-f]{7,40}", t))
        if not (wyglada_na_plik or wyglada_na_hash):
            continue
        if PLACEHOLDER_RX.search(t) or SZABLON_ZNAKI_RX.search(t):
            powod = "placeholder/glob szablonu, nie paragon"
        elif wyglada_na_plik and "/" not in t:
            powod = "sama nazwa pliku bez katalogu - nierozstrzygalna"
        else:
            powod = "nierozpoznany ksztalt paragonu"
        pominiete.append((t, powod))
    return pominiete


def cele_linkow(text: str) -> list[str | None]:
    """Zawartosc kazdego `](...)` - po BALANSIE nawiasow, w obrebie jednej linii.

    None = nawias niedomkniety do konca linii, czyli ksztalt nierozstrzygalny.
    """
    wyniki: list[str | None] = []
    i = 0
    while True:
        i = text.find("](", i)
        if i == -1:
            return wyniki
        j = i + 2
        glebokosc = 1
        while j < len(text) and text[j] != "\n":
            if text[j] == "(":
                glebokosc += 1
            elif text[j] == ")":
                glebokosc -= 1
                if glebokosc == 0:
                    break
            j += 1
        if glebokosc == 0 and j < len(text) and text[j] == ")":
            wyniki.append(text[i + 2 : j])
            i = j + 1
        else:
            wyniki.append(None)
            i += 2


def klasyfikuj_linki(text: str) -> tuple[list[str], list[tuple[str, str]]]:
    """Dzieli cele linkow na SPRAWDZANE i POMINIETE (z powodem).

    Zaden cel nie moze wypasc poza obie listy - to byla dziura w mianowniku:
    zbierz_pominiete iterowalo wylacznie po tokenach w backtickach, wiec
    pominiety LINK nie trafial do raportu w ogole.
    """
    do_sprawdzenia: set[str] = set()
    pominiete: dict[str, str] = {}

    for surowy in cele_linkow(text):
        if surowy is None:
            pominiete.setdefault(
                "](...", "nawias linku niedomkniety w linii - nierozstrzygalny"
            )
            continue
        tresc = surowy.strip()
        m = CEL_LINKU_RX.match(tresc)
        if not tresc or not m:
            pominiete.setdefault(
                tresc or "](...)",
                "nierozpoznany ksztalt celu linku - sprawdz recznie",
            )
            continue
        cel = m.group(1)
        if cel.startswith("#"):
            pominiete.setdefault(cel, "kotwica w tym samym dokumencie - nie plik")
        elif SCHEMAT_RX.match(cel):
            pominiete.setdefault(
                cel, "link zewnetrzny (schemat URL) - poza dyskiem"
            )
        elif not cel.split("#", 1)[0]:
            pominiete.setdefault(cel, "sam fragment bez pliku - nierozstrzygalny")
        else:
            do_sprawdzenia.add(cel)
    return sorted(do_sprawdzenia), sorted(pominiete.items())


def parsuj_argumenty(
    argv: list[str],
) -> tuple[list[str], str, bool] | None:
    """Pozycyjne / --plik / --strict.

    Wartosc `--plik` zzerana po INDEKSIE, nie po WARTOSCI: stara wersja usuwala
    z listy pozycyjnej kazdy argument rowny nazwie pliku, wiec `--plik .`
    kasowalo takze argument katalogu repo.
    """
    pozycyjne: list[str] = []
    doc_name = "AGENTS.md"
    strict = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--strict":
            strict = True
        elif a == "--plik":
            if i + 1 >= len(argv):
                return None
            doc_name = argv[i + 1]
            i += 1
        elif not a.startswith("--"):
            pozycyjne.append(a)
        i += 1
    return pozycyjne, doc_name, strict


def samotest() -> int:
    """Kontrola pozytywna wzorcow na ZNANYM-ZLYM (--samotest, wolane w CI).

    Bramka jest gotowa dopiero po czerwonym: kazdy przypadek ponizej to ksztalt,
    ktory przechodzil przez ktoras wersje tej bramki BEZ sprawdzenia i BEZ
    raportu w POMINIETYCH. W stosie nie ma harnessu do pythona, wiec fixture'y
    zyja tutaj - inaczej nastepny refaktor tych regexow nie ma na czym paść.
    """
    bledy: list[str] = []

    def sprawdz(nazwa: str, otrzymano: object, oczekiwano: object) -> None:
        if otrzymano != oczekiwano:
            bledy.append(f"{nazwa}: otrzymano {otrzymano!r}, oczekiwano {oczekiwano!r}")

    # 1. Sciezka W SRODKU tokenu (komenda). Zmierzone w AGENTS.md: dwa takie
    #    tokeny - bramka nie walidowala sciezki nawet do samej siebie.
    sprawdz(
        "sciezka w komendzie",
        sciezki_w_tokenie("python scripts/agents_md_receipt_gate.py ."),
        ["scripts/agents_md_receipt_gate.py"],
    )
    sprawdz(
        "dwie sciezki w jednym tokenie",
        sciezki_w_tokenie("cp backend/src/lib/audit.ts docs/audit.md"),
        ["backend/src/lib/audit.ts", "docs/audit.md"],
    )
    # 2. Ksztalty, ktore sciezka NIE sa - maja wypasc z checku, ale nie z raportu.
    for token in ("audit*.ts", "stream.ts", ".matematic/releases/<x>/README.md"):
        sprawdz(f"nie-sciezka {token}", sciezki_w_tokenie(token), [])

    # 3. Nawias W SCIEZCE linku. `[^)]+` ucinal to na `app/(pages` i zglaszal
    #    martwy link, ktorego nie ma - falszywy alarm gorszy od przeoczenia.
    sprawdz(
        "link z nawiasem w sciezce",
        cele_linkow("[p](frontend/src/app/(pages)/workflows/page.tsx) x"),
        ["frontend/src/app/(pages)/workflows/page.tsx"],
    )
    sprawdz("link niedomkniety", cele_linkow("[p](a/b.md\n"), [None])

    # 4. Klasyfikacja celow: ZADEN nie wypada poza obie listy.
    tekst = (
        '[a](AGENTS.md "Tytul") [b](/AGENTS.md) [c](https://x.pl) [d](#sekcja) '
        "[e](a/(b)/c.tsx) [f](nie domkniete\n"
    )
    do_sprawdzenia, pominiete = klasyfikuj_linki(tekst)
    sprawdz(
        "link z tytulem + root-relative + nawias -> sprawdzane",
        do_sprawdzenia,
        ["/AGENTS.md", "AGENTS.md", "a/(b)/c.tsx"],
    )
    sprawdz(
        "kotwica, link zewnetrzny i niedomkniety -> POMINIETE z powodem",
        len(pominiete),
        3,
    )
    if len(do_sprawdzenia) + len(pominiete) != tekst.count("]("):
        bledy.append("cel linku wypadl poza OBIE listy")

    # 5. Wartosc --plik zzerana po INDEKSIE, nie po WARTOSCI: `--plik .`
    #    kasowalo wczesniej takze argument katalogu repo.
    sprawdz("--plik .", parsuj_argumenty([".", "--plik", "."]), (["."], ".", False))
    sprawdz(
        "--strict nie jest pozycyjny",
        parsuj_argumenty(["repo", "--strict"]),
        (["repo"], "AGENTS.md", True),
    )
    sprawdz("--plik bez wartosci", parsuj_argumenty(["--plik"]), None)

    # 6. KSZTALT HASHA. Pierwsza wersja bramki znala wylacznie 7 i 40 znakow, a
    #    git rozszerza skrot przy kolizji - 8-12 znakow to legalny paragon.
    #    Zwezenie HASH_RX do {7} przechodzilo przez samotest bez czerwonego, bo
    #    zaden fixture nie mial hasha innej dlugosci niz 7.
    sprawdz(
        "hash 7/8/12/40 znakow lapany",
        HASH_RX.findall(
            "`96267f8` `1de8f84c` `abcdef012345` "
            "`0123456789abcdef0123456789abcdef01234567`"
        ),
        [
            "96267f8",
            "1de8f84c",
            "abcdef012345",
            "0123456789abcdef0123456789abcdef01234567",
        ],
    )
    # Granice w DRUGA strone: 6 znakow to za krotko, 41 za dlugo, a token z
    # nie-hexem nie jest hashem. Bez tego rozluznienie wzorca tez byloby ciche.
    sprawdz(
        "za krotki / za dlugi / nie-hex nie jest hashem",
        HASH_RX.findall(
            "`96267f` `0123456789abcdef0123456789abcdef012345678` `96267g8`"
        ),
        [],
    )

    # 7. ROZWIAZYWANIE SCIEZKI. Podmiana rozwiaz_sciezke na stale "" (korzen
    #    repo) przechodzila przez samotest, bo zaden fixture nie odroznial
    #    korzenia od skrotu ani nie sprawdzal, ze BRAK sciezki daje None.
    #    Fixture jest hermetyczny (tmpdir), wiec nie zalezy od tego, ktore pliki
    #    akurat zyja w repo.
    with tempfile.TemporaryDirectory() as tmp:
        fake = Path(tmp)
        (fake / "AGENTS.md").write_text("x", encoding="utf-8")
        (fake / "backend" / "src" / "routes").mkdir(parents=True)
        (fake / "backend" / "src" / "routes" / "chat.ts").write_text("x", encoding="utf-8")
        sprawdz("sciezka od korzenia repo", rozwiaz_sciezke(fake, "AGENTS.md"), "")
        sprawdz(
            "sciezka WYLACZNIE przez skrot backend/src",
            rozwiaz_sciezke(fake, "routes/chat.ts"),
            "backend/src",
        )
        sprawdz(
            "sciezka nieistniejaca -> None, nie korzen",
            rozwiaz_sciezke(fake, "routes/nie-ma-mnie.ts"),
            None,
        )

    # 8. REPORTER POMINIETYCH JEST W MIANOWNIKU. zbierz_pominiete zamienione na
    #    pusta petle (`continue`) przechodzilo przez samotest, bo zaden fixture
    #    nie wolal tej funkcji - a to ona odpowiada za to, ze "sprawdzono N" da
    #    sie zweryfikowac. Bramka bez raportu pominietych swieci na zielono tym
    #    mocniej, im mniej widzi.
    tekst_pominiete = (
        "`audit*.ts` `stream.ts` `0NNN_migracja.sql` `deadbee` "
        "`backend/src/routes/chat.ts` `zwykly tekst`"
    )
    sprawdz(
        "tokeny wygladajace na paragon trafiaja na POMINIETE z powodem",
        zbierz_pominiete(tekst_pominiete, {"backend/src/routes/chat.ts"}),
        [
            ("0NNN_migracja.sql", "placeholder/glob szablonu, nie paragon"),
            ("audit*.ts", "placeholder/glob szablonu, nie paragon"),
            ("deadbee", "nierozpoznany ksztalt paragonu"),
            ("stream.ts", "sama nazwa pliku bez katalogu - nierozstrzygalna"),
        ],
    )
    sprawdz(
        "token JUZ sprawdzony nie dubluje sie w POMINIETYCH",
        zbierz_pominiete("`backend/src/routes/chat.ts`", {"backend/src/routes/chat.ts"}),
        [],
    )

    for b in bledy:
        print(f"SAMOTEST FAIL: {b}", file=sys.stderr)
    if bledy:
        return 1
    print("OK: samotest wzorcow bramki - wszystkie znane-zle wykryte")
    return 0


def main(argv: list[str]) -> int:
    if "--samotest" in argv:
        return samotest()
    parsed = parsuj_argumenty(argv)
    if parsed is None:
        print("BLAD: --plik wymaga argumentu", file=sys.stderr)
        return 2
    args, doc_name, strict = parsed

    repo = Path(args[0]) if args else Path(".")
    doc = repo / doc_name
    if not doc.is_file():
        print(f"BLAD: nie znaleziono {doc}", file=sys.stderr)
        return 2
    if not (repo / ".git").exists():
        print(f"BLAD: {repo} nie jest repozytorium git", file=sys.stderr)
        return 2

    text = doc.read_text(encoding="utf-8")
    shallow = czy_plytki(repo)
    errors: list[str] = []
    warnings: list[str] = []

    # Hashe. Token czysto cyfrowy jest DWUZNACZNY: `3868716` to zywy skrot
    # commita w tym repo, a `1234567` w przykladzie to zwykla liczba. Rozstrzyga
    # DOWOD, nie ksztalt: cyfrowy token bez commita ladnie schodzi do POMINIETYCH
    # (raportowany), a nie do FAIL-i. Odwrotna kolejnosc - wykluczenie wszystkich
    # cyfrowych z gory - kasowala z mianownika zywy paragon.
    hashes: list[str] = []
    nie_hashe: list[tuple[str, str]] = []
    for sha in sorted(set(HASH_RX.findall(text))):
        if commit_exists(repo, sha):
            hashes.append(sha)
            continue
        if sha.isdigit():
            nie_hashe.append(
                (sha, "token czysto cyfrowy i brak takiego commita - liczba, nie hash")
            )
            continue
        hashes.append(sha)
        msg = f"martwy hash `{sha}` - nie ma takiego commita w historii"
        if shallow and not strict:
            warnings.append(msg + " (klon plytki - moze byc za granica shallow)")
        else:
            errors.append(msg)

    links, pominiete_linki = klasyfikuj_linki(text)
    for cel in links:
        plik = cel.split("#", 1)[0]
        # Cel root-relative (`](/x)`) liczymy od korzenia repo, nie od katalogu
        # dokumentu - w tym repo AGENTS.md lezy w korzeniu, ale zaleznosc od
        # tego zbiegu okolicznosci byla niewypowiedziana.
        baza = repo if plik.startswith("/") else doc.parent
        if not (baza / plik.lstrip("/")).exists():
            errors.append(f"martwy link `{cel}` - cel nie istnieje na dysku")

    # Sciezki wyciagane z WNETRZA tokenu; token, z ktorego cos wyszlo, jest
    # pokryty i nie ma prawa pojawic sie potem na liscie POMINIETYCH.
    kandydaci: set[str] = set()
    tokeny_pokryte: set[str] = set()
    for token in set(TOKEN_RX.findall(text)):
        t = token.strip()
        realne = [
            rel for rel in sciezki_w_tokenie(t) if not PLACEHOLDER_RX.search(rel)
        ]
        if realne:
            tokeny_pokryte.add(t)
            kandydaci.update(realne)
    code_paths = sorted(kandydaci)
    przez_skrot = 0
    for rel in code_paths:
        korzen = rozwiaz_sciezke(repo, rel)
        if korzen is None:
            errors.append(f"martwa sciezka `{rel}` - pliku nie ma w repo")
        elif korzen:
            przez_skrot += 1

    sprawdzone = (
        set(hashes) | set(code_paths) | tokeny_pokryte | {t for t, _ in nie_hashe}
    )
    pominiete = zbierz_pominiete(text, sprawdzone) + nie_hashe + pominiete_linki

    checked = len(hashes) + len(links) + len(code_paths)
    if checked == 0:
        # Pusta lista sprawdzen = bramka bez przedmiotu; nie udawaj zieleni.
        print(f"BLAD: w {doc_name} nie znaleziono ZADNEGO paragonu do sprawdzenia "
              "(hash/link/sciezka) - bramka z pusta lista przechodzi zawsze",
              file=sys.stderr)
        return 2
    # Kontrola pozytywna mianownika dla dokumentu, ktory DEKLARUJE wszystkie trzy
    # rodzaje paragonow. Zerowy licznik jednego rodzaju przy zywych pozostalych =
    # wzorzec przestal lapac, a bramka nadal swieci na zielono.
    if doc_name == "AGENTS.md":
        puste = [
            nazwa for nazwa, n in
            (("hash", len(hashes)), ("link", len(links)), ("sciezka", len(code_paths)))
            if n == 0
        ]
        if puste:
            print(f"BLAD: w {doc_name} zero paragonow rodzaju: {', '.join(puste)} - "
                  "AGENTS.md deklaruje wszystkie trzy, wiec to nie jest stan "
                  "dokumentu, tylko wzorzec, ktory przestal lapac",
                  file=sys.stderr)
            return 2

    for w in warnings:
        print(f"WARN: {w}")

    # MIANOWNIK zawsze, nie tylko przy porazce. Pominiete grupowane po POWODZIE -
    # rosnaca grupa to sygnal, ze wzorzec przestal siegac tam, gdzie powinien.
    print(f"MIANOWNIK: sprawdzono {checked} paragonow "
          f"({len(hashes)} hashy, {len(links)} linkow, {len(code_paths)} sciezek "
          f"- w tym {przez_skrot} przez skrot wzgledem KORZENI_SKROTOW); "
          f"POMINIETO {len(pominiete)}")
    wg_powodu: dict[str, list[str]] = {}
    for token, powod in pominiete:
        wg_powodu.setdefault(powod, []).append(token)
    for powod in sorted(wg_powodu):
        tokeny = sorted(wg_powodu[powod])
        print(f"  POMINIETO {len(tokeny)}x ({powod}): {', '.join(tokeny)}")

    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        print(f"\n{len(errors)} martwych paragonow w {doc_name}")
        return 1

    print(f"OK: {doc_name} - paragony zywe"
          f"{' (' + str(len(warnings)) + ' WARN)' if warnings else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
