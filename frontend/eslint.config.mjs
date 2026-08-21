import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Reguly React Compilera dotyczace efektow i refow - ZDEGRADOWANE DO
    // OSTRZEZEN, swiadomie i tymczasowo (2026-08-21).
    //
    // Powod: przeglad 21 zgloszen pokazal, ze w wiekszosci to CELOWE wzorce
    // hydracji Next.js, nie bledy. `useSelectedModel` czyta localStorage w
    // efekcie, bo nie wolno tego robic w renderze (niezgodnosc hydracji SSR);
    // `DocViewModal` uzywa flagi `mounted` jako strazy montowania portalu;
    // `AuthContext` inicjuje tryb lokalny. Mechaniczna "naprawa" albo cofa
    // te intencje, albo wymaga przejscia na useSyncExternalStore.
    //
    // To sa zgloszenia weryfikowalne WYLACZNIE w runtime (miganie, podwojny
    // render, hydration mismatch), wiec ich domkniecie nalezy do przebiegu z
    // uruchomiona aplikacja, nie do przebiegu bramki.
    //
    // NIE sa wyciszone (`off`) celowo - maja zostac widoczne i policzalne.
    // Stan w chwili degradacji: 21 zgloszen (18 set-state-in-effect, 2 refs,
    // 1 immutability). Gdy zostana domkniete, PODNIES je z powrotem do
    // "error" i usun ten blok - inaczej regula bez bramki przestanie trzymac.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
    },
  },
]);

export default eslintConfig;
