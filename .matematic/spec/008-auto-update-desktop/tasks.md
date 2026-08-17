# Tasks: Auto-update desktop

## Phase 2 - Foundational
- [x] T001 desktop/package.json: dependency electron-updater + build.publish (github)
- [x] T002 npm install w desktop/ (lockfile)

## Phase 3 - US1
- [x] T010 [US1] main.js: setupAutoUpdate() - kanal per locale, autoDownload, dialog restart, kill-switch PATRON_AUTO_UPDATE=off, wpiecie w whenReady
- [x] T011 [US1] scripts build/build:dir/build-locale: --publish=never na sztywno

## Phase 4 - US2
- [x] T020 [US2] build-locale.cjs: latest[-xx].yml (patch URL na kanoniczna nazwe) + kopiowanie .blockmap

## Phase 5 - Polish
- [x] T030 Runbook wydania w spec.md; commit
