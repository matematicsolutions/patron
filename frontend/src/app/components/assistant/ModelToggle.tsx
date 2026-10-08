"use client";

import { useState } from "react";
import { ChevronDown, Check, AlertCircle } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isModelAvailable } from "@/app/lib/modelAvailability";
import type { ApiKeyState } from "@/app/lib/patronApi";
import { t } from "@/i18n";

export type ModelGroup =
    | "Lokalny"
    | "OpenRouter"
    | "Anthropic"
    | "Google"
    | "OpenAI";

export interface ModelOption {
    id: string;
    label: string;
    group: ModelGroup;
}

// Lokalny (Ollama) = zero egress, tajemnica zostaje na urzadzeniu.
// OpenRouter = jeden klucz, wiele modeli (w tym chinskie) - "podepniemy wszystko".
// Grupy natywne = wlasny klucz danego dostawcy.
export const MODELS: ModelOption[] = [
    {
        id: "ollama/SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M",
        label: "Bielik 11B (lokalny)",
        group: "Lokalny",
    },
    {
        id: "openrouter/anthropic/claude-opus-5.5",
        label: "Claude Opus 5.5",
        group: "OpenRouter",
    },
    {
        id: "openrouter/anthropic/claude-sonnet-5.5",
        label: "Claude Sonnet 5.5",
        group: "OpenRouter",
    },
    {
        id: "openrouter/google/gemini-3-flash-preview",
        label: "Gemini 3 Flash",
        group: "OpenRouter",
    },
    {
        id: "openrouter/qwen/qwen3.6-flash",
        label: "Qwen 3.6 Flash",
        group: "OpenRouter",
    },
    {
        id: "openrouter/mistralai/mistral-medium-3-5",
        label: "Mistral Medium 3.5",
        group: "OpenRouter",
    },
    // Modele "direct" (wlasny klucz danego dostawcy). Suffix w etykiecie ROZROZNIA
    // je od identycznie nazwanych modeli OpenRouter - inaczej w pickerze widac dwa
    // razy "Claude Sonnet 4.6" i nie wiadomo, ktory wymaga wlasnego klucza (to byl
    // realny blad pilotazu: wybor wersji bez klucza dawal gluchy "Stream error").
    { id: "claude-opus-5-5", label: "Claude Opus 5.5 (wlasny klucz Anthropic)", group: "Anthropic" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (wlasny klucz Anthropic)", group: "Anthropic" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (wlasny klucz Google)", group: "Google" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (wlasny klucz Google)", group: "Google" },
    { id: "gpt-5.5", label: "GPT-5.5 (wlasny klucz OpenAI)", group: "OpenAI" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini (wlasny klucz OpenAI)", group: "OpenAI" },
];

// Domyslny model: OpenRouter Gemini 3 Flash - tani i szybki, jeden klucz Operatora
// pokrywa wszystkie modele OpenRouter, wiec dziala "z pudelka". Wczesniej domyslny
// byl Gemini-direct (gemini-3-flash-preview), ktory wymaga osobnego klucza Google
// -> swiezy build padal na starcie. Mecenas zmienia model jednym klikiem (Sonnet,
// Bielik lokalny itd.) jesli chce mocniejszy/zero-cloud.
export const DEFAULT_MODEL_ID = "openrouter/google/gemini-3-flash-preview";

export const ALLOWED_MODEL_IDS = new Set(MODELS.map((m) => m.id));

/**
 * Wycofane z listy id -> nastepca U TEGO SAMEGO dostawcy (2026-10-08). Bez tego
 * zapisany wybor mecenasa spoza listy spadal na DEFAULT_MODEL_ID, czyli po cichu na
 * innego dostawce. Lustro backendu: LEGACY_MODEL_ALIASES w lib/llm/models.ts
 * (tu dodatkowo slugi OpenRoutera, bo picker je pokazuje); zgodnosc pilnuje
 * backend/src/lib/llm/models-mirror.test.ts.
 */
export const LEGACY_MODEL_ALIASES: Readonly<Record<string, string>> = {
    "claude-opus-4-8": "claude-opus-5-5",
    "claude-opus-4-7": "claude-opus-5-5",
    "claude-sonnet-4-6": "claude-sonnet-5-5",
    "openrouter/anthropic/claude-opus-4.8": "openrouter/anthropic/claude-opus-5.5",
    "openrouter/anthropic/claude-sonnet-4.6": "openrouter/anthropic/claude-sonnet-5.5",
};

/** Id z listy albo jego nastepca; inaczej null (wolajacy bierze domyslny). */
export function dozwolonyModel(id: string | null | undefined): string | null {
    if (!id) return null;
    const n = LEGACY_MODEL_ALIASES[id] ?? id;
    return ALLOWED_MODEL_IDS.has(n) ? n : null;
}

const GROUP_ORDER: ModelGroup[] = [
    "Lokalny",
    "OpenRouter",
    "Anthropic",
    "Google",
    "OpenAI",
];

interface Props {
    value: string;
    onChange: (id: string) => void;
    apiKeys?: ApiKeyState;
}

export function ModelToggle({ value, onChange, apiKeys }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const selected = MODELS.find((m) => m.id === value);
    const selectedLabel = selected?.label ?? t("chat.modelLabel");
    const selectedAvailable = apiKeys
        ? isModelAvailable(value, apiKeys)
        : true;

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={`flex items-center gap-1 rounded-md px-1.5 h-6 text-[11px] transition-colors cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground ${isOpen ? "bg-accent text-foreground" : ""}`}
                    title={
                        !selectedAvailable
                            ? t("account.apiKeyMissing")
                            : t("chat.modelChoose")
                    }
                >
                    {!selectedAvailable && (
                        <AlertCircle className="h-3 w-3 shrink-0 text-bad" />
                    )}
                    <span className="max-w-[180px] truncate">{selectedLabel}</span>
                    <ChevronDown
                        className={`h-2.5 w-2.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 z-50" side="top" align="start">
                {GROUP_ORDER.map((group, gi) => {
                    const items = MODELS.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                        <div key={group}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                                {group}
                            </DropdownMenuLabel>
                            {items.map((m) => {
                                const available = apiKeys
                                    ? isModelAvailable(m.id, apiKeys)
                                    : true;
                                return (
                                    <DropdownMenuItem
                                        key={m.id}
                                        className="cursor-pointer"
                                        onSelect={() => onChange(m.id)}
                                    >
                                        <span
                                            className={`flex-1 ${available ? "" : "text-gray-400"}`}
                                        >
                                            {m.label}
                                        </span>
                                        {!available && (
                                            <AlertCircle
                                                className="h-3.5 w-3.5 text-bad ml-1"
                                                aria-label="API key missing"
                                            />
                                        )}
                                        {m.id === value && available && (
                                            <Check className="h-3.5 w-3.5 text-gray-600 ml-1" />
                                        )}
                                    </DropdownMenuItem>
                                );
                            })}
                        </div>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
