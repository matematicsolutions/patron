# Patron - Governance

Dokumenty governance produktu Patron. Kancelaria akceptuje je
przed wdrożeniem.

## Pliki

| Plik | Opis | Audytorium |
|---|---|---|
| **[CONSTITUTION.md](./CONSTITUTION.md)** | Konstytucja AI Patrona v1.0.0 - 9 zasad, granice, role, audyt, ewolucja, mapa do AI Act + RODO + Etyki | Zarząd kancelarii, IOD |
| **[IMPLEMENTATION_PLAYBOOK.md](./IMPLEMENTATION_PLAYBOOK.md)** | Plan wdrożenia 6-8 tygodni, krok po kroku, RACI | Administrator + Operator + Inspektor |
| **[adr/](./adr/)** | Architecture Decision Records - uzasadnienie decyzji projektowych | Operator, audytor zewnętrzny |

## Dla kogo

- **Zarząd / partner zarządzający**: zaczyna od `CONSTITUTION.md`
  (15-25 stron, czytanie 30 min).
- **IT / Operator**: zaczyna od `IMPLEMENTATION_PLAYBOOK.md` (12 stron,
  z komendami do uruchomienia) + `deploy/README.md` (runbook).
- **IOD / Inspektor**: zaczyna od `CONSTITUTION.md` §5 (audyt) + §6
  (ewolucja) + Załącznik A (mapa do RODO/AI Act).
- **Audytor zewnętrzny**: przegląd `adr/` w kolejności numerów + `audit_log`
  przez `npm run audit:verify`.

## Workflow akceptacji

1. **Kancelaria** czyta Konstytucję, podpisuje § Administrator.
2. **MateMatic** kontrasygnuje (podpis w stopce CONSTITUTION.md).
3. **Operator** prowadzi wdrożenie według Implementation Playbook (Tydzień 0 → 6).
4. **Inspektor** otwiera audyt po Tygodniu 2.
5. **Decyzja go-live** w Tygodniu 6 → produkcja.

## Aktualizacja

Każda zmiana Konstytucji = nowy ADR + commit + powiadomienie
Administratora kancelarii. SEMVER:
- **MAJOR** (X.0.0): zmiana znaczenia zasady → akceptacja + okres 60 dni
- **MINOR** (1.X.0): nowa zasada / rola → notatka
- **PATCH** (1.0.X): doprecyzowanie → changelog

Wersja aktualna: **1.0.0** (2026-05-20).
