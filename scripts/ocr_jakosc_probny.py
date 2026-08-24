#!/usr/bin/env python3
"""Probny pomiar jakosci OCR: ten sam obraz przez model edycji i przez inny model.

NARZEDZIE RECZNE - celowo NIE wpiete w build ani w CI. Wymaga Pillow
(`pip install pillow`) i zainstalowanego Tesseracta; obie rzeczy sa poza
zaleznosciami produktu, wiec nie chcemy ich w sciezce wydania.

Po co istnieje: bramka `desktop/scripts/ocr-lang-gate.test.cjs` sprawdza, ze
wlasciwy plik `<lang>.traineddata` LEZY w paczce. To nie to samo, co dowod, ze
niemiecka umowa jest czytana po niemiecku. Ten skrypt daje ten drugi dowod -
liczbe, ktora mozna wkleic do ADR zamiast zdania "powinno byc lepiej".

Uzyte przy ADR-0151 (2026-08-24). Zmierzone wtedy (udzial poprawnie rozpoznanych
slow, model edycji vs model polski):

    DE 100/47   BR 100/50   IT 100/71   FR 100/62   ES 100/67

UWAGA na fixture: probka MUSI zawierac znaki charakterystyczne dla jezyka.
Pierwsza wersja zdania hiszpanskiego nie miala ani jednego znaku diakrytycznego
i dawala remis 100/100 - wynik prawdziwy i bezuzyteczny, bo nie sprawdzal
zjawiska, tylko to, ze oba modele czytaja lacinke.

Uzycie:
    python scripts/ocr_jakosc_probny.py
    python scripts/ocr_jakosc_probny.py --tessdata D:/tessdata --odniesienie eng
"""
import argparse
import os
import subprocess
import sys
import tempfile

TESSDATA_DOMYSLNY = os.path.join(os.path.expanduser("~"), "tessdata")
TESSERACT_DOMYSLNY = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# Zdania wierne jezykowi umowy - z akcentami, umlautami i tylda.
PROBKI = {
    "deu": "Die Kündigungsfrist beträgt drei Monate zum Quartalsende. "
           "Änderungen bedürfen der Schriftform.",
    "por": "O prazo de rescisão é de três meses. As alterações exigem forma escrita.",
    "ita": "Il termine di preavviso è di tre mesi. Le modifiche richiedono forma scritta.",
    "fra": "Le délai de préavis est de trois mois. Les modifications exigent la forme écrite.",
    "spa": "La cláusula de indemnización por año incompleto exige resolución escrita "
           "del señor administrador antes del vencimiento.",
}


def czcionka(rozmiar=34):
    from PIL import ImageFont
    for sciezka in (r"C:\Windows\Fonts\times.ttf", r"C:\Windows\Fonts\georgia.ttf",
                    r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(sciezka):
            return ImageFont.truetype(sciezka, rozmiar)
    return ImageFont.load_default()


def zrob_obraz(tekst, plik):
    from PIL import Image, ImageDraw
    f = czcionka()
    img = Image.new("L", (1400, 220), color=255)
    d = ImageDraw.Draw(img)
    ciecie = tekst.rfind(" ", 0, len(tekst) // 2 + 20)
    d.text((30, 45), tekst[:ciecie], font=f, fill=0)
    d.text((30, 110), tekst[ciecie + 1:], font=f, fill=0)
    img.save(plik)


def ocr(tesseract, tessdata, plik, lang):
    srodowisko = dict(os.environ, TESSDATA_PREFIX=tessdata)
    wynik = subprocess.run([tesseract, plik, "stdout", "-l", lang, "--psm", "6"],
                           capture_output=True, env=srodowisko)
    return wynik.stdout.decode("utf-8", "replace").strip()


def podobienstwo(a, b):
    sa, sb = set(a.lower().split()), set(b.lower().split())
    return len(sa & sb) / max(len(sa | sb), 1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tessdata", default=TESSDATA_DOMYSLNY)
    ap.add_argument("--tesseract", default=TESSERACT_DOMYSLNY)
    ap.add_argument("--odniesienie", default="pol",
                    help="model porownawczy (domyslnie pol - stan sprzed ADR-0151)")
    a = ap.parse_args()

    if not os.path.exists(a.tesseract):
        print(f"Brak tesseract.exe pod {a.tesseract} - podaj --tesseract.")
        return 2
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Brak Pillow. Zainstaluj: pip install pillow")
        return 2

    tmp = tempfile.mkdtemp(prefix="ocr-probny-")
    slabe = []
    print(f"{'jezyk':7s} {'model edycji':>13s} {'model ' + a.odniesienie:>13s}   werdykt")
    for lang, zdanie in PROBKI.items():
        plik = os.path.join(tmp, f"{lang}.png")
        zrob_obraz(zdanie, plik)
        wlasny = podobienstwo(ocr(a.tesseract, a.tessdata, plik, lang), zdanie)
        odniesienie = podobienstwo(ocr(a.tesseract, a.tessdata, plik, a.odniesienie), zdanie)
        lepszy = wlasny > odniesienie
        if not lepszy:
            slabe.append(lang)
        print(f"{lang:7s} {wlasny:12.0%} {odniesienie:13.0%}   "
              f"{'model edycji lepszy' if lepszy else 'BEZ POPRAWY - sprawdz probke'}")
    print()
    if slabe:
        print(f"Bez poprawy dla: {', '.join(slabe)}.")
        print("Zanim uznasz brak efektu: czy probka tego jezyka zawiera jego znaki "
              "charakterystyczne? Fixture bez zjawiska daje remis, nie dowod.")
        return 1
    print("Kazdy jezyk czyta swoj tekst lepiej niz modelem odniesienia.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
