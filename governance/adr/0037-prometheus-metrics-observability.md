# ADR-0037: Prometheus metrics endpoint i dashboard Grafana dla audit-Merkle chain

**Status**: PROPONOWANY (2026-05-27). Cherry-pick patternu monitoring/observability z `ai-infra-curriculum/ai-infra-engineer-learning` (MIT, mod-108 Prometheus/Grafana). Pattern, nie kod - implementacja wlasna Patronowa, zero nowych zaleznosci npm.

**Data**: 2026-05-27

**Powiazane zasady** (Konstytucja Patrona v1.2.9 -> v1.2.10):
- **Art. 3 - Audytowalnosc** (AI Act art. 12) - GLOWNA zasada. Metryki to telemetria pod sluzbe observability dla operatora kancelarii. Operator widzi w Grafanie czy hash-chain rosnie zgodnie z oczekiwaniem, czy Merkle anchor sie tworza, czy decyzje MCP Security gateway sa logowane. To **monitoring zdrowia warstwy audytowej**, nie sam audyt - audit_log pozostaje source-of-truth, metryki sa agregata dla dashboardu.
- **Art. 4 - Neutralnosc wobec dostawcow** - zero nowych npm zaleznosci. Prometheus exposition format (text/plain z liniami `name{labels} value`) jest **publicznym protokolem**, mozliwy do wygenerowania natywnym JavaScript bez biblioteki `prom-client`. Grafana / Prometheus nie sa requirement Patrona - operator wybiera swoje narzedzia scrapingu, my emitujemy w standardowym formacie.
- **Art. 1 - Lokalnosc danych** - metryki sa agregata (counters / gauges), nie zawieraja PII ani contentu eventow. Bezpieczne do scrapowania przez monitoring kancelarii.

**Powiazane ADR**:
- **ADR-0001** + **ADR-0026** - rodzice. Hash-chain i Merkle tree to obiekt monitorowany - metryki licza ich liczebnosc i fresh.
- **ADR-0025** + **ADR-0033** - rodzice. MCP Security Gateway decyzje (event_type `mcp_security.gateway`) licznikowane per akcja w metryce.
- **ADR-0036** - rodzic. Hybrid auto-trigger Merkle = metryka `patron_merkle_last_anchor_seconds` pokazuje czy interval (24h) nie zostal przekroczony.
- **ADR-0042** - rodzeństwo. UI banner pokazuje stan dla admin w Patronowym UI; metryki sa dla zewnetrznego stack monitoringu kancelarii (Prometheus + Grafana).
- **ADR-0044 (rezerwowane)** - alerting policy. Konkretne Grafana alert rules (np. `patron_merkle_last_anchor_seconds > 90000` = 25h bez anchor = alert) sa osobnym ADR.

---

## Problem

Patron loguje wszystko do `audit_log` z hash-chainem (ADR-0001) i tworzy Merkle roots (ADR-0026, 0036). Operator kancelarii chce widziec **trendy w czasie** bez kazdorazowego SQL do bazy:

- Ile nowych eventow w audit_log na godzine? (proxy aktywnosci uzytkownikow)
- Czy Merkle anchor sie tworza zgodnie z interval (1000 events lub 24h)?
- Czy MCP Security Gateway zarejestrowal `denied` lub `human_review` w ostatnich godzinach?
- Czy backend Express jest responsywny (latency request handler)?

Brak metryk = operator dowiaduje sie o problemach tylko gdy patrzy w UI banner (ADR-0042) lub czyta logi. Pattern z mod-108: scraping endpointu `/metrics`, monitoring stack (Prometheus + Grafana) per kancelaria, alerty wedlug rules.

---

## Decyzja

### A. Endpoint `GET /metrics` (Prometheus exposition format)

Nowy router `backend/src/routes/metrics.ts`. Endpoint zwraca text/plain w Prometheus exposition format:

```
# HELP patron_audit_log_total Total audit_log entries by event_type since deployment
# TYPE patron_audit_log_total counter
patron_audit_log_total{event_type="chat.message.user"} 12345
patron_audit_log_total{event_type="chat.message.assistant"} 12340
patron_audit_log_total{event_type="mcp_security.gateway"} 47
patron_audit_log_total{event_type="ring_policy.decision"} 12
patron_audit_log_total{event_type="input_security_scan"} 234
patron_audit_log_total{event_type="rodo.delete"} 0
patron_audit_log_total{event_type="rodo.export"} 0

# HELP patron_merkle_root_count Total Merkle roots in audit_merkle_roots
# TYPE patron_merkle_root_count gauge
patron_merkle_root_count 89

# HELP patron_merkle_last_anchor_seconds Seconds since last Merkle root creation
# TYPE patron_merkle_last_anchor_seconds gauge
patron_merkle_last_anchor_seconds 7200

# HELP patron_mcp_security_decisions_total MCP Security Gateway decisions by action
# TYPE patron_mcp_security_decisions_total counter
patron_mcp_security_decisions_total{action="audit"} 35
patron_mcp_security_decisions_total{action="human_review"} 8
patron_mcp_security_decisions_total{action="denied"} 4

# HELP patron_uptime_seconds Backend process uptime
# TYPE patron_uptime_seconds gauge
patron_uptime_seconds 86400
```

Authn: **IP whitelist** zamiast JWT. Prometheus scraping z monitoring stack kancelarii nie ma uzytkownika - whitelist IP w env `METRICS_ALLOWED_IPS` (CSV, np. `10.0.0.5,192.168.1.100`). Brak env = endpoint zwraca 404 (graceful disabled). Trzy powody dla IP zamiast JWT:
1. Prometheus scrapery standardowo nie obsluguja JWT auth - dodanie bedzie operacyjnym narzutem.
2. `/metrics` endpoint NIE zawiera PII ani contentu (tylko counters/gauges) - mniejsza powierzchnia ataku.
3. Zgodnie z konwencja branzowa (`/metrics` zwykle restricted siecia, nie tokenami).

### B. Pure functions w `backend/src/lib/metrics-render.ts`

```ts
export interface MetricsSnapshot {
    audit_log_by_event_type: Record<string, number>;
    merkle_root_count: number;
    merkle_last_anchor_seconds: number | null;
    mcp_security_by_action: Record<"audit" | "human_review" | "denied", number>;
    uptime_seconds: number;
}

export function renderPrometheus(snapshot: MetricsSnapshot): string;
export function formatLabel(value: string): string;  // escape ", \, \n
```

Pure functions, deterministyczne, testowalne. Renderowanie = string concatenation z proper escaping (Prometheus format wymaga escaping `\`, `"`, `\n` w label values).

### C. Dashboard Grafana JSON `governance/dashboards/patron-audit-observability.json`

Plik JSON z 4 panelami:
1. **Timeseries**: `rate(patron_audit_log_total[5m])` per event_type - wykres aktywnosci uzytkownikow w czasie
2. **Stat**: `patron_merkle_root_count` - aktualna liczba Merkle anchorow
3. **Gauge**: `patron_merkle_last_anchor_seconds` z thresholds (zielony < 86400, zolty 86400-90000, czerwony > 90000) - czas od ostatniego anchor
4. **Timeseries**: `patron_mcp_security_decisions_total` per action - decyzje gateway w czasie

Dashboard jest **wzorcem do importu** w Grafanie kancelarii - operator otwiera Grafana -> Import -> wkleja JSON -> dashboard widoczny. Patron NIE wymaga Grafana; dashboard to deliverable do dokumentacji operatora.

### D. Konstytucja v1.2.9 -> v1.2.10 PATCH

Bump PATCH - rozszerzenie zasady audytowalnosci o read-only `/metrics` endpoint. Brak nowych zaleznosci, brak zmiany schema, brak zmiany kontraktow innych endpointow.

### E. IP whitelist w `backend/src/middleware/metrics-allow.ts`

Middleware analogiczne do `requireAdmin` (ADR-0034) ale na poziomie IP req:

```ts
function isMetricsAllowed(req: Request): boolean {
    const raw = (process.env.METRICS_ALLOWED_IPS ?? "").trim();
    if (!raw) return false;
    const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const remoteIp = req.ip ?? req.socket.remoteAddress ?? "";
    return allowed.includes(remoteIp);
}
```

Pure function nad env + req. Brak env = wszystkie requesty 404 (endpoint disabled).

---

## Alternatywy odrzucone

1. **prom-client npm dependency**. Odrzucone: Konstytucja Art. 4 (neutralnosc, zero nowych deps gdy mozna unik). Prometheus exposition format to publiczny protokol tekstowy, natywne renderowanie 30 linii kodu.
2. **OpenTelemetry zamiast Prometheus**. Odrzucone: OTel wymaga collector w setup (Otel Collector lub Tempo/Jaeger), dla kancelarii to nadmiarowy stos. Prometheus = jeden scraper + Grafana, prostszy operacyjny model.
3. **JWT auth dla /metrics**. Odrzucone: branza standard to IP whitelist lub network isolation, Prometheus scrapery domyslnie nie maja konfiguracji JWT.
4. **Push gateway (Patron wysyla metryki do central)**. Odrzucone: Patron jest self-host single-tenant kancelarii, central monitoring lamie Konstytucja Art. 1 (lokalnosc).
5. **Metryki histogramow dla request latency**. Odrzucone w fazie 1: wymaga middleware na kazdym handler, dodaje overhead. Rezerwacja **ADR-0048** (latency observability gdy operator zglosi need).

---

## Bramki PRZED merge (wynik faktyczny)

- **14 testow `metrics-render.test.ts` pass** (vs target 5): 5x formatLabel (zwykly / quote / backslash / newline / combined), 9x renderPrometheus (sekcje / alfabetycznie / counter labels / gauge / merkle null / merkle non-null / mcp 3 akcje / EOL / pusty event_type).
- **6 testow `metrics-allow.test.ts` pass** (vs target 3): hit / miss / brak env / brak IP / env trim / empty entries.
- **TSC clean backend** (zero bledow).
- **Vitest backend pass**: 599/604 (+20 nowych vs baseline 579/584, 5 todo bez zmian, zero fail).
- **LoC dodanych**: ~700 (router 110 + metrics-render lib 130 + metrics-render test 145 + middleware 50 + middleware test 50 + ADR 130 + dashboard JSON 140 + konstytucja + env + THIRD_PARTY 30).
- **1 runda review tekstu ADR** (faktyczny scope review tekstu = 0 zarzutow w dokumencie po pisaniu z swiadomoscia lessons learned z ADR-0042 i ADR-0040: PATCH bump, jednoznaczne decyzje bez "lub", zero claimow bez kotwicy, ref do Konstytucji Art. 4 zamiast Art. 7).
- **Pre-public 6/6 grep clean**: zero wiki-links memory, zero persone Marko, zero internal slugi MateMatic, zero prywatnych sciezek, zero em-dash, polskie znaki w commit message zamienione.

## Co NIE jest w ADR-0037

- **Alerting rules** (Grafana / Alertmanager YAML) -> rezerwacja **ADR-0044**. Konkretne thresholds (np. anchor delay > 25h = warning, > 48h = critical) i kanaly (email/Slack/webhook) to osobny dokument.
- **Request latency histograms** -> rezerwacja **ADR-0048** (per-endpoint p50/p95/p99).
- **Distributed tracing** (Jaeger/Tempo span exports) -> NIE planowane dla self-host single-tenant; Patron to monolityczny Express, tracing przesadny.
- **Loki / log aggregation** -> NIE planowane; operator kancelarii ma `docker logs` plus audit_log dla compliance.

## Pochodzenie (atrybucja cherry-pick)

Pattern (Prometheus metrics endpoint + Grafana dashboard dla AI/ML system observability) cherry-pick z `ai-infra-curriculum/ai-infra-engineer-learning` (MIT, Copyright 2024 AI Infrastructure Learning), mod-108 (Monitoring and Observability). NIE kod, NIE dependency. Pattern adaptowany do specyfiki Patrona (audit chain monitoring zamiast LLM inference monitoring; zero-cloud single-tenant zamiast cloud-native multi-tenant).

Wpisane do `THIRD_PARTY_INSPIRATIONS.md` jako wektor #N (do uzupelnienia w commicie).
