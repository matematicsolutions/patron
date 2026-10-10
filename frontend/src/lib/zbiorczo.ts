/**
 * Wykonuje operacje dla wielu identyfikatorow i mowi, ktore sie udaly.
 *
 * Nigdy nie udaje sukcesu: wolajacy usuwa z widoku tylko `udane` i nazywa
 * `nieudane` uzytkownikowi. Wyjatek synchroniczny w `op` liczy sie jak odrzucenie
 * i nie przerywa pozostalych operacji. Kolejnosc wyniku = kolejnosc wejscia.
 */
export async function zbiorczo(
    ids: readonly string[],
    op: (id: string) => Promise<unknown>,
): Promise<{ udane: string[]; nieudane: string[] }> {
    const wyniki = await Promise.allSettled(
        ids.map((id) => {
            try {
                return op(id);
            } catch (e) {
                return Promise.reject(e);
            }
        }),
    );
    const udane: string[] = [];
    const nieudane: string[] = [];
    wyniki.forEach((w, i) => (w.status === "fulfilled" ? udane : nieudane).push(ids[i]));
    return { udane, nieudane };
}
