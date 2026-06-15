# input-security - skan bezpieczenstwa dokumentu wejsciowego

Deterministyczny, lokalny (zero-LLM, zero-cloud) skan tresci dokumentu klienta
**zanim** trafi do modelu lub indeksu RAG. Wykrywa proby manipulacji modelem
(prompt-injection, jailbreak), ukryta tresc (zero-width, akcje PDF), zaciemnianie
(homoglify, base64, bidi) i techniki omijania detekcji (token-splitting, znaki tag).

Decyzja architektoniczna: [governance/adr/0019-input-document-security-pipeline-pl.md](../../../../governance/adr/0019-input-document-security-pipeline-pl.md).

## Status

**Skeleton (ADR-0019, T1).** NIE wpiety w `upload.ts` / RAG / `streamChatWithTools` -
wpiecie w istniejacy kontrakt to osobna decyzja (przyszly ADR-0020, kontrakt Art. 8
Konstytucji). Modul jest bezstanowa, czysta funkcja - gotowy do integracji i testow.

## Uzycie

```ts
import { analyzeInput } from "./lib/input-security";

const result = analyzeInput({
    text: extractedText,        // tekst po ekstrakcji (convert.ts)
    fileName: "umowa.pdf",
    declaredType: "application/pdf",
    buffer: rawBytes,           // opcjonalnie, dla detektorow binarnych (PDF)
});

switch (result.action) {
    case "blocked":       /* nie przekazuj do modelu (zagrozenie jednoznaczne) */ break;
    case "human_review":  /* skieruj do Inspektora/Operatora */ break;
    case "quarantined":   /* zastosuj redakcje / odrzuc warstwe */ break;
    case "allowed":       /* tresc moze przejsc */ break;
}
```

## Pochodzenie (atrybucja cherry-pick)

Pattern strukturalny **cherry-picked** z
[jdai-ca/atticus](https://github.com/jdai-ca/atticus) (`Apache-2.0 OR Commercial`,
John Kost / JDAI.ca, snapshot **2026-05-22**) - bierzemy galaz Apache-2.0.
Pelna atrybucja w [THIRD_PARTY_INSPIRATIONS.md](../../../../THIRD_PARTY_INSPIRATIONS.md).

**Co jest wzorcem (z Atticusa)**:
- 5-fazowy orchestrator (`analyzeFile()` -> u nas `analyzeInput()`).
- Czterostanowy model akcji (`allowed`/`quarantined`/`human_review`/`blocked`).
- Taksonomia kategorii zagrozen.

**Co jest NASZE (napisane od zera, PL-aware)**:
- Polski korpus sygnalow prompt-injection / jailbreak (`detectors/adversarial-pl.ts`).
- Homoglify wykrywane przez **mieszanie pism** (lacinka + cyrylica/greka), a NIE
  przez "znak nie-ASCII" - polskie diakrytyki (a/e/o/l/z/z/c/n/s) NIE sa flagowane
  (`detectors/obfuscation.ts`).
- Detektor evasion bez porownania NFC/NFD (lamalo sie na polszczyznie); zamiast tego
  stosy znakow laczacych i znaki tag (`detectors/evasion.ts`).

NIE jest to tlumaczenie 1:1. Detektory Atticusa sa English-only i czesciowo wrogie
polszczyznie - patrz ADR-0019, sekcja "Co piszemy od zera".

## Pliki

| Plik | Rola |
|---|---|
| `pipeline.ts` | Orchestrator `analyzeInput()` + `DEFAULT_DETECTORS` |
| `detectors/adversarial-pl.ts` | Prompt-injection / jailbreak PL+EN, context-stuffing |
| `detectors/steganography.ts` | Zero-width chars, ukryte akcje/warstwy PDF |
| `detectors/obfuscation.ts` | Homoglify (mieszane pisma), base64, bidi |
| `detectors/evasion.ts` | Token-splitting, stosy znakow laczacych, znaki tag |
| `scorer.ts` | Risk score 0-100 -> threat level -> akcja |
| `report.ts` | Raport PL z zaleceniami per rola governance |
| `types.ts` | Kontrakty (Detector, SecurityFinding, SecurityScanResult) |

## Testy

```bash
cd backend && npx vitest run src/lib/input-security
```

Bramka PL-safety: realny polski dokument z diakrytykami = **ZERO findings**.
