# mcp-security - skan definicji konektorow MCP przed wpieciem w kontrakt

Deterministyczny, lokalny (zero-LLM, zero-cloud) skan definicji konektorow MCP
**zanim** zostana zaladowane do kontraktu Patrona. Wykrywa typosquat (namespace
phishing), drift (zmiane opisu narzedzia od poprzedniego loadu), hidden-instructions
(jailbreak via tool description) i tool-poisoning (zaden o uprawnienia spoza
inputSchema).

Decyzja architektoniczna: [governance/adr/0025-mcp-security-gateway-wdrazenie.md](../../../../governance/adr/0025-mcp-security-gateway-wdrazenie.md).

## Status

**Skeleton (ADR-0025).** NIE wpiety w startup backendu / `scripts/bundle-mcp.cjs` -
wpiecie w istniejacy kontrakt to osobna decyzja (przyszly ADR-0028, kontrakt Art. 8
Konstytucji). Modul jest bezstanowa, czysta funkcja - gotowy do integracji i testow.

## Uzycie

```ts
import {
    scanMcpRegistry,
    buildScanContext,
    type McpServerDefinition,
} from "./lib/mcp-security";

const servers: McpServerDefinition[] = [
    {
        name: "saos",
        transport: "stdio",
        command: "node",
        args: ["/path/to/saos-mcp-server/dist/index.js"],
        tools: [
            {
                name: "search_orzeczenia",
                description: "Wyszukuje orzeczenia w SAOS po sygnaturze lub frazie.",
                inputSchema: { type: "object", properties: { query: { type: "string" } } },
            },
        ],
    },
    // ...
];

// Baseline z poprzedniego loadu (puste = pierwszy load wszystkiego)
const driftBaseline = new Map<string, string>();

const context = buildScanContext(driftBaseline);
const report = scanMcpRegistry(servers, context);

switch (report.overallAction) {
    case "allowed":       /* wpinaj normalnie */ break;
    case "audit":         /* wpinaj, ale zarejestruj findings w audit log */ break;
    case "human_review":  /* skieruj raport do Operatora, NIE wpinaj automatycznie */ break;
    case "denied":        /* blokuj start backendu */ break;
}
```

## Pochodzenie (atrybucja cherry-pick)

Pattern (MCP Security Gateway - taksonomia 4 detektorow, scan przed zaladowaniem
do kontraktu) **cherry-picked** z
[microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit)
(`MIT`, Microsoft Corporation, snapshot pushedAt `2026-05-24T17:02:19Z`, 1904 star,
OpenSSF Best Practices project 12085, audyt RODO `agent-governance-claude-code`
v3.6.0 = 🟢 ZIELONY, patrz `memory/audit_agent_governance_claude_code_2026-05-24.md`).

Pelna atrybucja w [THIRD_PARTY_INSPIRATIONS.md](../../../../THIRD_PARTY_INSPIRATIONS.md).

**Co jest wzorcem (z Microsoft AGT)**:
- Taksonomia 4 detektorow (typosquat, drift, hidden-instructions, tool-poisoning).
- Pojecie "scan przed zaladowaniem do kontraktu" (gate przed wpieciem).
- Decyzja allow/deny w runtime z fail-closed semantics.

**Co jest NASZE (wziete z input-security ADR-0019 + napisane od zera)**:
- 5-fazowy orchestrator (`scanMcpRegistry()`) - wzorzec wewnetrzny Patrona.
- 4 stany akcji (`allowed`/`audit`/`human_review`/`denied`) - spojne z input-security.
- Polski + angielski korpus wzorcow w hidden-instructions i tool-poisoning.
- Lista 6 zatwierdzonych konektorow Patrona jako baseline typosquat.
- Hash SHA256 z (server.name + tools[].name + tools[].description) jako drift fingerprint.

## Struktura

```
mcp-security/
  types.ts                              - definicje typow
  detectors/
    typosquat.ts                        - Levenshtein vs lista zatwierdzonych
    drift.ts                            - SHA256 hash vs baseline
    hidden-instructions.ts              - jailbreak patterns w opisach (PL+EN)
    tool-poisoning.ts                   - permission expansion + schema mismatch
  scorer.ts                             - calculateRiskScore, decideAction
  report.ts                             - buildReport (agregat per rejestr)
  pipeline.ts                           - scanMcpServer, scanMcpRegistry, buildScanContext
  index.ts                              - barrel export
  mcp-security.test.ts                  - testy vitest dla detektorow i pipeline
  README.md                             - ten plik
```

## Zalecenia integracyjne (do ADR-0028)

1. **Baseline drift trzymany poza repo** - `~/.patron/mcp-drift-baseline.json` (per
   instalacja). NIE commitowac. Pierwsze ladowanie kazdego konektora tworzy wpis.
2. **Decyzja `human_review` wymaga UI dla Operatora** - dorobic w ADR-0028.
   Skeleton zwraca raport, ale to wywolujacy ADR-0028 decyduje co z nim zrobic
   (UI, console alert, mail).
3. **Audit log** - kazda decyzja Gateway'a powinna trafic do hash-chain audit
   Patrona (ADR-0001) z eventem `mcp_security.gateway` i polami serverName,
   action, riskScore.
