// Menu systemowe musi cokolwiek robic.
//
// Do 2026-08-22 pozycja "Nowa sprawa" (Ctrl+N) wysylala zdarzenie, ktorego nikt
// nie odbieral - klik nie robil NIC i nie zostawial sladu. Ten test pilnuje
// drugiej strony mostu: gdy powloka Electrona zglasza nawigacje, aplikacja
// faktycznie nawiguje, a po odmontowaniu komponent odpina sluchacza (inaczej
// przy kazdej zmianie trasy przybywalby jeden i menu strzelaloby wielokrotnie).

import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace: vi.fn() }),
}));

import { DesktopMenuBridge } from "./desktop-menu-bridge";

type Cb = (path: string) => void;

function zamontujMost() {
    const sluchacze: Cb[] = [];
    const odpiete: Cb[] = [];
    (window as unknown as { patron?: unknown }).patron = {
        onMenuNavigate: (cb: Cb) => {
            sluchacze.push(cb);
            return () => odpiete.push(cb);
        },
    };
    return { sluchacze, odpiete };
}

afterEach(() => {
    cleanup();
    push.mockReset();
    delete (window as unknown as { patron?: unknown }).patron;
});

describe("DesktopMenuBridge", () => {
    it("nawiguje pod sciezke zlecona przez menu", () => {
        const { sluchacze } = zamontujMost();
        render(<DesktopMenuBridge />);
        expect(sluchacze).toHaveLength(1);

        sluchacze[0]!("/projects?new=1");
        expect(push).toHaveBeenCalledWith("/projects?new=1");
    });

    it("odpina sluchacza przy odmontowaniu", () => {
        const { sluchacze, odpiete } = zamontujMost();
        const { unmount } = render(<DesktopMenuBridge />);
        unmount();
        expect(odpiete).toEqual(sluchacze);
    });

    it("bez powloki Electrona nie robi nic i nie wybucha", () => {
        expect(() => render(<DesktopMenuBridge />)).not.toThrow();
        expect(push).not.toHaveBeenCalled();
    });
});
