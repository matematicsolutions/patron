"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, ChevronDown, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUserProfile } from "@/contexts/UserProfileContext";
import type { ApiKeyState } from "@/app/lib/mikeApi";
import { MODELS } from "@/app/components/assistant/ModelToggle";
import {
    isModelAvailable,
    modelGroupToProvider,
    providerLabel,
} from "@/app/lib/modelAvailability";
import { t, type TranslationKey } from "@/i18n";

// Etykiety pol pobierane przez t() w komponencie - tu trzymamy tylko
// staly wzor (provider + klucz tlumaczenia + placeholder).
const API_KEY_FIELDS: ReadonlyArray<{
    provider: "claude" | "gemini" | "openai";
    labelKey: TranslationKey;
    placeholder: string;
}> = [
    {
        provider: "claude",
        labelKey: "models.anthropicKeyLabel",
        placeholder: "sk-ant-…",
    },
    {
        provider: "gemini",
        labelKey: "models.googleKeyLabel",
        placeholder: "AI…",
    },
    {
        provider: "openai",
        labelKey: "models.openaiKeyLabel",
        placeholder: "sk-…",
    },
];

export default function ModelsAndApiKeysPage() {
    const { profile, updateModelPreference, updateApiKey } = useUserProfile();

    return (
        <div className="space-y-4">
            {/* Model Preferences */}
            <div className="pb-6">
                <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-2xl font-medium font-serif">
                        {t("models.modelPreferences")}
                    </h2>
                </div>
                <div className="space-y-4 max-w-md">
                    <div>
                        <label className="text-sm text-gray-600 block mb-2">
                            {t("models.tabularModel")}
                        </label>
                        <p className="text-xs text-gray-400 mb-2">
                            {t("models.tabularModelHint")}
                        </p>
                        <TabularModelDropdown
                            value={
                                profile?.tabularModel ??
                                "gemini-3-flash-preview"
                            }
                            apiKeys={profile?.apiKeys}
                            onChange={(id) =>
                                updateModelPreference("tabularModel", id)
                            }
                        />
                    </div>
                </div>
            </div>

            {/* API Keys */}
            <div className="py-6">
                <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-2xl font-medium font-serif">
                        {t("models.keysTitle")}
                    </h2>
                </div>
                <p className="text-sm text-gray-500 mb-4 max-w-xl">
                    {t("models.keysNote")}
                </p>
                <p className="text-xs text-gray-400 mb-4 max-w-xl">
                    {t("models.keysTitleGenHint")}
                </p>
                <div className="space-y-4 max-w-xl">
                    {API_KEY_FIELDS.map((field) => (
                        <ApiKeyField
                            key={field.provider}
                            label={t(field.labelKey)}
                            placeholder={field.placeholder}
                            hasSavedKey={
                                !!profile?.apiKeys[field.provider].configured
                            }
                            isServerConfigured={
                                profile?.apiKeys[field.provider].source ===
                                "env"
                            }
                            onSave={(value) =>
                                updateApiKey(
                                    field.provider,
                                    value.trim() || null,
                                )
                            }
                            onRemove={() =>
                                updateApiKey(field.provider, null)
                            }
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function TabularModelDropdown({
    value,
    onChange,
    apiKeys,
}: {
    value: string;
    onChange: (id: string) => void;
    apiKeys?: ApiKeyState;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const selected = MODELS.find((m) => m.id === value);
    const selectedAvailable = apiKeys ? isModelAvailable(value, apiKeys) : true;
    const groups: ("Anthropic" | "Google" | "OpenAI")[] = [
        "Anthropic",
        "Google",
        "OpenAI",
    ];

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm flex items-center justify-between gap-2 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black/10"
                >
                    <span className="flex items-center gap-2 min-w-0">
                        {!selectedAvailable && (
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        )}
                        <span className="truncate text-gray-900">
                            {selected?.label ?? t("models.selectModel")}
                        </span>
                    </span>
                    <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="z-50"
                style={{ width: "var(--radix-dropdown-menu-trigger-width)" }}
                align="start"
            >
                {groups.map((group, gi) => {
                    const items = MODELS.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                        <div key={group}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                                {group}
                            </DropdownMenuLabel>
                            {items.map((m) => {
                                const provider = modelGroupToProvider(m.group);
                                const available = apiKeys
                                    ? isModelAvailable(m.id, apiKeys)
                                    : true;
                                return (
                                    <DropdownMenuItem
                                        key={m.id}
                                        className="cursor-pointer"
                                        onSelect={() => onChange(m.id)}
                                        title={
                                            !available
                                                ? `${t("models.addKeyToUseHint")} (${providerLabel(provider)})`
                                                : undefined
                                        }
                                    >
                                        <span
                                            className={`flex-1 ${available ? "" : "text-gray-400"}`}
                                        >
                                            {m.label}
                                        </span>
                                        {!available && (
                                            <AlertCircle className="h-3.5 w-3.5 text-red-500 ml-1" />
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

function ApiKeyField({
    label,
    placeholder,
    hasSavedKey,
    isServerConfigured,
    onSave,
    onRemove,
}: {
    label: string;
    placeholder: string;
    hasSavedKey: boolean;
    isServerConfigured: boolean;
    onSave: (value: string) => Promise<boolean>;
    onRemove: () => Promise<boolean>;
}) {
    const [value, setValue] = useState("");
    const [reveal, setReveal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        setValue("");
    }, [hasSavedKey]);

    const dirty = value.trim().length > 0;

    const handleSave = async () => {
        setIsSaving(true);
        const ok = await onSave(value);
        setIsSaving(false);
        if (ok) {
            setValue("");
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } else {
            alert(`${t("models.failedSaveKey")} (${label})`);
        }
    };

    const handleRemove = async () => {
        setIsSaving(true);
        const ok = await onRemove();
        setIsSaving(false);
        if (!ok) alert(`${t("models.failedRemoveKey")} (${label})`);
    };

    return (
        <div>
            <label className="text-sm text-gray-600 block mb-2">{label}</label>
            {isServerConfigured && (
                <div className="mb-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2">
                    <p className="text-xs text-blue-800">
                        {t("models.serverKeyConfigured")}
                    </p>
                    {hasSavedKey && (
                        <p className="mt-1 text-xs text-blue-800">
                            {t("models.serverKeyWillBeUsed")}
                        </p>
                    )}
                </div>
            )}
            {hasSavedKey && !isServerConfigured && (
                <p className="text-xs text-gray-500 mb-2">
                    {t("models.pasteNewKeyToReplace")}
                </p>
            )}
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Input
                        type={reveal ? "text" : "password"}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={
                            isServerConfigured
                                ? t("models.serverKeyPlaceholder")
                                : hasSavedKey
                                  ? t("models.savedKeyHidden")
                                  : placeholder
                        }
                        className="pr-10"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={isServerConfigured}
                    />
                    <button
                        type="button"
                        onClick={() => setReveal((r) => !r)}
                        disabled={isServerConfigured}
                        className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={reveal ? t("models.hideKey") : t("models.showKey")}
                    >
                        {reveal ? (
                            <EyeOff className="h-4 w-4" />
                        ) : (
                            <Eye className="h-4 w-4" />
                        )}
                    </button>
                </div>
                <Button
                    onClick={handleSave}
                    disabled={isServerConfigured || isSaving || !dirty || saved}
                    className="min-w-[80px] transition-all bg-black hover:bg-gray-900 text-white"
                >
                    {isSaving ? (
                        t("account.saving")
                    ) : saved ? (
                        <>
                            <Check className="h-4 w-3" />
                            {t("account.saved")}
                        </>
                    ) : (
                        t("common.save")
                    )}
                </Button>
                {hasSavedKey && !isServerConfigured && (
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleRemove}
                        disabled={isSaving}
                    >
                        {t("models.remove")}
                    </Button>
                )}
            </div>
        </div>
    );
}
