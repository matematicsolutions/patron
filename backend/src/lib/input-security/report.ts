// Generator raportu skanu - czytelne dla czlowieka podsumowanie + zalecenia
// per rola governance. Raport jest bezpieczny do zalogowania (evidence
// znalezisk jest skrocone, nie zawiera calej tresci dokumentu).

import type {
    SecurityAction,
    SecurityFinding,
    SecurityScanResult,
    ThreatLevel,
} from "./types";

function generateReportId(): string {
    const rand = Math.random().toString(36).slice(2, 9).toUpperCase();
    return `ISEC-${Date.now()}-${rand}`;
}

const ACTION_SUMMARY: Record<SecurityAction, string> = {
    allowed: "Brak istotnych zagrozen - tresc moze przejsc do modelu.",
    quarantined:
        "Wykryto sygnaly sredniego ryzyka - przed dalszym przetwarzaniem zastosuj redakcje lub odrzuc podejrzana warstwe.",
    human_review:
        "Wykryto sygnaly wysokiego ryzyka - decyzje podejmuje czlowiek (Inspektor/Operator). Tresc NIE idzie automatycznie do modelu.",
    blocked:
        "Wykryto zagrozenie jednoznaczne - tresc zablokowana, nie przekazana do modelu.",
};

function recommend(action: SecurityAction, findings: SecurityFinding[]): string[] {
    const recs: string[] = [];
    if (action === "blocked") {
        recs.push("Nie przekazuj pliku do modelu ani do indeksu RAG.");
        recs.push("Powiadom Operatora; zachowaj raport w audit logu (AI Act art. 12).");
    } else if (action === "human_review") {
        recs.push("Skieruj do Inspektora/Operatora do recznej oceny przed uzyciem.");
        recs.push("Nie indeksuj w RAG do czasu decyzji czlowieka.");
    } else if (action === "quarantined") {
        recs.push("Zastosuj redakcje wykrytych fragmentow lub odrzuc warstwe (np. ukryte znaki).");
    } else {
        recs.push("Brak dzialan - kontynuuj normalne przetwarzanie.");
    }
    if (findings.some((f) => f.category === "adversarial")) {
        recs.push("Sygnal prompt-injection: rozwaz odciecie podejrzanego fragmentu od promptu.");
    }
    return recs;
}

export function buildResult(params: {
    fileName?: string;
    findings: SecurityFinding[];
    riskScore: number;
    threatLevel: ThreatLevel;
    action: SecurityAction;
}): SecurityScanResult {
    const { fileName, findings, riskScore, threatLevel, action } = params;
    return {
        reportId: generateReportId(),
        timestamp: new Date().toISOString(),
        fileName,
        threatLevel,
        action,
        riskScore,
        findings,
        summary: ACTION_SUMMARY[action],
        recommendations: recommend(action, findings),
    };
}
