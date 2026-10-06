// B-05: Pamiec "osobista" (scope "personal", czat ogolny bez sprawy) NIE jest
// kluczowana po uzytkowniku - lib/chat/tool-dispatch.ts:656 i :680 ustawiaja
// scope = projectId ?? "personal", a brain/store.ts:62-70 buduje katalog tylko ze
// scope. W trybie serwerowym (wielu prawnikow, jeden backend) wpis zapisany przez
// uzytkownika A w czacie ogolnym jest odczytywany przez recall uzytkownika B -
// kanal przecieku miedzy uzytkownikami i kanal zatrucia cudzych sesji.
// Oczekiwane: recall uzytkownika B nie widzi pamieci osobistej uzytkownika A.
// Desktop single-user: bez wplywu (jeden uzytkownik).
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "audit-b05-"));
process.env.PATRON_BRAIN_DIR = path.join(TMP, "brain");
// Zapis pamieci inline: karty zatwierdzen (ADR-0137) sa domyslnie wlaczone od
// 2026-10-06, a ten test dotyczy izolacji zakresu zapisu, nie bramki - jawny wylacznik.
process.env.PATRON_MUTATION_APPROVAL = "false";

import { runToolCalls } from "../src/lib/chat/tool-dispatch";

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const db: any = {}; // remember/recall nie dotykaja bazy
const call = (name: string, args: Record<string, unknown>) => [{ id: `${name}-1`, function: { name, arguments: JSON.stringify(args) } }];

describe("B-05 izolacja pamieci osobistej miedzy uzytkownikami (tryb serwerowy)", () => {
    it("recall uzytkownika B nie zwraca pamieci osobistej zapisanej przez uzytkownika A", async () => {
        await runToolCalls(
            call("remember", { type: "fakt-sprawy", title: "Ugoda Testowy", body: "Klient Jan Testowy akceptuje ugode do 50 000 zl (poufne).", slug: "ugoda-testowy" }),
            new Map(), "uzytkownik-A", db, () => {}, undefined, undefined, {}, new Map(), null,
        );
        const out = await runToolCalls(call("recall", {}), new Map(), "uzytkownik-B", db, () => {}, undefined, undefined, {}, new Map(), null);
        const tresc = (out.toolResults[0] as { content: string }).content;
        expect(tresc, "B widzi pamiec osobista A").not.toContain("ugoda-testowy");
    });
});
