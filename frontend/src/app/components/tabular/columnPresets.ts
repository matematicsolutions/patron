import type { ColumnFormat } from "../shared/types";

export interface ColumnPreset {
    name: string;
    matches: RegExp;
    prompt: string;
    format: ColumnFormat;
    tags?: string[];
}

// ADR-0081: presety kolumn tabular review dostrojone do polskiej praktyki
// prawnej. Mechanizm dopasowania (getPresetConfig) jest odziedziczony z
// isaacus/tabular-review przez willchen96/mike; wartoscia jest tu jurysdykcja -
// nazwy, prompty i wzorce dopasowania pisane pod polskie umowy i Due Diligence,
// nie pod common law. Regexy `matches` toleruja zarowno polskie znaki, jak i
// wersje bez ogonkow (uzytkownik moze wpisac "poufnosc" albo "poufnosc").
export const PROMPT_PRESETS: ColumnPreset[] = [
    {
        name: "Strony umowy",
        matches: /\bstron[ay]\b|strony umowy/i,
        format: "bulleted_list",
        prompt: 'Wymień wszystkie strony umowy. Dla każdej strony podaj pełną firmę lub imię i nazwisko, formę prawną, numer KRS lub NIP jeśli wskazano, oraz rolę zdefiniowaną w umowie, np.:\n• ABC sp. z o.o., KRS 0000123456 ("Zleceniodawca")\n• Jan Kowalski ("Wykonawca")\nJedna strona na punkt, bez dodatkowego komentarza.',
    },
    {
        name: "Prawo właściwe",
        matches: /prawo w[lł]a[sś]ciw|prawu w[lł]a[sś]ciw/i,
        format: "text",
        prompt: 'Podaj wyłącznie prawo właściwe dla umowy, w skróconej formie, np. "prawo polskie", "prawo niemieckie". Bez innego tekstu.',
    },
    {
        name: "Właściwość sądu",
        matches: /w[lł]a[sś]ciwo[sś][cć] s[aą]du|s[aą]d w[lł]a[sś]ciw|zapis na s[aą]d/i,
        format: "text",
        prompt: "Wskaż sąd właściwy do rozstrzygania sporów albo zapis na sąd polubowny (arbitraż). Podaj nazwę sądu lub instytucji arbitrażowej i siedzibę. Jeśli brak postanowienia, napisz \"Nie wskazano\".",
    },
    {
        name: "Data zawarcia",
        matches: /data zawarcia|data wej[sś]cia|wej[sś]cie w [zż]ycie/i,
        format: "date",
        prompt: 'Podaj wyłącznie datę zawarcia lub wejścia w życie umowy w formacie DD miesiąc RRRR, np. "2 stycznia 2026". Jeśli nie wskazano wprost, napisz "Nie wskazano".',
    },
    {
        name: "Okres obowiązywania",
        matches: /okres obowi[aą]zywania|czas trwania|termin obowi[aą]zywania/i,
        format: "text",
        prompt: 'Podaj czas trwania lub okres obowiązywania umowy w zwięzłej formie, np. "3 lata", "24 miesiące", "czas nieoznaczony". Bez innego tekstu.',
    },
    {
        name: "Wypowiedzenie",
        matches: /wypowiedz|rozwi[aą]zanie umowy/i,
        format: "text",
        prompt: "Wyodrębnij postanowienia o wypowiedzeniu i rozwiązaniu umowy. Podaj kto może wypowiedzieć, przesłanki, okres wypowiedzenia, ewentualny termin na usunięcie naruszenia oraz kluczowe skutki rozwiązania. Zwięźle.",
    },
    {
        name: "Kara umowna",
        matches: /kar[ay] umown/i,
        format: "text",
        prompt: "Wyodrębnij zastrzeżone kary umowne: za jakie naruszenia, wysokość lub sposób wyliczenia, ewentualny limit, oraz czy zastrzeżono prawo dochodzenia odszkodowania przewyższającego karę umowną. Zwięźle.",
    },
    {
        name: "Ograniczenie odpowiedzialności",
        matches: /odpowiedzialno[sś][cć]|ograniczenie odpowiedzialno/i,
        format: "text",
        prompt: "Opisz postanowienia o odpowiedzialności: zakres, limity kwotowe, wyłączenia (np. szkody pośrednie, utracone korzyści) oraz wyjątki od ograniczeń (np. wina umyślna). Zwięźle.",
    },
    {
        name: "Poufność",
        matches: /poufno[sś][cć]|tajemnic|nda/i,
        format: "text",
        prompt: "Podsumuj obowiązki zachowania poufności: zakres informacji poufnych, dozwolone ujawnienia, ograniczenia korzystania, czas trwania oraz kluczowe wyłączenia.",
    },
    {
        name: "Zakaz konkurencji",
        matches: /zakaz konkurencji|konkurencj/i,
        format: "text",
        prompt: "Opisz postanowienia o zakazie konkurencji: zakres przedmiotowy i terytorialny, czas obowiązywania (w tym po zakończeniu umowy) oraz ewentualne odszkodowanie lub karę umowną za naruszenie.",
    },
    {
        name: "Ochrona danych (RODO)",
        matches: /\brodo\b|powierzeni|ochrona danych|przetwarzani[ae] danych/i,
        format: "text",
        prompt: "Ustal, czy zawarto umowę powierzenia przetwarzania danych osobowych (art. 28 RODO). Jeśli tak, podaj zakres i cel przetwarzania, zasady podpowierzenia oraz wskazane środki bezpieczeństwa. Jeśli brak, napisz \"Brak postanowień o powierzeniu\".",
    },
    {
        name: "Cesja praw",
        matches: /\bcesj|przeniesienie praw|przelew wierzytelno/i,
        format: "yes_no",
        prompt: "Czy przeniesienie praw lub obowiązków z umowy (cesja) jest dopuszczalne bez zgody drugiej strony?",
    },
    {
        name: "Zabezpieczenia",
        matches: /zabezpieczeni|weksel|por[eę]czeni|\bzastaw|hipotek|gwarancj/i,
        format: "bulleted_list",
        prompt: "Wymień wszystkie ustanowione zabezpieczenia wykonania umowy (np. weksel, poręczenie, zastaw, hipoteka, gwarancja bankowa, kaucja). Dla każdego podaj rodzaj i kluczowe parametry. Jeden punkt na zabezpieczenie.",
    },
    {
        name: "Wynagrodzenie i płatność",
        matches: /wynagrodzeni|p[lł]atno[sś][cć]|\bcena\b|op[lł]at[ay]/i,
        format: "text",
        prompt: 'Podaj kluczowe postanowienia o wynagrodzeniu i płatności: kwota, waluta, termin, np. "10 000 zł netto płatne w 14 dni od faktury". Odnotuj skutki opóźnienia w płatności (odsetki, kary).',
    },
    {
        name: "Siła wyższa",
        matches: /si[lł][aąyę] wy[zż]sz/i,
        format: "yes_no",
        prompt: "Czy umowa zawiera klauzulę siły wyższej?",
    },
    {
        name: "Zmiana umowy",
        matches: /zmiana umowy|zmian[ye] umowy|\baneks/i,
        format: "text",
        prompt: "Podsumuj postanowienia o zmianie umowy: w jakiej formie mogą być dokonywane zmiany (np. pisemna pod rygorem nieważności), kto musi wyrazić zgodę oraz inne wymogi formalne.",
    },
];

export function getPresetConfig(
    title: string,
): Pick<ColumnPreset, "prompt" | "format" | "tags"> | null {
    const trimmed = title.trim();
    if (!trimmed) return null;
    const preset = PROMPT_PRESETS.find(({ matches }) => matches.test(trimmed));
    if (!preset) return null;
    return { prompt: preset.prompt, format: preset.format, tags: preset.tags };
}

export function getPresetPrompt(title: string): string | null {
    return getPresetConfig(title)?.prompt ?? null;
}
