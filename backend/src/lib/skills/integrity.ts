// Integralnosc i granica egress skilla (ADR-0143). Czyste funkcje, zero IO.
//
// Dwie luki, ktore ten modul zamyka - obie w warstwie Biblioteki umiejetnosci
// (ADR-0094/0096):
//
// 1. AUDYT ZAPISYWAL TOZSAMOSC, NIE INTEGRALNOSC. `defense.pipeline.run`
//    logowal `custom_skills` jako same identyfikatory. `importSkill` robi
//    upsert po `id`, wiec ten sam `id` i ta sama `version` moga po reimporcie
//    niesc INNY prompt. Zapis "uruchomil sie skill recenzent-pl 1.0.0" nie
//    dowodzil zatem, jaka tresc faktycznie uksztaltowala pismo. Suma kontrolna
//    promptu zamyka te luke: lancuch hashy przechowuje historie, wiec da sie
//    wykazac, KTORA wersja tresci dzialala w danym dniu - bez nowej kolumny,
//    bez migracji i bez nowego event_type.
//
//    Mechanizm celowo ten sam co w ADR-0142 (`canonicalSha256`): jedna
//    kanonikalizacja w calym projekcie i jedno wyjasnienie dla kancelarii.
//
// 2. `egress` SKILLA BYL DEKLARACJA BEZ EGZEKWOWANIA. Manifest deklaruje
//    `no-egress` albo `cloud-allowed`, walidacja to sprawdza, baza przechowuje,
//    UI pokazuje - a `CustomStageSpec` przekazywany do pipeline obrony tego pola
//    NIE MIAL. Prompt skilla oznaczonego `no-egress` i tak jechal do modelu
//    chmurowego. Pole to plaszczyzna egress SAMEGO SKILLA (tresc promptu,
//    know-how autora), rozlaczna od egressu danych klienta - ten pokrywa
//    maskowanie PII w pipeline.

import { canonicalSha256 } from "../audit-pack";
import type { EgressFlag } from "../llm/provider";
import type { SkillEgress, SkillPrompt } from "./manifest";

/**
 * Suma kontrolna tresci promptu skilla. Liczona z kanonicznej serializacji
 * pary { system, user } - kolejnosc kluczy nie wplywa na wynik.
 *
 * NIE obejmuje metadanych (nazwa, opis, wydawca). Chodzi o odpowiedz na
 * pytanie "jaka TRESC uksztaltowala to pismo", a nie "jak byla opisana".
 */
export function skillPromptSha256(prompt: SkillPrompt): string {
    return canonicalSha256({ system: prompt.system, user: prompt.user });
}

/** Skill w postaci, w jakiej trafia do audytu - tozsamosc PLUS integralnosc. */
export interface SkillAuditRecord {
    id: string;
    version: string;
    prompt_sha256: string;
    source: string;
    egress: SkillEgress;
    publisher: string | null;
    signed: boolean;
}

export interface SkillEgressDecision<T> {
    /** Skille dopuszczone do uruchomienia przy tym modelu. */
    allowed: T[];
    /** Skille pominiete, z powodem - trafiaja do audytu, nie znikaja po cichu. */
    skipped: Array<{ skill: T; reason: string }>;
}

/**
 * Rozdziela skille wedlug ich wlasnej deklaracji egress wobec egressu modelu.
 *
 * Regula: skill `no-egress` NIE moze pojsc do modelu, ktorego request opuszcza
 * maszyne. Kierunek jest jednostronny - skill `cloud-allowed` moze dzialac na
 * modelu lokalnym (mniej egressu nigdy nie szkodzi).
 *
 * Pominiecie jest CICHE DLA UZYTKOWNIKA, ale nie dla audytu - caller ma
 * obowiazek zalogowac `skipped`. Skill, ktory nie zadzialal, a wyglada jakby
 * zadzialal, to dokladnie ten rodzaj awarii, ktory konczy sie sukcesem.
 */
export function partitionSkillsByEgress<T extends { egress: SkillEgress; id: string }>(
    skills: readonly T[],
    modelEgress: EgressFlag,
): SkillEgressDecision<T> {
    const modelLeavesMachine = modelEgress !== "no-egress";
    const allowed: T[] = [];
    const skipped: Array<{ skill: T; reason: string }> = [];

    for (const skill of skills) {
        if (skill.egress === "no-egress" && modelLeavesMachine) {
            skipped.push({
                skill,
                reason: `skill zadeklarowany jako no-egress, a wybrany model ma egress ${modelEgress}`,
            });
            continue;
        }
        allowed.push(skill);
    }

    return { allowed, skipped };
}
