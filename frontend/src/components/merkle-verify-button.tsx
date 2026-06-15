// Button weryfikacji Merkle proof dla pojedynczego eventu (ADR-0046).
//
// Wywoluje GET /api/audit/merkle/verify/:eventId (ADR-0036). Pokazuje wynik
// z lucide ikona + skrocone proof preview (raw bundle do click-to-expand).

"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProofBundle {
    event_id: number;
    event_hash: string;
    proof: ReadonlyArray<{ sibling_hash: string; position: "left" | "right" }>;
    merkle_root: string;
    chain_block_start: number;
    chain_block_end: number;
}

type State =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "verified"; bundle: ProofBundle }
    | { kind: "failed"; error: string };

export interface MerkleVerifyButtonProps {
    eventId: number;
}

export function MerkleVerifyButton({ eventId }: MerkleVerifyButtonProps) {
    const [state, setState] = useState<State>({ kind: "idle" });
    const [expanded, setExpanded] = useState(false);

    async function handleVerify(): Promise<void> {
        setState({ kind: "loading" });
        try {
            const res = await fetch(`/api/audit/merkle/verify/${eventId}`, {
                credentials: "include",
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setState({
                    kind: "failed",
                    error: (body as { detail?: string }).detail ?? `HTTP ${res.status}`,
                });
                return;
            }
            const bundle = (await res.json()) as ProofBundle;
            setState({ kind: "verified", bundle });
        } catch (err) {
            setState({
                kind: "failed",
                error: err instanceof Error ? err.message : "unknown",
            });
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <Button
                    type="button"
                    onClick={handleVerify}
                    disabled={state.kind === "loading"}
                    variant="outline"
                >
                    {state.kind === "loading" ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Weryfikuje...</span>
                        </>
                    ) : state.kind === "verified" ? (
                        <>
                            <ShieldCheck className="h-4 w-4 text-emerald-600" />
                            <span>Zweryfikowano</span>
                        </>
                    ) : state.kind === "failed" ? (
                        <>
                            <ShieldAlert className="h-4 w-4 text-red-600" />
                            <span>Weryfikacja nieudana</span>
                        </>
                    ) : (
                        <span>Zweryfikuj Merkle proof</span>
                    )}
                </Button>

                {state.kind === "verified" && (
                    <button
                        type="button"
                        className="text-sm text-emerald-700 underline hover:no-underline"
                        onClick={() => setExpanded((v) => !v)}
                    >
                        {expanded ? "Ukryj" : "Pokaz"} bundle
                    </button>
                )}
            </div>

            {state.kind === "verified" && expanded && (
                <pre className="overflow-auto rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                    {JSON.stringify(state.bundle, null, 2)}
                </pre>
            )}

            {state.kind === "failed" && (
                <p className="text-sm text-red-700">{state.error}</p>
            )}
        </div>
    );
}
