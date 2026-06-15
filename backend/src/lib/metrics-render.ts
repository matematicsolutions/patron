// Pure functions renderowania metryk w Prometheus exposition format (ADR-0037).
//
// Zero zaleznosci npm (prom-client celowo unikany per Konstytucja Art. 4).
// Format: text/plain wedlug Prometheus exposition format
// https://prometheus.io/docs/instrumenting/exposition_formats/#text-format-details
//
// Linie zaczynajace sie od # to komentarze HELP / TYPE. Linie metryk:
// `name{label="value",...} number\n`. Wartosci label musza miec escape "
// i \. Order metryk jest stabilny (alphabetical po name) dla
// deterministycznych snapshotow w testach.

export interface MetricsSnapshot {
    audit_log_by_event_type: Record<string, number>;
    merkle_root_count: number;
    merkle_last_anchor_seconds: number | null;
    mcp_security_by_action: {
        audit: number;
        human_review: number;
        denied: number;
    };
    uptime_seconds: number;
}

/**
 * Escape wartosci label zgodnie z Prometheus exposition format:
 * `\` -> `\\`, `"` -> `\"`, `\n` -> `\n` (literal).
 */
export function formatLabel(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
}

function metricLine(
    name: string,
    labels: Record<string, string>,
    value: number,
): string {
    const labelKeys = Object.keys(labels).sort();
    if (labelKeys.length === 0) {
        return `${name} ${value}`;
    }
    const labelStr = labelKeys
        .map((k) => `${k}="${formatLabel(labels[k]!)}"`)
        .join(",");
    return `${name}{${labelStr}} ${value}`;
}

/**
 * Renderuje pelen snapshot do Prometheus exposition format.
 * Konczenie znakiem `\n` (zgodne z protokolem - kazda linia EOL).
 */
export function renderPrometheus(snapshot: MetricsSnapshot): string {
    const lines: string[] = [];

    lines.push(
        "# HELP patron_audit_log_total Total audit_log entries by event_type since deployment",
    );
    lines.push("# TYPE patron_audit_log_total counter");
    const eventTypes = Object.keys(snapshot.audit_log_by_event_type).sort();
    for (const et of eventTypes) {
        lines.push(
            metricLine(
                "patron_audit_log_total",
                { event_type: et },
                snapshot.audit_log_by_event_type[et]!,
            ),
        );
    }

    lines.push("");
    lines.push("# HELP patron_merkle_root_count Total Merkle roots in audit_merkle_roots");
    lines.push("# TYPE patron_merkle_root_count gauge");
    lines.push(metricLine("patron_merkle_root_count", {}, snapshot.merkle_root_count));

    if (snapshot.merkle_last_anchor_seconds !== null) {
        lines.push("");
        lines.push(
            "# HELP patron_merkle_last_anchor_seconds Seconds since last Merkle root creation",
        );
        lines.push("# TYPE patron_merkle_last_anchor_seconds gauge");
        lines.push(
            metricLine(
                "patron_merkle_last_anchor_seconds",
                {},
                snapshot.merkle_last_anchor_seconds,
            ),
        );
    }

    lines.push("");
    lines.push(
        "# HELP patron_mcp_security_decisions_total MCP Security Gateway decisions by action",
    );
    lines.push("# TYPE patron_mcp_security_decisions_total counter");
    const actions: ReadonlyArray<keyof MetricsSnapshot["mcp_security_by_action"]> = [
        "audit",
        "denied",
        "human_review",
    ];
    for (const action of actions) {
        lines.push(
            metricLine(
                "patron_mcp_security_decisions_total",
                { action },
                snapshot.mcp_security_by_action[action],
            ),
        );
    }

    lines.push("");
    lines.push("# HELP patron_uptime_seconds Backend process uptime");
    lines.push("# TYPE patron_uptime_seconds gauge");
    lines.push(metricLine("patron_uptime_seconds", {}, snapshot.uptime_seconds));

    return lines.join("\n") + "\n";
}
