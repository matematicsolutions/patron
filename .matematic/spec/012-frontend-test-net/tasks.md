# Tasks: Siatka testow frontendu

- [x] T001 devDeps: vitest, jsdom, @testing-library/react, @vitejs/plugin-react; vitest.config.ts; script "test"
- [x] T002 [P] [US2] src/i18n/i18n.test.ts (parytet kluczy + tabular.review* x6)
- [x] T003 [P] [US1] src/app/components/tabular/TabularCell.test.tsx
- [x] T004 [P] [US1] src/app/components/tabular/TRSidePanel.test.tsx (mock DocView/DocxView)
- [x] T005 npm test zielone + tsc --noEmit zielone; commit

# Plan (skrot)

Project type: web-app. Constitution Check: PASS (dev-only deps MIT; zero wplywu
na runtime produktu; bramka jakosci w gore). Zaleznosci: 4 devDeps (vitest,
jsdom, @testing-library/react ^16 dla React 19, @vitejs/plugin-react).
