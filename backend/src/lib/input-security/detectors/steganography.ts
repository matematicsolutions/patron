// Detektor steganografii - ukryta tresc w tekscie i w surowym buforze PDF.
// Jezyk-niezalezny (operuje na strukturze znakow / bajtow), wiec przenosimy
// z wzorca Atticusa bez zmian merytorycznych. Patrz ADR-0019.

import type { Detector, SecurityFinding, SecurityScanInput } from "../types";

// Znaki zerowej szerokosci uzywane do ukrywania danych w tekscie.
// UWAGA: to NIE sa polskie diakrytyki - te sa zwyklymi literami lacinki.
const ZERO_WIDTH = ["​", "‌", "‍", "﻿", "⁠", "᠎"];

function detectZeroWidth(text: string): SecurityFinding | null {
    let count = 0;
    for (const ch of text) {
        if (ZERO_WIDTH.includes(ch)) count++;
    }
    if (count === 0) return null;
    return {
        category: "steganography",
        technique: "zero-width-chars",
        severity: count > 8 ? "high" : "medium",
        confidence: Math.min(50 + count * 5, 95),
        evidence: `${count} znakow zerowej szerokosci`,
        impact: "Ukryta tresc/znak wodny zakodowany znakami niewidocznymi - moze przenosic ukryte polecenie.",
    };
}

// Ukryte akcje i obiekty w surowym PDF. /OpenAction i /Launch to sygnaly
// JEDNOZNACZNE (critical) - automatyczne wykonanie przy otwarciu.
function detectPdfHidden(buffer: Uint8Array | undefined, declaredType?: string): SecurityFinding[] {
    if (!buffer) return [];
    const isPdf = declaredType?.includes("pdf") || (buffer[0] === 0x25 && buffer[1] === 0x50); // %P
    if (!isPdf) return [];

    // Dekoduj jako latin1 - szukamy markerow strukturalnych, nie tresci.
    const head = Buffer.from(buffer).toString("latin1");
    const findings: SecurityFinding[] = [];

    if (head.includes("/Launch") || head.includes("/OpenAction") || head.includes("/AA")) {
        findings.push({
            category: "steganography",
            technique: "pdf-auto-action",
            severity: "critical",
            confidence: 90,
            evidence: "PDF zawiera /OpenAction|/Launch|/AA",
            impact: "PDF z akcja automatyczna przy otwarciu - jednoznaczne ryzyko, blokada.",
        });
    }
    if (head.includes("/EmbeddedFile")) {
        findings.push({
            category: "steganography",
            technique: "pdf-embedded-file",
            severity: "high",
            confidence: 80,
            evidence: "PDF zawiera /EmbeddedFile",
            impact: "Plik osadzony w PDF - mozliwy nosnik ukrytej tresci.",
        });
    }
    if (head.includes("/OCProperties")) {
        findings.push({
            category: "steganography",
            technique: "pdf-hidden-layers",
            severity: "medium",
            confidence: 60,
            evidence: "PDF zawiera warstwy opcjonalne (/OCProperties)",
            impact: "Ukryte warstwy moga zawierac tresc niewidoczna w normalnym widoku.",
        });
    }
    return findings;
}

export const steganographyDetector: Detector = {
    id: "steganography",
    category: "steganography",
    run(input: SecurityScanInput): SecurityFinding[] {
        const findings: SecurityFinding[] = [];
        const zw = detectZeroWidth(input.text);
        if (zw) findings.push(zw);
        findings.push(...detectPdfHidden(input.buffer, input.declaredType));
        return findings;
    },
};
