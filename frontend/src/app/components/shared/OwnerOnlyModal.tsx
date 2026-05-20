"use client";

import { createPortal } from "react-dom";
import { Lock, X } from "lucide-react";
import { t } from "@/i18n";

interface Props {
    open: boolean;
    onClose: () => void;
    /** Naglowek modala, np. "Akcja zarezerwowana dla właściciela". */
    title?: string;
    /**
     * Akcja w bezokoliczniku po polsku (np. "usunąć ten czat"), wstawiana
     * po "Tylko właściciel może ...". Powinna byc juz zlokalizowana - patrz
     * `ownerOnly.action*` w pl.ts.
     */
    action?: string;
    /** Email wlasciciela zasobu - pokazany, by uzytkownik wiedzial kogo prosic. */
    ownerEmail?: string | null;
    /** Pelne nadpisanie tresci modala. */
    message?: string;
}

/**
 * Lekki modal "nie masz uprawnien" pokazywany gdy uzytkownik nie bedacy
 * wlascicielem probuje wykonac akcje owner-only (manage people, zmiana
 * nazwy, usuniecie, …) na wspoldzielonym zasobie. Zastepuje cisze 404
 * z backendu - dzieki temu uzytkownik wie, czemu akcja nie przeszla.
 */
export function OwnerOnlyModal({
    open,
    onClose,
    title,
    action,
    ownerEmail,
    message,
}: Props) {
    if (!open) return null;

    const resolvedTitle = title ?? t("ownerOnly.title");
    const body =
        message ??
        (action
            ? `${t("ownerOnly.bodyWithAction")} ${action}.`
            : t("ownerOnly.bodyGeneric"));

    return createPortal(
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 backdrop-blur-xs"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md rounded-2xl bg-white shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-2">
                    <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-amber-600" />
                        <h2 className="text-base font-medium text-gray-900">
                            {resolvedTitle}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="px-5 pb-2 pt-1">
                    <p className="text-sm text-gray-600 leading-relaxed">
                        {body}
                    </p>
                    {ownerEmail && (
                        <p className="mt-2 text-xs text-gray-400">
                            {t("ownerOnly.askForAccess")}{" "}
                            <span className="text-gray-600">{ownerEmail}</span>
                            {t("ownerOnly.ifNeedAccess")}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 px-5 pb-5 pt-3">
                    <button
                        onClick={onClose}
                        className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
