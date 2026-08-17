// US5 / ADR-0093: testy czystej logiki cost-cap + buildera audytu cost_cap.

import { describe, it, expect } from "vitest";
import { evaluateBudget } from "./budget";
import { buildCostCapEvent } from "./auditCostCap";

describe("evaluateBudget (US5 / ADR-0093)", () => {
    it("cap wylaczony (null) -> allow, capActive false", () => {
        const d = evaluateBudget({ capUsd: null, spentUsd: 999, override: false });
        expect(d.capActive).toBe(false);
        expect(d.exceeded).toBe(false);
        expect(d.action).toBe("allow");
    });

    it("ponizej progu -> allow", () => {
        const d = evaluateBudget({ capUsd: 2, spentUsd: 1.5, override: false });
        expect(d.capActive).toBe(true);
        expect(d.exceeded).toBe(false);
        expect(d.action).toBe("allow");
    });

    it("rowno na progu -> exceeded (>=), block bez override", () => {
        const d = evaluateBudget({ capUsd: 2, spentUsd: 2, override: false });
        expect(d.exceeded).toBe(true);
        expect(d.action).toBe("block");
    });

    it("powyzej progu bez override -> block", () => {
        const d = evaluateBudget({ capUsd: 2, spentUsd: 2.4, override: false });
        expect(d.action).toBe("block");
    });

    it("powyzej progu z override -> override (operator swiadomie kontynuuje)", () => {
        const d = evaluateBudget({ capUsd: 2, spentUsd: 5, override: true });
        expect(d.exceeded).toBe(true);
        expect(d.action).toBe("override");
    });

    it("override ponizej progu nie zmienia allow", () => {
        const d = evaluateBudget({ capUsd: 2, spentUsd: 0.1, override: true });
        expect(d.action).toBe("allow");
    });
});

describe("buildCostCapEvent (US5 / ADR-0093)", () => {
    it("buduje zdarzenie cost_cap z metadanymi budzetu (bez tresci)", () => {
        const ev = buildCostCapEvent({
            actorUserId: "u-1",
            caseId: "case-1",
            model: "openrouter/mistralai/mistral-large",
            spentUsd: 2.5,
            capUsd: 2,
            action: "block",
        });
        expect(ev.event_type).toBe("cost_cap");
        expect(ev.actor_user_id).toBe("u-1");
        expect(ev.payload).toMatchObject({
            case_id: "case-1",
            cap_usd: 2,
            spent_usd: 2.5,
            action: "block",
            model: "openrouter/mistralai/mistral-large",
        });
    });

    it("action override jest zachowane w payload", () => {
        const ev = buildCostCapEvent({
            actorUserId: null,
            caseId: "case-2",
            model: "gpt-5.5",
            spentUsd: 10,
            capUsd: 2,
            action: "override",
        });
        expect((ev.payload as { action: string }).action).toBe("override");
        expect(ev.actor_user_id).toBeNull();
    });
});
