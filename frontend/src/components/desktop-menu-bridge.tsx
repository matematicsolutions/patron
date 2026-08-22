// Most miedzy menu systemowym Electrona a nawigacja aplikacji.
//
// Po co: do 2026-08-22 pozycja "Nowa sprawa" (Ctrl+N) wysylala z menu zdarzenie
// `new-case`, ktorego NIKT nie odbieral - klikniecie i skrot nie robily nic,
// bez sladu i bez komunikatu. Martwy przycisk jest gorszy niz brak przycisku,
// zwlaszcza w produkcie, ktorego teza brzmi "nie milcz".
//
// Zamiast mnozyc zdarzenia per pozycja menu (i ryzykowac, ze kolejne znowu
// utknie), menu prosi o JEDNO: nawigacje pod sciezke wewnetrzna. Preload
// przepuszcza wylacznie stringi zaczynajace sie od "/" - z menu nie da sie
// otworzyc adresu zewnetrznego ani wykonac kodu.
//
// W przegladarce (dev bez Electrona) `window.patron` nie istnieje i komponent
// nie robi nic.

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface PatronBridge {
    onMenuNavigate?: (cb: (path: string) => void) => () => void;
}

export function DesktopMenuBridge(): null {
    const router = useRouter();

    useEffect(() => {
        const bridge = (window as unknown as { patron?: PatronBridge }).patron;
        if (!bridge?.onMenuNavigate) return;
        return bridge.onMenuNavigate((path) => router.push(path));
    }, [router]);

    return null;
}
