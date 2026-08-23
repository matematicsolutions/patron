// Filtr dat viewera audytora: pola <input type="datetime-local"> mowia czasem
// LOKALNYM, a filtr trzyma UTC. Zmierzone 2026-08-23 na wydaniu 1.2.0: wpisane
// 18:30 wracalo na ekran jako 16:30, bo odczyt robil `.slice(0, 16)` wprost na
// UTC. Zapis byl poprawny - niesymetryczny byl odczyt.
//
// W narzedziu, ktorego jedynym zadaniem jest wierność zapisu, cicha zmiana okna
// filtrowania jest defektem merytorycznym: audytor prosi o "od 09:00", dostaje
// inne okno i nie ma jak tego zauwazyc.
import { describe, expect, it } from "vitest";
import {
    utcNaLokalneDlaInputu,
    utcNaLokalneZOffsetem,
} from "./audit-filter-bar";

describe("filtr audytu - konwersja UTC <-> pole datetime-local", () => {
    // Offset podajemy JAWNIE, bo test zwiazany ze strefa maszyny nie ma czego
    // sprawdzic w CI: pod UTC stary odczyt (`.slice(0, 16)` wprost) i nowy daja
    // ten sam wynik, wiec asercja przechodzilaby z niewlasciwego powodu.
    // Konwencja jak w getTimezoneOffset: UTC minus lokalny.
    it.each([
        { strefa: "Warszawa latem (UTC+2)", offsetMin: -120, oczekiwane: "2026-08-22T18:30" },
        { strefa: "Warszawa zima (UTC+1)", offsetMin: -60, oczekiwane: "2026-08-22T17:30" },
        { strefa: "Nowy Jork (UTC-5)", offsetMin: 300, oczekiwane: "2026-08-22T11:30" },
        { strefa: "UTC", offsetMin: 0, oczekiwane: "2026-08-22T16:30" },
    ])("$strefa: 16:30 UTC pokazuje sie jako $oczekiwane", ({ offsetMin, oczekiwane }) => {
        expect(utcNaLokalneZOffsetem("2026-08-22T16:30:00.000Z", offsetMin)).toBe(
            oczekiwane,
        );
    });

    // Kontrola na ZNANYM-ZLYM: tak liczyl odczyt przed poprawka. Poza UTC musi
    // dawac inny wynik niz poprawna konwersja, inaczej test niczego nie pilnuje.
    it("stary odczyt (surowy UTC) rozni sie od poprawnego wszedzie poza UTC", () => {
        const utc = "2026-08-22T16:30:00.000Z";
        const staryOdczyt = utc.slice(0, 16);
        expect(utcNaLokalneZOffsetem(utc, -120)).not.toBe(staryOdczyt);
        expect(utcNaLokalneZOffsetem(utc, 300)).not.toBe(staryOdczyt);
        expect(utcNaLokalneZOffsetem(utc, 0)).toBe(staryOdczyt);
    });

    it("uzywa offsetu maszyny, gdy nie podano go wprost", () => {
        const utc = "2026-08-22T16:30:00.000Z";
        expect(utcNaLokalneDlaInputu(utc)).toBe(
            utcNaLokalneZOffsetem(utc, new Date(utc).getTimezoneOffset()),
        );
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
