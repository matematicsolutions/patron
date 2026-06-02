"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { PATRONIcon } from "@/components/chat/patron-icon";
import { Blocks, FolderOpen } from "lucide-react";
import { ChatInput } from "./ChatInput";
import { SelectAssistantProjectModal } from "./SelectAssistantProjectModal";
import { FolderIngestModal } from "./FolderIngestModal";
import { SkillLibraryPanel } from "./SkillLibraryPanel";
import type { PATRONMessage } from "../shared/types";
import { t } from "@/i18n";

interface InitialViewProps {
    onSubmit: (message: PATRONMessage) => void;
}

const ICON_SIZE = 35;
const GAP = 16; // gap-4 = 1rem = 16px

export function InitialView({ onSubmit }: InitialViewProps) {
    const { user } = useAuth();
    const { profile } = useUserProfile();
    const [loaded, setLoaded] = useState(false);
    const [projectModalOpen, setProjectModalOpen] = useState(false);
    const [folderIngestOpen, setFolderIngestOpen] = useState(false);
    const [skillsOpen, setSkillsOpen] = useState(false);
    const [iconOffset, setIconOffset] = useState(0);
    const [textOffset, setTextOffset] = useState(0);
    const textRef = useRef<HTMLHeadingElement>(null);

    const username =
        profile?.displayName?.trim() ||
        user?.email?.split("@")[0] ||
        t("chat.greetingFallback");

    useLayoutEffect(() => {
        if (!profile || !textRef.current) return;
        const h1Width = textRef.current.offsetWidth;
        setIconOffset((h1Width + GAP) / 2);
        setTextOffset((ICON_SIZE + GAP) / 2);
    }, [profile]);

    useEffect(() => {
        if (!iconOffset) return;
        const t = setTimeout(() => setLoaded(true), 100);
        return () => clearTimeout(t);
    }, [iconOffset]);

    return (
        <div className="flex flex-col h-full w-full px-6">
            <div className="flex-1 flex flex-col items-center justify-center">
                <div className="flex-col items-center w-full max-w-4xl relative px-0 xl:px-8">
                    <div className="mb-10 relative flex items-center justify-center" style={{ minHeight: "45px" }}>
                        <div
                            className="absolute h-[35px]"
                            style={{
                                left: "50%",
                                transform: loaded
                                    ? `translateX(calc(-50% - ${iconOffset}px))`
                                    : "translateX(-50%)",
                                transition:
                                    "transform 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                            }}
                        >
                            <PATRONIcon size={ICON_SIZE} />
                        </div>
                        <div
                            className="absolute"
                            style={{
                                left: "50%",
                                transform: loaded
                                    ? `translateX(calc(-50% + ${textOffset}px))`
                                    : "translateX(-50%)",
                                opacity: loaded ? 1 : 0,
                                transition:
                                    "transform 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 800ms ease-in-out 300ms",
                                maxWidth: "min(600px, calc(100vw - 6rem))",
                            }}
                        >
                            <h1
                                ref={textRef}
                                className="text-4xl font-serif font-light text-bordeaux whitespace-nowrap overflow-hidden text-ellipsis tracking-[0.01em]"
                            >
                                {t("chat.greetingPrefix")}, {username}
                            </h1>
                        </div>
                    </div>

                    <ChatInput
                        onSubmit={onSubmit}
                        onCancel={() => {}}
                        isLoading={false}
                        onProjectsClick={() => setProjectModalOpen(true)}
                    />

                    {/* Starter-chipy: zaproszenie dla nowego mecenasa, by zagadał
                        o funkcje. Etykieta w glosie PATRONa (gospodarz); klik
                        wysyla pytanie w intencji mecenasa (label != tresc). */}
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                        {[
                            {
                                label: t("chat.starterHelp"),
                                query: t("chat.starterHelpSend"),
                            },
                            {
                                label: t("chat.starterAnalyze"),
                                query: t("chat.starterAnalyze"),
                            },
                            {
                                label: t("chat.starterImport"),
                                query: t("chat.starterImport"),
                            },
                            {
                                label: t("chat.starterShowcase"),
                                query: t("chat.starterShowcaseSend"),
                            },
                        ].map(({ label, query }) => (
                            <button
                                key={label}
                                type="button"
                                onClick={() =>
                                    onSubmit({ role: "user", content: query })
                                }
                                className="rounded-full border border-border/70 bg-card/40 px-3.5 py-1.5 text-xs text-muted-foreground transition-all hover:border-bordeaux/40 hover:text-bordeaux hover:bg-card active:scale-[0.97]"
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="text-center">
                        <button
                            onClick={() => setFolderIngestOpen(true)}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                        >
                            <FolderOpen className="h-3.5 w-3.5" />
                            {t("folderIngest.open")}
                        </button>
                        <button
                            onClick={() => setSkillsOpen(true)}
                            className="mt-3 ml-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                        >
                            <Blocks className="h-3.5 w-3.5" />
                            {t("skillLibrary.open")}
                        </button>
                        <p className="text-xs py-3 mb-3 text-gray-500">
                            {t("chat.legalDisclaimer")}
                        </p>
                    </div>
                </div>
            </div>

            <SelectAssistantProjectModal
                open={projectModalOpen}
                onClose={() => setProjectModalOpen(false)}
            />
            <FolderIngestModal
                open={folderIngestOpen}
                onClose={() => setFolderIngestOpen(false)}
            />
            <SkillLibraryPanel
                open={skillsOpen}
                onClose={() => setSkillsOpen(false)}
            />
        </div>
    );
}
