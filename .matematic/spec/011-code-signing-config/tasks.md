# Tasks: Code signing config

- [x] T001 [US1] build-locale.cjs: maybeSign() po rename + regeneracja sha512/size w yml + blockmap (app-builder)
- [x] T002 [US2] governance/runbooks/code-signing.md
- [x] T003 node --check; commit; wpis B5 w trackerze (config gotowy)

# Plan (skrot)

Project type: desktop-app tooling. Zero nowych zaleznosci (app-builder-bin juz
w node_modules electron-buildera; signtool z Windows SDK u WM). Constitution
Check: PASS (podpis = integralnosc artefaktu dla klienta; klucz prywatny nigdy
w repo/CI; fail-loud przy niekompletnym env).
