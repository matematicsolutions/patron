// Filtr dat viewera audytora: pola <input type="datetime-local"> mowia czasem
// LOKALNYM, a filtr trzyma UTC. Zmierzone 2026-08-23 na wydaniu 1.2.0: wpisane
// 18:30 wracalo na ekran jako 16:30, bo odczyt robil `.slice(0, 16)` wprost na
// UTC. Zapis byl poprawny - niesymetryczny byl odczyt.
//
// W narzedziu, ktorego jedynym zadaniem jest wierność zapisu, cicha zmiana okna
// filtrowania jest defektem merytorycznym: audytor prosi o "od 09:00", dostaje
// inne okno i nie ma jak tego zauwazyc.
import { describe, expect, it } from "vitest";
import { utcNaLokalneDlaInputu } from "./audit-filter-bar";

describe("filtr audytu - konwersja UTC <-> pole datetime-local", () => {
    // UWAGA: w strefie UTC stara i nowa implementacja daja TO SAMO, wiec test
    // porownujacy godzine z litera przechodzilby w CI z niewlasciwego powodu.
    // Dlatego asercja jest zwiazana z OFFSETEM, nie z konkretna godzina.
    it("odsuwa wyswietlany czas dokladnie o offset strefy", () => {
        const utc = "2026-08-22T16:30:00.000Z";
        const wynik = utcNaLokalneDlaInputu(utc);
        const surowyUtc = utc.slice(0, 16);
        const offsetMin = -new Date(utc).getTimezoneOffset();
        const roznicaMin =
            (new Date(`${wynik}:00.000Z`).getTime() -
                new Date(`${surowyUtc}:00.000Z`).getTime()) /
            60000;
        expect(roznicaMin).toBe(offsetMin);
        if (offsetMin !== 0) expect(wynik).not.toBe(surowyUtc);
    });

    it("obieg tam i z powrotem wraca do tej samej chwili", () => {
        // to robi onChange w komponencie: wartosc pola -> UTC
        const utc = "2026-01-15T07:05:00.000Z";
        const wPolu = utcNaLokalneDlaInputu(utc);
        const zPowrotem = new Date(wPolu).toISOString();
        expect(new Date(zPowrotem).getTime()).toBe(new Date(utc).getTime());
    });

    it("nie wywraca sie na niepoprawnej dacie", () => {
        expect(utcNaLokalneDlaInputu("bez sensu")).toBe("");
    });
});
