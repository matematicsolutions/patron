import { describe, it, expect } from "vitest";
import { chunkLegalText } from "./legalChunker";
import { chunkText } from "./indexer";

describe("chunkLegalText - fallback do akapitow (zero regresji)", () => {
  it("dokument bez struktury prawniczej daje wynik identyczny z chunkText", () => {
    const plain =
      "To jest zwykla notatka ze spotkania.\n\n" +
      "Drugi akapit bez zadnych jednostek redakcyjnych ani sekcji wyroku.\n\n" +
      "Trzeci akapit, dalej proza, nic do wykrycia.";
    const viaLegal = chunkLegalText(plain);
    const viaPlain = chunkText(plain);
    expect(viaLegal).toEqual(viaPlain);
  });

  // Antyregresja na false-positive (ADR-0083 sekcja A). Notatka zawiera linie
  // zaczynajace sie pospolitymi slowami-naglowkami (Wniosek, Przeciwko,
  // Rozwazania, Ocena prawna, orzeka) - bez markera mocnego ani jednostki
  // redakcyjnej tryb prawniczy NIE aktywuje sie, wiec wynik MUSI byc identyczny
  // z chunkText. To jest test, ktorego brakowalo w pierwszej wersji ADR.
  it("notatka ze slabymi slowami-naglowkami daje wynik identyczny z chunkText", () => {
    const trap =
      "Wniosek: trzeba odpisac klientowi do piatku.\n\n" +
      "Przeciwko temu pomyslowi mam powazne obiekcje merytoryczne.\n\n" +
      "Rozwazania na temat dalszej strategii prowadzenia sprawy.\n\n" +
      "Ocena prawna sytuacji wymaga jeszcze analizy orzecznictwa.\n\n" +
      "orzeka sie potocznie, ze warto poczekac na stanowisko drugiej strony.";
    const viaLegal = chunkLegalText(trap);
    const viaPlain = chunkText(trap);
    expect(viaLegal).toEqual(viaPlain);
  });

  it("notatka z linia 'Wniosek:' i 'z powodztwa' bez markera mocnego = fallback", () => {
    const note =
      "Wniosek: spotkanie przelozone.\n\n" +
      "Sprawa z powodztwa Kowalskiego jest na etapie negocjacji.\n\n" +
      "Reszta tresci notatki bez numeracji.";
    expect(chunkLegalText(note)).toEqual(chunkText(note));
  });

  it("pusty tekst daje pusta liste (jak chunkText)", () => {
    expect(chunkLegalText("")).toEqual([]);
    expect(chunkLegalText("   \n\n  ")).toEqual([]);
  });

  it("sam bialy znak nie tworzy chunku", () => {
    expect(chunkLegalText("\r\n\t  \r\n")).toEqual([]);
  });
});

describe("chunkLegalText - ciecie po sekcjach wyroku", () => {
  const wyrok =
    "Sygn. akt I C 100/26\n\n" +
    "WYROK\n" +
    "W imieniu Rzeczypospolitej Polskiej\n\n" +
    "Sad ustalil nastepujacy stan faktyczny:\n" +
    "Powod zawarl z pozwanym umowe pozyczki w dniu 1 stycznia 2025 roku.\n\n" +
    "Sad zwazyl, co nastepuje:\n" +
    "Powodztwo zasluguje na uwzglednienie w calosci.\n\n" +
    "Rozstrzygniecie:\n" +
    "Sad zasadza od pozwanego na rzecz powoda kwote 10000 zlotych.";

  it("tnie wyrok na osobne chunki wg granic sekcji", () => {
    const chunks = chunkLegalText(wyrok);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it("ustalenia faktyczne i ocena prawna nie laduja w jednym chunku", () => {
    const chunks = chunkLegalText(wyrok);
    const faktyczny = chunks.find((c) => c.content.includes("umowe pozyczki"));
    const ocena = chunks.find((c) =>
      c.content.includes("zasluguje na uwzglednienie"),
    );
    expect(faktyczny).toBeDefined();
    expect(ocena).toBeDefined();
    expect(faktyczny!.index).not.toBe(ocena!.index);
  });

  it("indeksy sa kolejne od zera", () => {
    const chunks = chunkLegalText(wyrok);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });

  // Wariant "Sad ustalil nastepujacy ..." musi byc rozpoznany (poprzednia
  // wersja miala martwy wzorzec "ustalt?l?", ktory tego nie lapal).
  it("rozpoznaje wariant 'Sad ustalil nastepujacy stan faktyczny'", () => {
    const txt =
      "WYROK\n\n" +
      "Sad ustalil nastepujacy stan faktyczny:\n" +
      "Fakt pierwszy istotny dla sprawy.\n\n" +
      "Sad zwazyl, co nastepuje:\n" +
      "Wniosek koncowy.";
    const chunks = chunkLegalText(txt);
    const fakt = chunks.find((c) => c.content.includes("Fakt pierwszy"));
    const ocena = chunks.find((c) => c.content.includes("Wniosek koncowy"));
    expect(fakt).toBeDefined();
    expect(ocena).toBeDefined();
    expect(fakt!.index).not.toBe(ocena!.index);
  });

  // OCR ASCII: komparycja "z powodztwa" bez diakrytyk, wewnatrz dokumentu
  // prawniczego (jest marker mocny WYROK), musi byc granica.
  it("rozpoznaje komparycje 'z powodztwa' po OCR ASCII w dokumencie prawniczym", () => {
    const txt =
      "WYROK\n\n" +
      "z powodztwa Jana Kowalskiego\n\n" +
      "Sad zwazyl, co nastepuje:\n" +
      "Apelacja jest zasadna.";
    const chunks = chunkLegalText(txt);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const komparycja = chunks.find((c) => c.content.includes("Jana Kowalskiego"));
    const ocena = chunks.find((c) => c.content.includes("Apelacja jest zasadna"));
    expect(komparycja).toBeDefined();
    expect(ocena).toBeDefined();
    expect(komparycja!.index).not.toBe(ocena!.index);
  });
});

describe("chunkLegalText - ciecie po jednostkach redakcyjnych", () => {
  const akt =
    "Art. 1\nUstawa reguluje zasady ochrony danych.\n\n" +
    "Art. 2\nIlekroc w ustawie mowa o administratorze, rozumie sie przez to podmiot.\n\n" +
    "Art. 3\nPrzepisy stosuje sie odpowiednio do podmiotow przetwarzajacych.";

  it("kazdy artykul zaczyna nowy chunk", () => {
    const chunks = chunkLegalText(akt);
    const a1 = chunks.find((c) => c.content.includes("ochrony danych"));
    const a2 = chunks.find((c) => c.content.includes("administratorze"));
    const a3 = chunks.find((c) =>
      c.content.includes("podmiotow przetwarzajacych"),
    );
    expect(a1).toBeDefined();
    expect(a2).toBeDefined();
    expect(a3).toBeDefined();
    expect(new Set([a1!.index, a2!.index, a3!.index]).size).toBe(3);
  });

  it("rozpoznaje znak paragrafu i ustep (jednostka aktywuje tryb prawniczy)", () => {
    const txt = "§ 1\nPostanowienia ogolne umowy.\n\nust. 2\nDrugi ustep tresci.";
    const chunks = chunkLegalText(txt);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

describe("chunkLegalText - limit rozmiaru (dlugi blok -> chunkText)", () => {
  it("dluga sekcja jest dzielona do maxChars przez fallback akapitowy", () => {
    const longBody = Array.from(
      { length: 60 },
      (_, i) =>
        `Zdanie numer ${i} w bardzo dlugiej sekcji ustalen faktycznych sadu okregowego.`,
    ).join(" ");
    const wyrok = `Sad ustalil nastepujacy stan faktyczny:\n${longBody}`;
    const chunks = chunkLegalText(wyrok, { maxChars: 300 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(300);
    }
  });
});

describe("chunkLegalText - determinizm (Konstytucja Art. 3)", () => {
  const sample =
    "Sygn. akt II Ca 50/26\n\n" +
    "Sad zwazyl, co nastepuje:\n" +
    "Apelacja okazala sie zasadna.\n\n" +
    "Art. 233\nSad ocenia wiarygodnosc dowodow wedlug wlasnego przekonania.";

  it("dwa wywolania daja identyczny wynik (swieze wzorce, brak flagi g)", () => {
    const a = chunkLegalText(sample);
    const b = chunkLegalText(sample);
    expect(a).toEqual(b);
  });

  it("trzecie wywolanie nadal identyczne (brak wspoldzielonego stanu)", () => {
    const a = chunkLegalText(sample);
    chunkLegalText(sample);
    const c = chunkLegalText(sample);
    expect(c).toEqual(a);
  });
});

describe("chunkLegalText - inwariant niepustosci chunkow", () => {
  it("zaden chunk nie jest pusty ani sam z bialych znakow", () => {
    const wyrok =
      "Sygn. akt I C 1/26\n\nUZASADNIENIE\n\nSad ustalil nastepujacy stan faktyczny:\n" +
      "Fakt jeden.\n\nSad zwazyl, co nastepuje:\nWniosek koncowy.";
    const chunks = chunkLegalText(wyrok);
    for (const c of chunks) {
      expect(c.content.trim().length).toBeGreaterThan(0);
    }
  });
});