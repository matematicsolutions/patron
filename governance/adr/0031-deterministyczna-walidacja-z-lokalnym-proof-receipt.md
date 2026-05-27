# ADR-0031: Deterministyczna walidacja decyzji z lokalnym proof receipt - kontrpropozycja do ICME Preflight

> **Uwaga numeracja**: ostatni zajety ADR to 0029. ADR-0030 jest zarezerwowany na implementacje SRE Governance (deklaracja w ADR-0029). Ten ADR celowo bierze 0031 zeby nie wchodzic w slot rezerwacji.

**Status**: PROPONOWANY (decision record, bez kodu). Architektoniczna kontrpropozycja: oni cloud, my offline.

**Data**: 2026-05-24

**Powiazane zasady** (Konstytucja Patrona v1.2.1, zweryfikowane grepem - weryfikacja grepem Konstytucji przed cytatem):
- **Art. 1 - Lokalność danych** (RODO art. 25, AI Act art. 10) - GLOWNA zasada. ICME Preflight wysyla `structured action` (matter, input, tool) i `policy_id` do `api.icme.io` (US, cloud-only). To narusza Art. 1 wprost - kazda kancelaria polska musialaby zawrzec DPA + transfer poza EOG (DPF/SCC). Brak self-hostingu, brak EU region. **Twardy zakaz dla Patrona jako zaleznosc**.
- **Art. 5 - Tajemnica zawodowa** (Pr.Adw. art. 6, Pr.RP art. 3) - bezwzgledna. `structured action` zawierajacy `matter` (sygnatura, identyfikator sprawy) opuszczajacy maszyne kancelarii bez aktywnej zgody klienta = naruszenie. Nawet "Private Venice tier zero data retention contractually" to gwarancja umowna (na zaufaniu), nie techniczna.
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - tu ICME ma cos co my **chcemy zaadaptowac lokalnie**: deterministyczne werdykty + verifiable proof receipt (`check_id` + `policy_hash` + `zk_proof_id`) ktore audytor moze zweryfikowac post-hoc. Pattern uzupelnia nasz hash-chain (ADR-0001) + planowany Merkle (ADR-0026 rezerwacja z ADR-0024) o **dowod KAŻDEJ pojedynczej decyzji**, nie tylko integralność lancucha.
- **Art. 4 - Neutralnosc wobec dostawcow** - cherry-pickujemy patterny, nie wpinamy zaleznosci ICME. Patron pozostaje vendor-neutral.
- **Art. 8 - Stalosc kontraktow** - lokalny verifier offline dziedziczy kontrakt audit Patrona. Brak zewnetrznych zaleznosci runtime.

**Powiazane ADR**:
- **ADR-0024** - cherry-pick decision record dla Microsoft AGT. Ten ADR jest **rownoleglym** decision record dla ICME Preflight - ta sama metoda (cherry-pick wzorca, NIE wpinanie zaleznosci).
- **ADR-0001** - hash-chain audit. Lokalny proof receipt dziedziczy istniejacy audit path, zapisuje `check_id` jako pole eventu.
- **ADR-0019/0020** - input-security. Decyzje (allowed/quarantined/human_review/blocked) sa kandydatami do produkcji proof receipt - kazdy werdykt input-security bedzie mial `check_id`.
- **ADR-0025** - mcp-security. Decyzje Gateway'a (allowed/audit/human_review/denied) sa kandydatami do proof receipt - kazda decyzja security gateway bedzie weryfikowalna post-hoc.

---

## Decyzja

Patron adoptuje **trzy patterny** ze wzoru ICME Preflight ([icme-preflight-guardrail](https://github.com/ICME-Lab/icme-preflight-guardrail) MIT + [preflight-mike](https://github.com/hshadab/preflight-mike) MIT + dokumentacja [docs.icme.io](https://docs.icme.io)). Wzorzec sklasyfikowany jako TRAFIONE warunkowo - patrz `reference_narzedzia_oceny_2026-05-14.md` poz. #68. Wzorzec, NIE kod, NIE zaleznosc HTTP.

**Pattern 1 - Plain English -> SMT-LIB compilation -> lokalny solver**
- Polityki kancelarii (np. "no unauthorized legal advice", "privilege boundary", "PII egress", "citation integrity", "escalation scope") pisane po polsku/angielsku przez Operatora.
- Kompilacja do SMT-LIB lokalnie (biblioteka pythona/TS, np. Z3 binding lub minizinc binding) - jednorazowo, wynik (compiled policy) cache'owany.
- Solver lokalny (Z3 najpopularniejszy, MIT, dziala offline) sprawdza kazda decyzje Patrona przed jej akceptacja.
- Werdykt: SAT (allowed) / UNSAT (blocked) / ERROR (fail-closed). Deterministyczne, ta sama input = ten sam output, niezalezne od LLM.
- Wartosc nad LLM-judge: LLM-judge jest probabilistyczny i jailbreakable; solver SMT-LIB ma matematyczny dowod.

**Pattern 2 - Lokalny proof receipt (`check_id` + `policy_hash`) jako rozszerzenie audit hash-chain**
- Kazda decyzja Patrona produkuje proof receipt: `{check_id: uuid, policy_hash: sha256(compiled_policy), action_hash: sha256(structured_action), verdict: ALLOWED/BLOCKED, latency_ms, timestamp}`.
- Receipt zapisywany w istniejacym audit log (ADR-0001) jako nowy typ eventu `policy_verdict`.
- `policy_hash` jest commitmentem do **konkretnej skompilowanej wersji polityki** w danym momencie. Audyt regulatora pyta "jakie regulacje byly w mocy 2026-09-12 o 14:23?" - odpowiedz to konkretny hash + wskazanie polityki ktora ten hash produkuje.
- Wzorzec rozszerza nasz Merkle roadmap (ADR-0026 rezerwacja): Merkle daje **integralnosc lancucha**, proof receipt daje **dowod KAŻDEJ pojedynczej decyzji**. Razem.

**Pattern 3 - Public verifier offline (regulator weryfikuje bez dostepu do kancelarii)**
- Wzorzec ICME: `icme.io/proofs/<check_id>` dostepny dla regulatora bez dostepu do firmy. Eksponuje TYLKO `policy_hash` (nie tresc polityki), `verdict`, `latency_ms`, `created_at`.
- Adaptacja Patrona: **lokalny verifier binary** (CLI tool) ktory dostaje plik `proof.json` od kancelarii i weryfikuje deterministycznie bez dostepu do reszty systemu.
- Regulator (UODO, KIRP, audyt klienta) dostaje paczke `proofs.tar.gz` + binarka `patron-verify` -> sprawdza lokalnie. Nasza chmura zero.

### Co robimy w tym ADR
- Decyzja kierunku (3 patterny + 5 sugerowanych polityk dla legal AI kancelarii, adaptowane na PL realia).
- Mapping na Konstytucje (Art. 1/3/4/5/8).
- Zarys schematu eventu `policy_verdict` w audit log.

### Czego NIE robimy w tym ADR (osobne ADR-y implementacyjne)
- **NIE wpinamy ICME jako HTTP client**. To rozwiazanie cloud-only, lamie Art. 1 + Art. 5 wprost (matter/action wysylane do US bez DPA + bez EU region).
- **NIE adoptujemy `preflight-mike` patcha (MIT)**. Patch zawiera HTTP klienta `backend/lib/preflight.ts` ktory dzwoni `api.icme.io`. Jako patch jest "drop-in", ale dla Patrona to jednoznacznie zakazane (Art. 1).
- **NIE adoptujemy x402 USDC payment** ($0.10/check via Base) - kancelaria polska nie placi w stablecoin za walidacje swojej polityki AI.
- **NIE bierzemy `zk_proof_id` i jolt-atlas zkVM**. Nasz audit hash-chain SHA256 (ADR-0001) + planowany Merkle (ADR-0026) jest wystarczajacy dla regulatorow polskich. zkVM zostaje na watch list jako narzedzie na przyszlosc (gdyby pojawila sie potrzeba "zero-knowledge proof of policy compliance" - obecnie nie ma takiej regulacji wymagajacej tego).
- **NIE wybieramy konkretnego solvera** w tym ADR. Z3 (MIT, microsoft research) jest najpopularniejszy, ale minizinc / cvc5 sa rownorzedne. Decyzja techniczna w ADR implementacyjnym (rezerwacja: ADR-0032 implementacyjny).
- **NIE adoptujemy "ZK proof verification" endpointu** ICME (`/v1/verifyProof`, `/v1/proof/{id}`, `/v1/proof/{id}/download`) - kazdy z nich jest cloud-only.

---

## Kontekst

### Co rozpoznano we wzorze

[ICME-Lab/icme-preflight-guardrail](https://github.com/ICME-Lab/icme-preflight-guardrail) (MIT, snapshot 2026-05-24, push 2026-04-01, 1 star) i [hshadab/preflight-mike](https://github.com/hshadab/preflight-mike) (MIT, push 2026-05-24, drop-in patch dla Mike). Autor: Houman Shadab (ICME Labs, Stanford CodeX Fellow). Pattern: **Plain English -> SMT-LIB compilation -> lokalny solver -> proof receipt -> public re-verifier offline**. Cytat z dokumentacji: "Enforcement has to be deterministic. A guardrail that sometimes fires and sometimes doesn't is worse than none, because it produces a paper trail of inconsistent rule application."

To strategicznie wazne dla MateMatic:
1. **Trzeci gracz swiatowy w niszy Mike-ekosystemu**. Will Chen (MikeOSS, baza forka Patrona) + Microsoft AGT (ADR-0024) + ICME Preflight = trzy niezalezne stacki idace ta sama droga. Walidacja kierunku.
2. **Argument sprzedazowy dla matematic-konstytucja-ai**: branza 2026 idzie w deterministyczna walidacje, my robimy to **lokalnie/offline** vs ich chmurowo. Konkurencyjny differentiator dla kancelarii polskich.
3. **Pattern dojrzaly architektonicznie**. Nasza dotychczasowa audit hash-chain (ADR-0001) + Merkle (ADR-0026) byly o **integralnosci historii**. ICME pattern dodaje **dowod kazdej pojedynczej decyzji**. Komplementarne.

### Dlaczego nie pelne wpiecie

- **Cloud-only, brak self-host**. `api.icme.io/v1/{checkLogic,checkRelevance,checkIt,verifyPaid}` - wszystkie cloud-only. Nawet "free" checkLogic wysyla `reasoning` text (moze zawierac matter info) do US.
- **Brak EU region**. Dokumentacja nie wspomina o EU hostingu. Tylko "EU AI Act alignment" w compliance materials.
- **Brak DPA template**. Kancelaria polska musialaby negocjowac DPA z ICME indywidualnie + uzyskac decyzje Administratora kancelarii o transferze poza EOG (DPF/SCC).
- **Policy text jest workproduct ICME**. Kompilacja polityki dzieje sie u nich; Patron-kancelaria nie ma kodu kompilatora. To filozoficznie sprzeczne z naszą teza "kancelaria pisze wlasną Konstytucję AI".
- **`Private Venice tier` "zero data retention contractually"**. To umowna gwarancja, nie techniczna. Polega na zaufaniu do ICME ze nie utrzymuja danych.

### Wzorzec policy iteration (cherry-pick gold)

ICME dokumentuje **4-stopniowy iterator polityki**:
1. `GET /v1/policy/{id}/scenarios` - auto-generated test scenarios sortowane wedlug "likelihood of being wrong"
2. `POST /v1/submitScenarioFeedback` - approve/reject scenarios z annotations
3. `POST /v1/refinePolicy` - apply queued corrections w jednym rebuild (policy_id stays the same)
4. `POST /v1/runPolicyTests` - run all saved test cases against compiled policy

To **unit tests dla polityk**. Polityka traktowana jak kod - kompilowana, testowana, refaktorowana. Kancelaria nie publikuje polityki AI ad-hoc; iteruje az pokrycie scenariuszy jest wystarczajace. Adaptacja lokalna: `patron-policy-test` CLI + biblioteka generujaca scenariusze testowe lokalnie.

---

## Alternatywy rozwazane

**A. Wpiecie ICME jako external dependency** (drop-in patch `preflight-mike`)
- Odrzucone z 4 powodow (cloud-only, brak EU/DPA, policy = ICME workproduct, Art. 1 Konstytucji).

**B. Cherry-pick wszystkich 9 patternow** (3 powyzej + 5 polityk + iterator + UI badge + middleware modes + DB schema)
- Odrzucone - przeskalowane na 1 sprint. Wybieramy 3 najwazniejsze patterny + 5 sugerowanych polityk (osobno do matematic-konstytucja-ai SKILL).

**C. Cherry-pick tylko 1 patternu (SMT-LIB compilation)** - sam solver, bez proof receipt
- Odrzucone - zbyt waskie. Bez proof receipt nie mamy audytowalnosci kazdej decyzji.

**D. Cherry-pick 3 patternow (przyjete)** - SMT-LIB + proof receipt + offline verifier
- Pelne pokrycie value-prop ICME, bez zaleznosci cloud. Each pattern ma osobny ADR implementacyjny w przyszlosci.

---

## Konsekwencje

### Pozytywne
- **Deterministyczna walidacja** decyzji Patrona (komplementarna do LLM-based, ktore z natury probabilistyczne).
- **Proof receipt per decyzja** = silniejszy dowod nalezytej starannosci dla AI Act art. 26 niz sama hash-chain integralnosc.
- **Lokalny verifier offline** = unikalny argument sprzedazowy dla kancelarii polskich (vs ICME ktorzy cloud).
- **5 sugerowanych polityk legal AI** (no unauthorized advice / privilege / PII / citation / escalation) idzie do `matematic-konstytucja-ai` jako template gold - sprzedaz Konstytucji wzbogacona o gotowe regule.
- **Iterator polityki** (scenarios -> feedback -> refine -> tests) - pattern "polityka jako kod" do skilla Konstytucji.

### Negatywne / kosztowe
- **Wybor solvera** = decyzja techniczna z konsekwencjami licencyjnymi/operacyjnymi. Z3 (MIT) najprostszy, ale Patron jest TS - binding TS dla Z3 jest mniej dojrzaly niz Python. Mozliwe rozwiazania: child process Z3 binary (Node `spawn`), WASM Z3, lub przesuniecie tej warstwy do Python sidecar.
- **Powierzchnia do utrzymania**: ~2000-4000 LoC dla SMT-LIB compilation + verifier + iterator. Wieksza niz mcp-security (ADR-0025, ~800 LoC).
- **UI badge w frontend** wymaga decyzji designu (gdzie pokazywac "verified" pill, jak wskazywac UNSAT z kontekstem dla Operatora).
- **Wewnetrzny vocabular policy** - kancelaria musi nauczyc sie pisac polityki w "plain English/Polish" + zrozumiec SAT/UNSAT. Materialy szkoleniowe do Playbooku.

### Bramki przed implementacja (przyszly ADR-0032 implementacyjny)
- **Wybor solvera + binding TS/Node** (Z3 vs minizinc vs cvc5; child process vs WASM vs sidecar).
- **DB schema dla proof receipt** (nowe kolumny w `audit_events` lub osobna tabela `policy_verdicts`).
- **CLI tool `patron-verify`** dla regulatora (Node binary z embedded solver, weryfikuje `proofs.tar.gz` offline).
- **UI badge "verified"** + UNSAT explanation flow.
- 2x runda wewnetrznego review tresci przed merge.
- Testy: kazdy modul (compiler, solver, verifier, iterator) z testem przed wpieciem do prod path.

---

## Atrybucja

Patterny (SMT-LIB compilation, proof receipt z policy_hash, offline verifier, policy iteration z scenarios) cherry-picked z:
- [ICME-Lab/icme-preflight-guardrail](https://github.com/ICME-Lab/icme-preflight-guardrail) (MIT, ICME Labs, snapshot 2026-05-24, push 2026-04-01)
- [hshadab/preflight-mike](https://github.com/hshadab/preflight-mike) (MIT, Houman Shadab, snapshot 2026-05-24, push 2026-05-24)
- Dokumentacja [docs.icme.io](https://docs.icme.io) (publiczna)
- Wzmianka inspiracji: AWS Automated Reasoning (billion SMT queries/day dla IAM policies) - publiczne, niekomercyjne

Patron pisze kod od zera w TypeScript pod Node 20+ / vitest / TS strict, zero zaleznosci od ICME API. Wybor solvera (Z3 / minizinc / cvc5) w osobnym ADR-0032 implementacyjnym. Wzorzec 5-fazowy + 4 stany akcji wziete z naszego wlasnego `input-security` (ADR-0019) + `mcp-security` (ADR-0025).

Pelna atrybucja: [THIRD_PARTY_INSPIRATIONS.md sekcja ICME Preflight](../../THIRD_PARTY_INSPIRATIONS.md).
