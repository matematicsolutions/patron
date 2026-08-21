// Jedno zrodlo adresu backendu dla CALEGO frontendu.
//
// Powod istnienia (zmierzone 2026-08-21 na uruchomionym stacku): trzy hooki
// governance - useEgressConfig, useMcpSecurityStatus, usePackUpdates - wolaly
// sciezki WZGLEDNE ("/api/config/egress"). Frontend stoi na porcie 3000, backend
// na 3001, a next.config.ts nie ma proxy na /api/* i front nie ma wlasnych tras
// API. Efekt: 404 z originu frontendu, hook zwracal null, a baner NIE renderowal
// sie wcale. Trzy powierzchnie zgodnosciowe byly martwe w spakowanej aplikacji:
//   - EgressConfigBanner  (ADR-0101: widoczna zgoda Operatora na egress),
//   - McpSecurityBanner   (ADR-0025/0028: decyzje bramki konektorow),
//   - PackUpdateBanner    (ADR-0140).
//
// Najgorsze bylo to, ze awaria WYGLADALA jak projekt: komentarz w hooku mowi
// "Network / 5xx -> config null (fail-closed, banner sie nie renderuje)", wiec
// brak banera czytalo sie jako "wszystko w porzadku", a nie jako "nie wiem".
// Klasyczna cicha niekompletnosc - sukces (exit 0, brak bledu) przy braku danych.
//
// Regula: zaden fetch do backendu nie uzywa sciezki wzglednej. Pilnuje tego
// test `no-relative-api.test.ts`.

export const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/** Buduje pelny adres endpointu backendu. `path` zaczyna sie od "/". */
export function apiUrl(path: string): string {
    return `${API_BASE}${path}`;
}
