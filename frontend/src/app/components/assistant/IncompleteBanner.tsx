// Odpowiedz przerwana limitem petli albo dlugosci (backend: StopReason,
// SSE / adnotacja "incomplete"). Bez tego baneru ucieta odpowiedz wyglada
// dokladnie jak pelna - a prawnik opiera sie na niej jak na pelnej.
import { t } from "@/i18n";
import type { PATRONIncompleteReason } from "../shared/types";

export function IncompleteBanner({ reason }: { reason?: PATRONIncompleteReason }) {
    if (!reason) return null;
    const tekst =
        reason === "max_tokens"
            ? t("chat.incompleteMaxTokens")
            : t("chat.incompleteMaxIterations");
    return (
        <div
            role="status"
            data-incomplete={reason}
            className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
            {tekst}
        </div>
    );
}
