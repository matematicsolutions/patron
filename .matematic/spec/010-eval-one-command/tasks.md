# Tasks: Eval jedna komenda

- [x] T001 [US1] scripts/run-eval.cjs (orkiestrator 3 etapow, capability-detection, raport md+json)
- [x] T002 [US1] .gitignore: eval-report/
- [x] T003 [US2] .github/workflows/eval.yml (workflow_dispatch + artefakt)
- [x] T004 Smoke lokalny: Etap A realnie przechodzi, raport powstaje; commit

# Plan (skrot - pelny kontekst w spec.md)

Project type: web-app tooling. Zero nowych zaleznosci (node stdlib + istniejace
vitest/tsx/python). Constitution Check: PASS (narzedzie lokalne, zero egress poza
opcjonalnym fetch seeds HF w harnessie; raport bez danych klienta; nie zmienia
zachowania produktu). Sciezka harnessa: env PATRON_EVAL_HARNESS_DIR, default
C:/Users/Wieslaw/Projects/legal-eval-harness (maszyna WM) lub ../legal-eval-harness.
