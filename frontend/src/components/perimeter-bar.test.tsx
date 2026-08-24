// Testy paska perymetru - powierzchni, ktora odpowiada na pytanie zadawane przez
// kazdego partnera w kancelarii: "czy to wyszlo z mojego komputera?".
//
// Siatka pilnuje jednej rzeczy ponad wszystkie inne: BRAK ODPOWIEDZI O
// KONFIGURACJI NIE JEST STANEM ZIELONYM. To ta sama zasada, co przy groundingu
// cytatu (ADR-0146) i ten sam mechanizm, ktory w innych miejscach zawiodl -
// awaria konczaca sie sukcesem. Pasek, ktory przy padnietym endpoincie
// pokazywalby "dane nie opuszczaja urzadzenia", bylby gorszy niz jego brak,
// bo klamalby o zgodnosci.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import type { EgressConfig } from "@/hooks/useEgressConfig";
import type { McpStatus } from "@/hooks/useMcpSecurityStatus";

const egress = vi.hoisted(() => ({ config: null as EgressConfig | null }));
const mcp = vi.hoisted(() => ({ status: null as McpStatus | null }));

vi.mock("@/hooks/useEgressConfig", () => ({
    useEgressConfig: () => ({ config: egress.config }),
}));
vi.mock("@/hooks/useMcpSecurityStatus", () => ({
    useMcpSecurityStatus: () => ({ visible: true, status: mcp.status, error: null }),
}));
// Wybrany model jest ZMIENNA testu, nie stala: plakietka "(lokalny)" i zielone
// zapewnienie o danych zaleza wlasnie od niego. Do 2026-08-24 mock byl przybity
// na sztywno do modelu chmurowego, wiec przypadek "postawa lokalna" mierzyl
// konfiguracje, ktora w produkcie NIE JEST lokalna - i dlatego siatka przepuscila
// pasek piszacy "openrouter/google/gemini-3-flash-preview (lokalny)".
const selected = vi.hoisted(() => ({ model: "" }));

vi.mock("@/app/hooks/useSelectedModel", () => ({
    useSelectedModel: () => [selected.model, vi.fn()],
}));

/** DEFAULT_MODEL_ID z ModelToggle - na tym startuje swieza instalacja. */
const CLOUD_MODEL = "openrouter/google/gemini-3-flash-preview";
/** Jedyna pozycja grupy "Lokalny" w pickerze modeli. */
const LOCAL_MODEL = "ollama/SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M";

import { PerimeterBar } from "./perimeter-bar";

function config(over: Partial<EgressConfig> = {}): EgressConfig {
    return {
        us_providers: { allowed: false },
        privileged_cloud: { allowed: false },
        local_model_configured: false,
        ...over,
    };
}

function status(denied: number): McpStatus {
    return {
        gateway: { mode: "enforce", active: true, last_startup_scan: null } as McpStatus["gateway"],
        audit_summary_24h: {
            decisions_total: 12,
            by_action: { audit: 12 - denied, human_review: 0, denied },
        },
    };
}

function bar(): HTMLElement {
    return screen.getByTestId("perimeter-bar");
}

beforeEach(() => {
    selected.model = CLOUD_MODEL;
});

describe("PerimeterBar - postawa perymetru", () => {
    beforeEach(() => {
        egress.config = null;
        mcp.status = null;
    });

    it("brak konfiguracji NIE awansuje na zielony - stan 'nie potwierdzam'", () => {
        egress.config = null;
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("unknown");
        expect(bar().getAttribute("data-posture")).not.toBe("local");
        expect(screen.getByText(t("perimeter.unknown"))).toBeTruthy();
    });

    it("tryb czysto lokalny raportuje, ze dane nie opuszczaja urzadzenia", () => {
        egress.config = config();
        // Postawa lokalna to KONIUNKCJA: polityka zamknieta ORAZ wybrany model
        // lokalny. Sam zamkniety egress przy modelu chmurowym to "cloud-blocked".
        selected.model = LOCAL_MODEL;
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("local");
        expect(screen.getByText(t("perimeter.local"))).toBeTruthy();
    });

    it("dopuszczony model chmurowy dla tajemnicy jest widoczny, nie schowany", () => {
        egress.config = config({ privileged_cloud: { allowed: true } });
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("cloud");
        expect(screen.getByText(t("perimeter.cloudPrivileged"))).toBeTruthy();
    });

    it("sami dostawcy z USA tez daja stan 'cloud', nie 'local'", () => {
        egress.config = config({ us_providers: { allowed: true } });
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("cloud");
        expect(screen.getByText(t("perimeter.cloudUs"))).toBeTruthy();
    });

    it("pasek renderuje sie ZAWSZE - cisza nie jest informacja", () => {
        egress.config = null;
        mcp.status = null;
        render(<PerimeterBar />);
        // W przeciwienstwie do EgressConfigBanner, ktory znika gdy jest dobrze
        // (i tak samo znika, gdy padnie), ten element istnieje w kazdym stanie.
        expect(bar()).toBeTruthy();
    });

    it("zablokowane decyzje bramki MCP sa wypisane liczba, nie ukryte", () => {
        egress.config = config();
        mcp.status = status(3);
        render(<PerimeterBar />);
        expect(bar().textContent).toContain("3");
        expect(bar().textContent).toContain(t("perimeter.blocked"));
    });

    it("brak zablokowanych nie dokleja pustego ostrzezenia", () => {
        egress.config = config();
        mcp.status = status(0);
        render(<PerimeterBar />);
        expect(bar().textContent).not.toContain(t("perimeter.blocked"));
    });
});

// ZMIERZONE 2026-08-24 na profilu demo: przy PATRON_LOCAL_MODEL=ollama/llama3:latest
// i domyslnie wybranym modelu chmurowym pasek pisal doslownie
//   "Dane nie opuszczaja urzadzenia | MODEL openrouter/google/gemini-3-flash-preview (lokalny)"
// czyli nazwe modelu z USA opisana jako lokalny, obok zielonego zapewnienia o danych.
// Zrodlo: plakietka wisiala na `local_model_configured`, ktore znaczy "gdzies w env
// ustawiono model lokalny", a NIE "model widoczny obok jest lokalny".
describe("PerimeterBar - plakietka (lokalny) opisuje WYSWIETLANY model", () => {
    function badge(): HTMLElement | null {
        return screen.queryByText(`(${t("perimeter.localModel")})`);
    }

    beforeEach(() => {
        mcp.status = null;
    });

    it("model chmurowy + PATRON_LOCAL_MODEL ustawiony: plakietka NIE pada", () => {
        egress.config = config({ local_model_configured: true });
        selected.model = CLOUD_MODEL;
        render(<PerimeterBar />);
        expect(
            screen.getByTestId("perimeter-model-link").textContent,
        ).toContain(CLOUD_MODEL);
        expect(badge()).toBeNull();
    });

    // Kontrola pozytywna: bramka wyzej moze byc zielona dlatego, ze nie ma na czym
    // zadzialac. Ten przypadek dowodzi, ze plakietka w ogole potrafi sie pojawic.
    it("model ollama/ dostaje plakietke - bramka ma mianownik", () => {
        egress.config = config({ local_model_configured: true });
        selected.model = LOCAL_MODEL;
        render(<PerimeterBar />);
        expect(badge()).not.toBeNull();
    });

    it("model ollama/ jest lokalny takze bez PATRON_LOCAL_MODEL w env", () => {
        egress.config = config({ local_model_configured: false });
        selected.model = LOCAL_MODEL;
        render(<PerimeterBar />);
        expect(badge()).not.toBeNull();
    });
});

// Zielone "Dane nie opuszczaja urzadzenia" jest ZAROBIONE, nie domyslne: wymaga
// zamknietej polityki egresu ORAZ lokalnego modelu w uzyciu. Sama zamknieta
// polityka mowi tylko tyle, ze router zablokuje wyjscie - to jest inne zdanie
// i musi byc inaczej napisane (cisza gorsza niz ostrzezenie).
describe("PerimeterBar - zapewnienie o danych jest koniunkcja polityki i modelu", () => {
    beforeEach(() => {
        mcp.status = null;
    });

    it("polityka zamknieta, ale model chmurowy: 'chmura zablokowana', NIE 'dane nie opuszczaja urzadzenia'", () => {
        egress.config = config({ local_model_configured: true });
        selected.model = CLOUD_MODEL;
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("cloud-blocked");
        expect(screen.queryByText(t("perimeter.local"))).toBeNull();
        expect(screen.getByText(t("perimeter.cloudBlocked"))).toBeTruthy();
    });

    it("polityka zamknieta ORAZ model lokalny: zapewnienie zarobione", () => {
        egress.config = config();
        selected.model = LOCAL_MODEL;
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("local");
        expect(screen.getByText(t("perimeter.local"))).toBeTruthy();
    });

    // Asymetria celowa: otwarta flaga egresu NIE awansuje na zielono nawet przy
    // lokalnym modelu glownym, bo model glowny to nie caly ruch - tytul czatu i
    // przeglad tabelaryczny ida na DEFAULT_TITLE_MODEL (chmura) niezaleznie od
    // wyboru w pickerze.
    it("otwarta flaga egresu nie awansuje na zielono nawet przy modelu lokalnym", () => {
        egress.config = config({ us_providers: { allowed: true } });
        selected.model = LOCAL_MODEL;
        render(<PerimeterBar />);
        expect(bar().getAttribute("data-posture")).toBe("cloud");
        expect(screen.queryByText(t("perimeter.local"))).toBeNull();
    });
});

describe("PerimeterBar - osiagalnosc akt", () => {
    beforeEach(() => {
        egress.config = config();
        mcp.status = status(0);
    });

    // Do 2026-08-21 do /admin/audit NIE PROWADZIL zaden link w calym UI - lancuch
    // skrotow, pieczec Merkle i eksport teczki dowodowej (ADR-0142) dalo sie
    // otworzyc wylacznie wpisujac adres recznie. Funkcja, ktorej nie da sie
    // znalezc, nie istnieje dla uzytkownika.
    it("licznik decyzji prowadzi do akt i dowodow", () => {
        render(<PerimeterBar />);
        const link = screen.getByTestId("perimeter-audit-link");
        expect(link.getAttribute("href")).toBe("/admin/audit");
    });

    it("bez danych bramki MCP nie zmyslamy linku", () => {
        mcp.status = null;
        render(<PerimeterBar />);
        expect(screen.queryByTestId("perimeter-audit-link")).toBeNull();
    });
});

// ADR-0149 (korekta WM 2026-08-21): pasek przejal caly stan trwaly po gornych
// banerach, wiec KAZDY segment musi prowadzic tam, gdzie sie tym faktem
// zarzadza. Segment, ktory tylko informuje, oddaje uzytkownika w rece
// szukania po ustawieniach - a to byl powod, dla ktorego banery w ogole
// powstaly na gorze.
describe("PerimeterBar - kazdy segment prowadzi tam, gdzie sie tym zarzadza", () => {
    beforeEach(() => {
        egress.config = config({ privileged_cloud: { allowed: true } });
        mcp.status = status(0);
    });

    it("postawa perymetru prowadzi do polityki modelu - zgode da sie ODWOLAC", () => {
        render(<PerimeterBar />);
        expect(
            screen.getByTestId("perimeter-posture-link").getAttribute("href"),
        ).toBe("/account/models");
    });

    it("model prowadzi do modeli i kluczy", () => {
        render(<PerimeterBar />);
        expect(
            screen.getByTestId("perimeter-model-link").getAttribute("href"),
        ).toBe("/account/models");
    });

    it("bramka MCP prowadzi do akt z decyzjami", () => {
        render(<PerimeterBar />);
        expect(
            screen.getByTestId("perimeter-gateway-link").getAttribute("href"),
        ).toBe("/admin/audit");
    });
});
