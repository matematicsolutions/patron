"use client";

import { useCallback } from "react";
import { generateChatTitle } from "@/app/lib/patronApi";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";

export function useGenerateChatTitle() {
    const { renameChat } = useChatHistoryContext();

    const generate = useCallback(
        async (chatId: string, message: string, model?: string | null): Promise<void> => {
            try {
                const { title } = await generateChatTitle(chatId, message, model);
                await renameChat(chatId, title);
            } catch {
                // best-effort — title generation should never break the chat
            }
        },
        [renameChat],
    );

    return { generate };
}
