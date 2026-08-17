"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    Blocks,
    Cloud,
    HardDrive,
    Loader2,
    ShieldCheck,
    Trash2,
    Upload,
    X,
} from "lucide-react";
import {
    listSkills,
    importSkill,
    setSkillEnabled,
    removeSkill,
    type SkillEntry,
    type SkillsList,
} from "@/app/lib/patronApi";
import { t } from "@/i18n";

interface Props {
    open: boolean;
    onClose: () => void;
}

function EgressBadge({ egress }: { egress: SkillEntry["egress"] }) {
    if (egress === "cloud-allowed") {
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                <Cloud className="h-3 w-3" />
                {t("skillLibrary.egressCloud")}
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
            <HardDrive className="h-3 w-3" />
            {t("skillLibrary.egressLocal")}
        </span>
    );
}

function SkillCard({
    skill,
    onToggle,
    onRemove,
    busy,
}: {
    skill: SkillEntry;
    onToggle?: (next: boolean) => void;
    onRemove?: () => void;
    busy: boolean;
}) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{skill.name}</span>
                        <span className="text-[11px] text-gray-400">v{skill.version}</span>
                        {skill.builtin && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">
                                <ShieldCheck className="h-3 w-3" />
                                {t("skillLibrary.builtinBadge")}
                            </span>
                        )}
                        <EgressBadge egress={skill.egress} />
                        {!skill.builtin && !skill.signed && (
                            <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500 ring-1 ring-gray-200">
                                {t("skillLibrary.unsigned")}
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{skill.description}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {skill.builtin ? (
                        <span className="text-[11px] text-gray-400">
                            {t("skillLibrary.alwaysOn")}
                        </span>
                    ) : (
                        <>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => onToggle?.(!skill.enabled)}
                                role="switch"
                                aria-checked={skill.enabled}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                                    skill.enabled ? "bg-emerald-500" : "bg-gray-300"
                                }`}
                                title={
                                    skill.enabled
                                        ? t("skillLibrary.enabledLabel")
                                        : t("skillLibrary.disabledLabel")
                                }
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                        skill.enabled ? "translate-x-4" : "translate-x-0.5"
                                    }`}
                                />
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={onRemove}
                                className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
                                title={t("skillLibrary.remove")}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export function SkillLibraryPanel({ open, onClose }: Props) {
    const [data, setData] = useState<SkillsList | null>(null);
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await listSkills());
        } catch {
            setError(t("skillLibrary.loadError"));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) void reload();
    }, [open, reload]);

    const handleToggle = async (skill: SkillEntry, next: boolean) => {
        // Twarda zgoda egress po stronie UI (lustro bramki backendu): wlaczenie
        // skilla mogacego wysylac do chmury wymaga swiadomej decyzji mecenasa.
        let confirmEgress: boolean | undefined;
        if (next && skill.egress === "cloud-allowed") {
            if (!window.confirm(t("skillLibrary.egressConfirm"))) return;
            confirmEgress = true;
        }
        setBusyId(skill.id);
        setError(null);
        try {
            await setSkillEnabled(skill.id, next, confirmEgress);
            await reload();
        } catch {
            setError(t("skillLibrary.toggleError"));
        } finally {
            setBusyId(null);
        }
    };

    const handleRemove = async (skill: SkillEntry) => {
        if (!window.confirm(t("skillLibrary.removeConfirm"))) return;
        setBusyId(skill.id);
        setError(null);
        try {
            await removeSkill(skill.id);
            await reload();
        } catch {
            setError(t("skillLibrary.removeError"));
        } finally {
            setBusyId(null);
        }
    };

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (e.target) e.target.value = ""; // pozwol ponownie wybrac ten sam plik
        if (!file) return;
        setImporting(true);
        setError(null);
        try {
            const raw = JSON.parse(await file.text());
            // Plik moze zawierac sam manifest albo opakowanie { manifest }.
            const manifest =
                raw && typeof raw === "object" && "manifest" in raw
                    ? (raw as { manifest: unknown }).manifest
                    : raw;
            await importSkill(manifest);
            await reload();
        } catch (err) {
            const msg = err instanceof Error ? err.message : "";
            setError(msg || t("skillLibrary.importError"));
        } finally {
            setImporting(false);
        }
    };

    if (!open || typeof document === "undefined") return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
                {/* Naglowek */}
                <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-lg bg-gray-900 p-2 text-white">
                            <Blocks className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-serif text-gray-900">
                                {t("skillLibrary.title")}
                            </h2>
                            <p className="mt-0.5 text-sm text-gray-500">
                                {t("skillLibrary.subtitle")}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Tresc */}
                <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
                    {error && (
                        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                            {error}
                        </div>
                    )}

                    {loading && !data ? (
                        <div className="flex items-center justify-center py-10 text-gray-400">
                            <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                    ) : (
                        <>
                            <section>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                                    {t("skillLibrary.builtinSection")}
                                </h3>
                                <div className="space-y-2">
                                    {data?.builtin.map((s) => (
                                        <SkillCard key={s.id} skill={s} busy={false} />
                                    ))}
                                </div>
                            </section>

                            <section>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                                    {t("skillLibrary.installedSection")}
                                </h3>
                                {data && data.installed.length > 0 ? (
                                    <div className="space-y-2">
                                        {data.installed.map((s) => (
                                            <SkillCard
                                                key={s.id}
                                                skill={s}
                                                busy={busyId === s.id}
                                                onToggle={(next) => handleToggle(s, next)}
                                                onRemove={() => handleRemove(s)}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400">
                                        {t("skillLibrary.empty")}
                                    </p>
                                )}
                            </section>
                        </>
                    )}
                </div>

                {/* Stopka - import */}
                <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-6 py-3">
                    <p className="text-[11px] text-gray-400">
                        {t("skillLibrary.importHint")}
                    </p>
                    <button
                        type="button"
                        disabled={importing}
                        onClick={() => fileRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                        {importing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Upload className="h-4 w-4" />
                        )}
                        {importing
                            ? t("skillLibrary.importing")
                            : t("skillLibrary.import")}
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={handleFile}
                    />
                </div>
            </div>
        </div>,
        document.body,
    );
}
