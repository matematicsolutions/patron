// Mapa pseudonimow token <-> oryginal.
//
// Skeleton uzywa wylacznie struktur in-memory. Docelowo Postgres
// adapter zapisujacy do tabeli `pseudonim_map(map_id uuid, token text,
// category text, original text, created_at timestamptz, expires_at timestamptz)`
// z TTL i RODO art. 17 (kasowanie na zadanie) - tydzien 3-5 planu
// migracji w ADR-0003.

import type {
    PiiCategory,
    PseudonimMap,
    PseudonimStore,
    PseudonimToken,
} from "./types";

/**
 * Tworzy pusta mape. Zawsze przez fabryke, nie konstruktor literalnie
 * (zapewnia Map() jest swiezy).
 */
export function createPseudonimMap(): PseudonimMap {
    return {
        tokens: [],
        byToken: new Map(),
        byOriginal: new Map(),
    };
}

/**
 * Dodaje pseudonim do mapy. Jezeli `original` juz istnieje w mapie,
 * zwraca istniejacy token (deduplikacja - drugie wystapienie tej samej
 * osoby w dokumencie dostaje ten sam token).
 */
export function addPseudonim(
    map: PseudonimMap,
    category: PiiCategory,
    original: string,
): PseudonimToken {
    const existing = map.byOriginal.get(original);
    if (existing) {
        return map.byToken.get(existing)!;
    }
    const index = countByCategory(map, category) + 1;
    const token = `[${category}_${index}]`;
    const entry: PseudonimToken = { token, category, original };
    map.tokens.push(entry);
    map.byToken.set(token, entry);
    map.byOriginal.set(original, token);
    return entry;
}

/**
 * Liczy ile pseudonimow danej kategorii juz jest w mapie. Wykorzystywane
 * do generowania sekwencyjnego indeksu w `addPseudonim`.
 */
function countByCategory(map: PseudonimMap, category: PiiCategory): number {
    let n = 0;
    for (const t of map.tokens) {
        if (t.category === category) n++;
    }
    return n;
}

/**
 * Resolve token na oryginal. Zwraca undefined gdy token nieznany -
 * `unwrap()` w `wrap.ts` decyduje co z tym zrobic (zostawia token
 * w outputcie = bezpieczne; alternatywnie rzuca blad = strict mode).
 */
export function resolveToken(map: PseudonimMap, token: string): string | undefined {
    return map.byToken.get(token)?.original;
}

/**
 * In-memory implementacja `PseudonimStore` - do testow i sesji bez
 * persystencji. Trzyma mapy w `Map<mapId, PseudonimMap>`. Reset wymaga
 * konstrukcji nowej instancji.
 */
export class InMemoryPseudonimStore implements PseudonimStore {
    private readonly maps = new Map<string, PseudonimMap>();

    async save(mapId: string, map: PseudonimMap): Promise<void> {
        this.maps.set(mapId, map);
    }

    async load(mapId: string): Promise<PseudonimMap | null> {
        return this.maps.get(mapId) ?? null;
    }

    async delete(mapId: string): Promise<void> {
        this.maps.delete(mapId);
    }
}
