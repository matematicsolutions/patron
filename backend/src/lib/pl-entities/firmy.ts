// Dalsze wystapienia nazwy spolki bez formy prawnej.
//
// "Termika Wschod sp. z o.o." wraca w pismie jako "Termika", "Termiki",
// "TERMIKA WSCHOD" - i wychodzila do modelu chmurowego otwartym tekstem, bo
// regula FIRMA wymaga formy prawnej. Maskujemy pelny rdzen nazwy i jego
// pierwszy czlon, takze w odmianie. Rzeczownik ogolny ("Centrum", "Apteka")
// jako pierwszy czlon NIE jest propagowany sam - inaczej "Centrum miasta"
// byloby firma.
//
// Wzorzec z matematic-anonimizacja-pl v0.6.0. Pomiar tam, na slepym zestawie
// dokumentow B2B: recall FIRMA 0,388 -> 0,600, kontrola negatywna 0/28.

import { rdzenie, zloz } from "./osoby";
import { LEGAL_FORM_ALT } from "./regex";

const MIN_RDZEN = 4;
const OGOLNE = new Set(["centrum", "galeria", "dom", "apteka", "drukarnia", "hurtownia", "pracownia",
    "zaklad", "zaklady", "przedsiebiorstwo", "biuro", "kancelaria", "fundacja", "stowarzyszenie",
    "spoldzielnia", "grupa", "firma", "sklep", "studio", "instytut", "fabryka", "uslugi", "transport",
    "logistyka", "systems", "polska", "poland", "handel", "serwis", "bank", "klinika", "szkola",
    "agencja", "wydawnictwo", "restauracja", "hotel", "oddzial", "zespol", "osrodek", "centrala",
    "przychodnia", "gabinet", "salon", "warsztat", "spolka", "zielony", "nowy", "stary", "wielki"]);

const FORMA_NA_KONCU = new RegExp(`[ \\t]+(?:${LEGAL_FORM_ALT})(?:[ \\t]+(?:${LEGAL_FORM_ALT}))?$`, "u");
const FRAZA_RE = /(?<![\p{L}\p{N}])[\p{Lu}\d][\p{L}\d-]*(?:[ \t]+[\p{Lu}\d][\p{L}\d-]*)*(?![\p{L}\p{N}])/gu;

/** Rdzen nazwy (bez formy prawnej) jako czlony zlozone; null gdy firma nie ma formy. */
function rdzenFirmy(span: string): string[] | null {
    const bez = span.replace(FORMA_NA_KONCU, "").replace(/[„”"]/g, "").trim();
    if (bez === span.trim() || !bez) return null;
    return bez.split(/[ \t]+/).filter(Boolean).map(zloz);
}

const pasujeOstatni = (slowo: string, c: string) =>
    slowo === c ||
    rdzenie(c).some(({ rdzen, koncowki }) => slowo.startsWith(rdzen) && koncowki.includes(slowo.slice(rdzen.length)));

/**
 * Unikalne frazy z tekstu, ktore sa dalszym wystapieniem nazwy firmy z `firmy`
 * (spany z forma prawna). Ostatni czlon moze byc odmieniony, poprzednie - dokladnie.
 */
export function propagujFirmy(text: string, firmy: readonly string[]): string[] {
    const wzorce: string[][] = [];
    for (const f of firmy) {
        const czlony = rdzenFirmy(f);
        if (!czlony) continue;
        if (!(czlony.length === 1 && OGOLNE.has(czlony[0]!))) wzorce.push(czlony);
        const pierwszy = czlony[0]!;
        if (czlony.length > 1 && !OGOLNE.has(pierwszy) && pierwszy.length >= MIN_RDZEN) wzorce.push([pierwszy]);
    }
    if (wzorce.length === 0) return [];
    const out = new Set<string>();
    for (const m of text.matchAll(FRAZA_RE)) {
        const slowa = [...m[0].matchAll(/[^ \t]+/g)];
        let znaleziono = false;
        for (let i = 0; i < slowa.length && !znaleziono; i++) {
            for (let j = Math.min(slowa.length, i + 4); j > i; j--) {
                const zl = slowa.slice(i, j).map((s) => zloz(s[0]));
                const trafia = wzorce.some((w) => w.length === zl.length &&
                    w.every((c, k) => (k < w.length - 1 ? zl[k] === c : pasujeOstatni(zl[k]!, c))));
                if (trafia) {
                    const s0 = m.index! + slowa[i]!.index!;
                    const s1 = m.index! + slowa[j - 1]!.index! + slowa[j - 1]![0].length;
                    out.add(text.slice(s0, s1));
                    znaleziono = true;
                    break;
                }
            }
        }
    }
    return [...out];
}
