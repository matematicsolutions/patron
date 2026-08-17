// Rozwiazanie krawedzi dokument->dokument w grafie cytowan (audyt P2 #11).
//
// Problem: extractor zawsze ustawia toDocId=null (przy ekstrakcji nie wiadomo,
// czy cytowana encja ma swoj dokument w korpusie). Kolumna citation_graph.to_doc_id
// byla wiec faktycznie martwa - powiazanie dokument->dokument liczono dopiero
// przy zapytaniu (centralnosc po wspolnej value_normalized, retrieval.ts), co nie
// pozwala odpowiedziec "pokaz dokument, ktory CYTUJE wyrok bedacy dokumentem Y".
//
// Rozwiazanie (deterministyczne, zero LLM - Konstytucja Art. 3): krawedz cytowania
// celuje w encje w dokumencie CYTUJACYM (to_entity_id), ktorej value_normalized to
// cytowana sygnatura V. "Dokument, ktory NIA JEST" = INNY dokument korpusu z encja
// o tym samym (typ, value_normalized). Ustawiamy to_doc_id TYLKO gdy taki dokument
// jest DOKLADNIE JEDEN (jednoznacznosc). Gdy zero albo wielu (np. encja generyczna
// "Sad Najwyzszy" wspoldzielona przez wiele akt) -> zostaje null; centralnosc
// query-time i tak to obsluguje. Ograniczone do sygnatur (orzeczen / aktow) - tam
// "dokument bedacy cytowana sygnatura" ma sens.
//
// Idempotentne: przelicza od nowa (set albo null), wiec bezpieczne do wielokrotnego
// wywolania i odporne na zmiany korpusu (nowy dokument staje sie wlascicielem
// sygnatury cytowanej przez starsze dokumenty).

import { getDb } from "../db/sqlite-connection";

const SIGNATURE_TYPES = ["SYGNATURA_ORZECZENIA", "SYGNATURA_AKTU"] as const;

/**
 * Przelicza citation_graph.to_doc_id dla krawedzi cytowania sygnatur. Zwraca
 * liczbe krawedzi z rozwiazanym (niepustym) to_doc_id po przebiegu.
 */
export function resolveToDocLinks(db = getDb()): number {
    const typePlaceholders = SIGNATURE_TYPES.map(() => "?").join(",");
    const edges = db
        .prepare(
            `select cg.id as edgeId,
                    cg.from_doc_id as fromDoc,
                    e.entity_type as etype,
                    e.value_normalized as vn
             from citation_graph cg
             join extracted_entities e on e.id = cg.to_entity_id
             where cg.to_entity_id is not null
               and e.entity_type in (${typePlaceholders})`,
        )
        .all(...SIGNATURE_TYPES) as {
        edgeId: string;
        fromDoc: string;
        etype: string;
        vn: string;
    }[];

    const findOwners = db.prepare(
        `select distinct document_id
         from extracted_entities
         where entity_type = ? and value_normalized = ? and document_id != ?`,
    );
    const setTarget = db.prepare(
        "update citation_graph set to_doc_id = ? where id = ?",
    );
    const clearTarget = db.prepare(
        "update citation_graph set to_doc_id = null where id = ?",
    );

    let resolved = 0;
    const tx = db.transaction(() => {
        for (const e of edges) {
            const owners = findOwners.all(e.etype, e.vn, e.fromDoc) as {
                document_id: string;
            }[];
            if (owners.length === 1) {
                setTarget.run(owners[0]!.document_id, e.edgeId);
                resolved++;
            } else {
                // zero albo niejednoznacznie wielu -> nie zgaduj
                clearTarget.run(e.edgeId);
            }
        }
    });
    tx();
    return resolved;
}
