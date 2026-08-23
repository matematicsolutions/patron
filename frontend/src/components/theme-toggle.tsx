// Przelacznik motywu: system / jasny / ciemny.
//
// Do 2026-08-21 tryb ciemny w Patronie byl MARTWY: klasa `.dark` nie byla
// nigdzie zakladana, wiec paleta ciemna istniala w CSS i nie dalo sie jej
// zobaczyc. Ten komponent jest brakujacym ogniwem.
//
// Wybor trzyma sie w localStorage pod 'patron-theme'; brak zapisu = motyw
// JASNY (awers) - domyslny motyw startowy z decyzji produktowej 2026-08-21, wiec
// "system" jest zapisywany jawnie. Pierwsze malowanie obsluguje maly skrypt
// w <head> (app/layout.tsx) - bez niego przy ciemnym motywie mignelo by
// biale tlo.

"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { t } from "@/i18n";

type Wybor = "system" | "light" | "dark";
const KLUCZ = "patron-theme";

function zastosuj(w: Wybor): void {
    const ciemny =
        w === "dark" ||
        (w === "system" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", ciemny);
}

const IKONY: Record<Wybor, typeof Sun> = {
    system: Monitor,
    light: Sun,
    dark: Moon,
};

function useMotyw() {
    // Stan startowy czytany z localStorage w inicjalizatorze, nie w efekcie -
    // dzieki temu nie ma dodatkowego renderu ani migniecia (por. degradacja
    // reguly react-hooks/set-state-in-effect w eslint.config.mjs).
    const [wybor, setWybor] = useState<Wybor>(() => {
        if (typeof window === "undefined") return "light";
        const zapis = window.localStorage.getItem(KLUCZ);
        return zapis === "light" || zapis === "dark" || zapis === "system"
            ? zapis
            : "light";
    });

    // Gdy uzytkownik wybral "system", nadazamy za zmiana ustawien OS.
    useEffect(() => {
        if (wybor !== "system") return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => zastosuj("system");
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [wybor]);

    function wybierz(w: Wybor) {
        setWybor(w);
        window.localStorage.setItem(KLUCZ, w);
        zastosuj(w);
    }

    return { wybor, wybierz };
}

function etykieta(w: Wybor): string {
    return w === "system"
        ? t("theme.system")
        : w === "light"
          ? t("theme.light")
          : t("theme.dark");
}

export function ThemeToggle() {
    const { wybor, wybierz } = useMotyw();

    const opcje: { id: Wybor; label: string; Ikona: typeof Sun }[] = [
        { id: "system", label: t("theme.system"), Ikona: Monitor },
        { id: "light", label: t("theme.light"), Ikona: Sun },
        { id: "dark", label: t("theme.dark"), Ikona: Moon },
    ];

    return (
        <div
            role="radiogroup"
            aria-label={t("theme.label")}
            data-testid="theme-toggle"
            className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
        >
            {opcje.map(({ id, label, Ikona }) => {
                const aktywny = wybor === id;
                return (
                    <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={aktywny}
                        onClick={() => wybierz(id)}
                        title={label}
                        className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                            aktywny
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Ikona className="h-3.5 w-3.5" aria-hidden="true" />
                        {label}
                    </button>
                );
            })}
        </div>
    );
}

// Wariant symboliczny do stalej nawigacji (ikona zamiast etykiety tekstowej):
// jeden przycisk z ikona biezacego motywu, klik przechodzi cyklicznie
// system -> jasny -> ciemny. Pelna wersja z etykietami zostaje w Ustawieniach.
const CYKL: Record<Wybor, Wybor> = {
    system: "light",
    light: "dark",
    dark: "system",
};

export function ThemeToggleCompact({ className = "" }: { className?: string }) {
    const { wybor, wybierz } = useMotyw();
    const Ikona = IKONY[wybor];
    const nastepny = CYKL[wybor];

    return (
        <button
            type="button"
            data-testid="theme-toggle-compact"
            onClick={() => wybierz(nastepny)}
            title={`${t("theme.label")}: ${etykieta(wybor)} → ${etykieta(nastepny)}`}
            aria-label={`${t("theme.label")}: ${etykieta(wybor)}`}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-gray-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400 ${className}`}
        >
            <Ikona className="h-4 w-4" aria-hidden="true" />
        </button>
    );
}
