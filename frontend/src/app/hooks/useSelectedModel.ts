"use client";

import { useCallback, useEffect, useState } from "react";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL_ID } from "../components/assistant/ModelToggle";

const STORAGE_KEY = "patron.selectedModel";

/**
 * Model aktualnie wybrany w selektorze czatu (ten sam, ktory pojdzie z nastepna
 * wiadomoscia). Czytany w chwili wywolania, nie z migawki stanu hooka - panel
 * draftu (audyt 2026-09, A-05) bierze go jako model rozmowy, gdy wiadomosc nie
 * niesie wlasnego `model` (np. czat wczytany z bazy).
 */
export function readSelectedModel(): string {
    if (typeof window === "undefined") return DEFAULT_MODEL_ID;
    let raw: string | null = null;
    try {
        raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
        raw = null;
    }
    if (raw && ALLOWED_MODEL_IDS.has(raw)) return raw;
    return DEFAULT_MODEL_ID;
}

export function useSelectedModel(): [string, (id: string) => void] {
    const [model, setModelState] = useState<string>(DEFAULT_MODEL_ID);

    useEffect(() => {
        setModelState(readSelectedModel());
    }, []);

    const setModel = useCallback((id: string) => {
        const next = ALLOWED_MODEL_IDS.has(id) ? id : DEFAULT_MODEL_ID;
        setModelState(next);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(STORAGE_KEY, next);
        }
    }, []);

    return [model, setModel];
}
