// Testy pure helpers infrastruktury migracji (ADR-0035).
//
// Brak testow integracyjnych z Supabase - runner sam jest skryptem
// administracyjnym i operator weryfikuje go przez `npm run migrate:status`
// na realnym deployment'cie. Tu sprawdzamy tylko logike deterministyczna.

import { describe, it, expect } from "vitest";
import {
    parseMigrationFilename,
    sortMigrations,
    computeMigrationChecksum,
    selectPendingMigrations,
    findDuplicateIds,
    extractUpDown,
} from "./migrations";

describe("parseMigrationFilename", () => {
    it("parsuje poprawna nazwe NNN_<slug>.sql", () => {
        expect(parseMigrationFilename("001_audit_log_event_type_check.sql")).toEqual({
            id: "001",
            name: "audit_log_event_type_check",
            filename: "001_audit_log_event_type_check.sql",
        });
    });

    it("akceptuje cyfry w slug", () => {
        expect(parseMigrationFilename("042_chat_v2_columns.sql")).toEqual({
            id: "042",
            name: "chat_v2_columns",
            filename: "042_chat_v2_columns.sql",
        });
    });

    it("odrzuca brak prefixu NNN", () => {
        expect(parseMigrationFilename("audit_log_event_type.sql")).toBeNull();
    });

    it("odrzuca prefix krotszy niz 3 cyfry", () => {
        expect(parseMigrationFilename("12_short_id.sql")).toBeNull();
    });

    it("odrzuca prefix dluzszy niz 3 cyfry", () => {
        expect(parseMigrationFilename("1234_too_long.sql")).toBeNull();
    });

    it("odrzuca rozszerzenia inne niz .sql", () => {
        expect(parseMigrationFilename("001_audit_check.txt")).toBeNull();
        expect(parseMigrationFilename("001_audit_check.SQL")).toBeNull();
    });

    it("odrzuca slug z duzymi literami albo mysznikiem", () => {
        expect(parseMigrationFilename("001_Audit_Check.sql")).toBeNull();
        expect(parseMigrationFilename("001_audit-check.sql")).toBeNull();
    });

    it("odrzuca pusty slug", () => {
        expect(parseMigrationFilename("001_.sql")).toBeNull();
    });
});

describe("sortMigrations", () => {
    it("sortuje rosnaco po id leksykalnie", () => {
        const input = [
            { id: "003", name: "c", filename: "003_c.sql" },
            { id: "001", name: "a", filename: "001_a.sql" },
            { id: "002", name: "b", filename: "002_b.sql" },
        ];
        expect(sortMigrations(input).map((f) => f.id)).toEqual([
            "001",
            "002",
            "003",
        ]);
    });

    it("nie modyfikuje wejscia", () => {
        const input = [
            { id: "002", name: "b", filename: "002_b.sql" },
            { id: "001", name: "a", filename: "001_a.sql" },
        ];
        const before = JSON.stringify(input);
        sortMigrations(input);
        expect(JSON.stringify(input)).toBe(before);
    });

    it("zachowuje stabilnosc gdy id sa rowne (degraduje do kolejnosci wejscia)", () => {
        const input = [
            { id: "001", name: "first", filename: "001_first.sql" },
            { id: "001", name: "second", filename: "001_second.sql" },
        ];
        expect(sortMigrations(input).map((f) => f.name)).toEqual([
            "first",
            "second",
        ]);
    });
});

describe("computeMigrationChecksum", () => {
    it("zwraca SHA-256 hex (64 znaki lower-case)", () => {
        const checksum = computeMigrationChecksum("select 1;");
        expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it("jest deterministyczny", () => {
        const c1 = computeMigrationChecksum("alter table foo add constraint bar check (true);");
        const c2 = computeMigrationChecksum("alter table foo add constraint bar check (true);");
        expect(c1).toBe(c2);
    });

    it("wykrywa zmiane choc jednego bajtu", () => {
        const c1 = computeMigrationChecksum("select 1;");
        const c2 = computeMigrationChecksum("select 2;");
        expect(c1).not.toBe(c2);
    });

    it("rozni sie dla bialych znakow (whitespace ma znaczenie)", () => {
        const c1 = computeMigrationChecksum("select 1;");
        const c2 = computeMigrationChecksum("select 1; ");
        expect(c1).not.toBe(c2);
    });
});

describe("selectPendingMigrations", () => {
    const files = [
        { id: "001", name: "a", filename: "001_a.sql" },
        { id: "002", name: "b", filename: "002_b.sql" },
        { id: "003", name: "c", filename: "003_c.sql" },
    ];

    it("zwraca wszystkie gdy applied pusty", () => {
        expect(selectPendingMigrations(files, new Set()).map((f) => f.id)).toEqual([
            "001",
            "002",
            "003",
        ]);
    });

    it("pomija juz zaaplikowane", () => {
        const applied = new Set(["001", "002"]);
        expect(selectPendingMigrations(files, applied).map((f) => f.id)).toEqual(["003"]);
    });

    it("zwraca pustą tablice gdy wszystko zaaplikowane", () => {
        const applied = new Set(["001", "002", "003"]);
        expect(selectPendingMigrations(files, applied)).toEqual([]);
    });

    it("zachowuje kolejnosc wejscia", () => {
        const out = selectPendingMigrations(files, new Set(["002"]));
        expect(out.map((f) => f.id)).toEqual(["001", "003"]);
    });
});

describe("findDuplicateIds", () => {
    it("zwraca pustą tablice gdy id unikalne", () => {
        const files = [
            { id: "001", name: "a", filename: "001_a.sql" },
            { id: "002", name: "b", filename: "002_b.sql" },
        ];
        expect(findDuplicateIds(files)).toEqual([]);
    });

    it("wykrywa pojedynczy duplikat", () => {
        const files = [
            { id: "001", name: "first", filename: "001_first.sql" },
            { id: "001", name: "second", filename: "001_second.sql" },
            { id: "002", name: "ok", filename: "002_ok.sql" },
        ];
        expect(findDuplicateIds(files)).toEqual(["001"]);
    });

    it("wykrywa wiele duplikatow", () => {
        const files = [
            { id: "001", name: "a", filename: "001_a.sql" },
            { id: "001", name: "b", filename: "001_b.sql" },
            { id: "002", name: "c", filename: "002_c.sql" },
            { id: "002", name: "d", filename: "002_d.sql" },
        ];
        expect(findDuplicateIds(files).sort()).toEqual(["001", "002"]);
    });

    it("nie zglasza pojedynczych nawet gdy duplikat jest osobny", () => {
        const files = [
            { id: "001", name: "a", filename: "001_a.sql" },
            { id: "002", name: "b1", filename: "002_b1.sql" },
            { id: "002", name: "b2", filename: "002_b2.sql" },
            { id: "003", name: "c", filename: "003_c.sql" },
        ];
        expect(findDuplicateIds(files)).toEqual(["002"]);
    });
});

describe("extractUpDown (ADR-0038)", () => {
    it("rozdziela UP i DOWN gdy oba markery obecne", () => {
        const content = `-- UP
alter table foo add column bar text;

-- DOWN
alter table foo drop column bar;`;
        const result = extractUpDown(content);
        expect(result.up).toBe("alter table foo add column bar text;");
        expect(result.down).toBe("alter table foo drop column bar;");
    });

    it("back-compat: plik bez UP/DOWN markerow - caly content jako up", () => {
        const content = "alter table foo add column bar text;";
        const result = extractUpDown(content);
        expect(result.up).toBe("alter table foo add column bar text;");
        expect(result.down).toBe("");
    });

    it("plik tylko z DOWN markerem (bez UP) - tresc przed markerem jako up", () => {
        const content = `create table foo (id int);

-- DOWN
drop table foo;`;
        const result = extractUpDown(content);
        expect(result.up).toBe("create table foo (id int);");
        expect(result.down).toBe("drop table foo;");
    });

    it("case-insensitive marker (-- down zamiast -- DOWN)", () => {
        const content = `alter table foo add column bar text;
-- down
alter table foo drop column bar;`;
        const result = extractUpDown(content);
        expect(result.up).toBe("alter table foo add column bar text;");
        expect(result.down).toBe("alter table foo drop column bar;");
    });

    it("whitespace wokol markera (-- DOWN   z trailing space)", () => {
        const content = "alter table foo add column bar text;\n--   DOWN   \nalter table foo drop column bar;";
        const result = extractUpDown(content);
        expect(result.up).toBe("alter table foo add column bar text;");
        expect(result.down).toBe("alter table foo drop column bar;");
    });

    it("pierwsze wystapienie -- DOWN wygrywa (nie scala wielu sekcji)", () => {
        const content = `alter table a add column x text;
-- DOWN
drop column x;
-- DOWN
this is treated as part of first down section;`;
        const result = extractUpDown(content);
        expect(result.up).toBe("alter table a add column x text;");
        expect(result.down).toContain("drop column x;");
        expect(result.down).toContain("this is treated as part of first down section;");
    });

    it("pusta sekcja DOWN (-- DOWN bez tresci)", () => {
        const content = `alter table foo add column bar text;
-- DOWN`;
        const result = extractUpDown(content);
        expect(result.up).toBe("alter table foo add column bar text;");
        expect(result.down).toBe("");
    });

    it("trim whitespace na koncach obu sekcji", () => {
        const content = `

-- UP

   alter table foo add column bar text;

-- DOWN

   alter table foo drop column bar;

`;
        const result = extractUpDown(content);
        expect(result.up).toBe("alter table foo add column bar text;");
        expect(result.down).toBe("alter table foo drop column bar;");
    });
});
