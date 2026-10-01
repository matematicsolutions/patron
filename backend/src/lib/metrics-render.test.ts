// Testy pure functions renderowania metryk Prometheus (ADR-0037).

import { describe, expect, it } from "vitest";

import {
    formatLabel,
    renderPrometheus,
    type MetricsSnapshot,
} from "./metrics-render";

describe("formatLabel", () => {
    it("zwykly tekst bez zmiany", () => {
        expect(formatLabel("simple")).toBe("simple");
    });

    it('escapuje cudzyslowy', () => {
        expect(formatLabel('value with "quotes"')).toBe('value with \\"quotes\\"');
    });

    it("escapuje backslash", () => {
        expect(formatLabel("path\\to\\file")).toBe("path\\\\to\\\\file");
    });

    it("escapuje newline na literal \\n", () => {
        expect(formatLabel("line1\nline2")).toBe("line1\\nline2");
    });

    it("escape combined: backslash + quote + newline", () => {
        expect(formatLabel('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd');
    });
});

describe("renderPrometheus", () => {
    function makeSnapshot(overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
        return {
            degraded: false,
            audit_log_by_event_type: {
                "chat.message.user": 100,
                "chat.message.assistant": 95,
                "mcp_security.gateway": 5,
            },
            merkle_root_count: 10,
            merkle_last_anchor_seconds: 3600,
            mcp_security_by_action: { audit: 3, human_review: 1, denied: 1 },
            uptime_seconds: 86400,
            ...overrides,
        };
    }

    it("renderuje wszystkie sekcje HELP/TYPE/wartosci", () => {
        const out = renderPrometheus(makeSnapshot());
        expect(out).toContain("# HELP patron_audit_log_total");
        expect(out).toContain("# TYPE patron_audit_log_total counter");
        expect(out).toContain("# HELP patron_merkle_root_count");
        expect(out).toContain("# TYPE patron_merkle_root_count gauge");
        expect(out).toContain("# HELP patron_mcp_security_decisions_total");
        expect(out).toContain("# HELP patron_uptime_seconds");
    });

    it("event_type alfabetycznie - deterministyczna kolejnosc", () => {
        const out = renderPrometheus(makeSnapshot());
        const assistantIdx = out.indexOf("event_type=\"chat.message.assistant\"");
        const userIdx = out.indexOf("event_type=\"chat.message.user\"");
        const mcpIdx = out.indexOf("event_type=\"mcp_security.gateway\"");
        expect(assistantIdx).toBeLessThan(userIdx);
        expect(userIdx).toBeLessThan(mcpIdx);
    });

    it("renderuje counter z labelami", () => {
        const out = renderPrometheus(makeSnapshot());
        expect(out).toContain(
            'patron_audit_log_total{event_type="chat.message.user"} 100',
        );
        expect(out).toContain(
            'patron_audit_log_total{event_type="mcp_security.gateway"} 5',
        );
    });

    it("renderuje gauge bez labeli", () => {
        const out = renderPrometheus(makeSnapshot());
        expect(out).toContain("patron_merkle_root_count 10");
        expect(out).toContain("patron_uptime_seconds 86400");
    });

    it("pomija patron_merkle_last_anchor_seconds gdy null (brak rootow)", () => {
        const out = renderPrometheus(makeSnapshot({ merkle_last_anchor_seconds: null }));
        expect(out).not.toContain("patron_merkle_last_anchor_seconds");
    });

    it("renderuje merkle_last_anchor gdy nie null", () => {
        const out = renderPrometheus(makeSnapshot({ merkle_last_anchor_seconds: 7200 }));
        expect(out).toContain("patron_merkle_last_anchor_seconds 7200");
    });

    it("mcp_security_decisions: 3 akcje w kolejnosci audit/denied/human_review", () => {
        const out = renderPrometheus(makeSnapshot());
        const auditIdx = out.indexOf('action="audit"');
        const deniedIdx = out.indexOf('action="denied"');
        const hrIdx = out.indexOf('action="human_review"');
        expect(auditIdx).toBeGreaterThan(0);
        expect(deniedIdx).toBeGreaterThan(0);
        expect(hrIdx).toBeGreaterThan(0);
        expect(auditIdx).toBeLessThan(deniedIdx);
        expect(deniedIdx).toBeLessThan(hrIdx);
    });

    it("output konczy sie nowa linia (Prometheus protocol)", () => {
        const out = renderPrometheus(makeSnapshot());
        expect(out.endsWith("\n")).toBe(true);
    });

    it("pusty audit_log_by_event_type -> nie ma metryk per event_type, ale HELP/TYPE sa", () => {
        const out = renderPrometheus(makeSnapshot({ audit_log_by_event_type: {} }));
        expect(out).toContain("# HELP patron_audit_log_total");
        expect(out).toContain("# TYPE patron_audit_log_total counter");
        expect(out).not.toContain("patron_audit_log_total{");
    });

    // Do 2026-09-02 zepsuty odczyt zrodel renderowal sie znak w znak
    // tak samo jak swieza instalacja z pustym dziennikiem: same zera, HTTP 200,
    // zero sladu w logu. Ponizsze asercje sa mianownikiem trojstanu -
    // sprawdzaja, ze te dwa stany daja ROZNY tekst.
    it("degraded=1 odroznia zepsuty odczyt od swiezej instalacji", () => {
        const zera = {
            audit_log_by_event_type: Object.fromEntries(
                Object.keys(makeSnapshot().audit_log_by_event_type).map((et) => [
                    et,
                    0,
                ]),
            ),
            merkle_root_count: 0,
            merkle_last_anchor_seconds: null,
            mcp_security_by_action: { audit: 0, human_review: 0, denied: 0 },
        };
        const swieza = renderPrometheus(
            makeSnapshot({ ...zera, degraded: false }),
        );
        const zepsuty = renderPrometheus(
            makeSnapshot({ ...zera, degraded: true }),
        );

        expect(swieza).toContain("patron_metrics_degraded 0");
        expect(zepsuty).toContain("patron_metrics_degraded 1");
        expect(
            swieza,
            "swieza instalacja i zepsuty odczyt renderuja sie identycznie - " +
                "sygnal degradacji nie niesie zadnej informacji",
        ).not.toEqual(zepsuty);
    });

    it("patron_metrics_degraded jest ZAWSZE w wyjsciu - takze przy 0", () => {
        // Metryka obecna wylacznie w awarii znika razem ze zdolnoscia jej
        // wyrenderowania: alert `== 1` nie odpali na czyms, czego nie ma.
        const out = renderPrometheus(makeSnapshot({ degraded: false }));
        expect(out).toContain("# HELP patron_metrics_degraded");
        expect(out).toContain("# TYPE patron_metrics_degraded gauge");
        expect(out).toContain("patron_metrics_degraded 0");
    });
});
