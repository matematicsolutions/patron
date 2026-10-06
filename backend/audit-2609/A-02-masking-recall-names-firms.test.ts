// A-02: Detektor egress czatu (wrapConversation + plEntityDetector, lib/chat/stream.ts:371)
// przepuszcza do modelu chmurowego wiekszosc nazwisk i czesc nazw spolek, ktore README
// obiecuje maskowac ("names, companies, PESEL/NIP/REGON are masked before any cloud model").
// Pomiar na zestawach ukrytych 2-5: OSOBA 467/526 niezamaskowane, FIRMA 176/322, PHONE 31/44.
// Oczekiwane: na prostych syntetycznych przykladach osoba bez kotwicy honoryfikatora,
// dalsze wystapienie nazwy spolki bez formy prawnej i telefon bez +48 nie wychodza jawnie.
import { describe, it, expect } from "vitest";
import { wrapConversation, plEntityDetector } from "../src/lib/pseudonim";

async function egress(text: string): Promise<string> {
    const w = await wrapConversation("", [{ role: "user", content: text }], {
        llmDetector: plEntityDetector,
    });
    return w.messages[0]!.content;
}

describe("A-02 maskowanie egress: obiecane klasy wychodza jawnie", () => {
    it("osoba bez honoryfikatora/roli (typowa komparycja umowy) jest maskowana", async () => {
        const out = await egress("Umowe zawarli Jan Testowy oraz Anna Probna w dniu 3 marca 2025 r.");
        expect(out).not.toContain("Jan Testowy");
        expect(out).not.toContain("Anna Probna");
    });

    it("dalsze wystapienie nazwy spolki (bez formy prawnej, w odmianie) jest maskowane", async () => {
        const out = await egress(
            "Pozwana Testbud Probny sp. z o.o. nie zaplacila faktury. Zarzad Testbudu odmowil zaplaty.",
        );
        // Sanity: pierwsze wystapienie z forma prawna jest maskowane.
        expect(out).not.toContain("Testbud Probny sp. z o.o.");
        // ZADANE: nazwa podmiotu nie wychodzi w dalszej czesci tekstu.
        expect(out).not.toContain("Testbud");
    });

    it("telefon krajowy bez prefiksu +48 jest maskowany", async () => {
        const out = await egress("Kontakt do powoda: tel. 600 100 200.");
        expect(out).not.toContain("600 100 200");
    });
});
