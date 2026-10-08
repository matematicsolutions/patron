// Tymczasowy identyfikator dla optymistycznego wiersza w UI (np. nowy folder, zanim
// odpowie serwer). Licznik w module, nie crypto.randomUUID: tamto dziala tylko w
// "bezpiecznym kontekscie" (HTTPS albo localhost), a Patron w trybie serwerowym bywa
// otwierany po zwyklym HTTP z adresu w sieci lokalnej - wtedy tworzenie folderu
// rzucalo bledem (przeglad 2026-10-08). Nie Date.now ani Math.random: linter
// (react-hooks/purity) i tak by je odrzucil. Unikalnosc w obrebie karty wystarcza -
// identyfikator zyje tylko do odpowiedzi serwera.

let licznik = 0;

export function nowyTymczasowyId(prefiks = "temp"): string {
    licznik += 1;
    return `${prefiks}-${licznik}`;
}
