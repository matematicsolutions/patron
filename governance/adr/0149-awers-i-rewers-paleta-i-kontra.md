# ADR-0149 - Awers i rewers: paleta dwoch pigmentow ze zlotem, tryb ciemny jako rewers, perymetr w kontrze

- **Status:** Zaakceptowany (WM 2026-08-21, "masz zielone"; wdrozone fale D1+D2)
- **Data:** 2026-08-21
- **Galaz:** `feat/design-system-2-0` (kontynuacja ADR-0147)
- **Zrodlo:** propozycja "Awers i rewers" zatwierdzona przez WM 2026-08-21, zbudowana na
  pomiarze 9 konkurencyjnych interfejsow z ADR-0147
- **Mapuje na:** ADR-0147 (system wizualny 2.0), ADR-0146 (grounding), ADR-0026 (Merkle),
  ADR-0143 (bramka egress), ADR-0148 (Sprawy i Warsztat)

## Kontekst

ADR-0147 dal produktowi kroje dokumentowe, trojstan jako tokeny i pasek perymetru, ale
zostawil dwie palety: pergamin z bordo w dzien i osobny "cieply grafit" wieczorem. WM
zamowil rewizje: mniej kolorow, ciemna strona jako odwrotnosc jasnej, wyrozniki
architektoniczne na pierwszym planie.

Z pomiaru ADR-0147 wiemy, ze nikt w kategorii - ani swiatowa czolowka, ani polska stawka -
nie traktuje trybu ciemnego jako czesci tozsamosci; wszedzie to techniczna odwrotnosc
dorobiona z szarosci.

## Decyzja

1. **Dwa pigmenty + jedno zloto.** Awers (jasny): papier Cloud Dancer `#F1EEE5`, inkaust
   Cocoa Powder `#2B2219` (kontrast 13.4:1). Rewers (ciemny) NIE jest osobna paleta - te
   same pigmenty zamienione rolami: papier `#221B15`, inkaust `#EFEBE0` (14.4:1). Zloto
   matowe: ornament `#B08D4C`, tekstowe `--seal` `#7A5F2B` (5.2:1), na rewersie `#C9A25E`
   (7.1:1). **Bordo znika z produktu** - pieczec przejmuje zloto.
2. **Zloto sie zarabia.** Zloto wystepuje wylacznie na znakach autorytetu: pieczec sprawy
   (Merkle, ADR-0026), grzbiet aktywnej sprawy w nawigacji, fokus, odsylacz do zrodla /
   akt. Nigdy jako dekoracja i **nigdy jako kolor stanu** - trojstan groundingu zachowuje
   wlasna triade (`#2F6B4F` / `#8A5C0B` / `#8E2B2B`, rewers jasniejszy) i zawsze idzie
   w parze z etykieta slowna.
3. **Perymetr w kontrze.** Pasek perymetru renderuje sie ZAWSZE w odwroconych barwach
   wzgledem biezacego motywu (tokeny `--rev-*`): ciemny pas na jasnym ekranie i odwrotnie.
   Governance jest wizualnie "druga strona kartki" - widoczny obwodowo, nigdy nie zlewa
   sie z trescia.
4. **Grzbiety akt.** Sprawa w nawigacji to grzbiet wolumenu (kreska po lewej); zloty
   grzbiet ma wylacznie aktywna sprawa.
5. **Alias bordeaux.** Klasy `*-bordeaux` mapuja na `var(--seal)` (bez migracji 64 uzyc
   naraz); nowy kod pisze `seal` / `gold`. Rozdzial nazwy widocznej od identyfikatora -
   ten sam manewr co ADR-0148.

## Konsekwencje

- Jedna paleta zamiast dwoch; edycja tokenow w `globals.css` (rampa `--n-*` z ADR-0147
  scentralizowala kolory, wiec bez migracji klas).
- Podswietlenia cytatu w PDF/DOCX schodza z niebieskiego forka na zloto; tracked changes
  na trojstan.
- Rewers dokumentu (podglad Maski jako "druga strona" z przyciskiem Obroc) = faza D3,
  wymaga osobnej wyceny, NIE wchodzi tym ADR-em.
- Los bordo w materialach marki POZA produktem - osobna decyzja WM.

## Weryfikacja (2026-08-21)

`tsc` czysty, vitest frontu 60/60, build produkcyjny czysty; kontrola pozytywna na
zbudowanym CSS - klasy `rev-*`, `seal*`, `border-gold` wygenerowane, hexy palety obecne;
tokeny sprawdzone na zywo w dev (rewers aktywny, `--rev-*` odwrocone). Pasek perymetru
w kontrze obejrzec wzrokowo po zalogowaniu (wymaga backendu) - pozycja otwarta.
