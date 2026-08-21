// Przelacznik motywu: system / jasny / ciemny.
//
// Do 2026-08-21 tryb ciemny w Patronie byl MARTWY: klasa `.dark` nie byla
// nigdzie zakladana, wiec paleta ciemna istniala w CSS i nie dalo sie jej
// zobaczyc. Ten komponent jest brakujacym ogniwem.
//
// Wybor trzyma sie w localStorage pod 'patron-theme'; brak zapisu = motyw
// systemu. Pierwsze malowanie obsluguje maly skrypt w <head> (app/layout.tsx) -
// bez niego przy ciemnym motywie mignelo by biale tlo.

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

export function ThemeToggle() {
    // Stan startowy czytany z localStorage w inicjalizatorze, nie w efekcie -
    // dzieki temu nie ma dodatkowego renderu ani migniecia (por. degradacja
    // reguly react-hooks/set-state-in-effect w eslint.config.mjs).
    const [wybor, setWybor] = useState<Wybor>(() => {
        if (typeof window === "undefined") return "system";
        const zapis = window.localStorage.getItem(KLUCZ);
        return zapis === "light" || zapis === "dark" ? zapis : "system";
    });

    // Gdy uzytkownik zostaje przy "system", nadazamy za zmiana ustawien OS.
    useEffect(() => {
        if (wybor !== "system") return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => zastosuj("system");
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [wybor]);

    function wybierz(w: Wybor) {
        setWybor(w);
        if (w === "system") window.localStorage.removeItem(KLUCZ);
        else window.localStorage.setItem(KLUCZ, w);
        zastosuj(w);
    }

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
