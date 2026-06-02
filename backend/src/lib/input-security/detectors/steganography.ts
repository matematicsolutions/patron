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

    // Rozroznienie KLUCZOWE (poprawka false-positive): auto-WYKONANIE kodu vs
    // auto-NAWIGACJA. /Launch (uruchamia zewnetrzny program) i /JavaScript|/JS
    // (wykonuje skrypt) sa jednoznacznie grozne -> critical. Natomiast samo
    // /OpenAction lub /AA BEZ kodu to zwykle nieszkodliwa nawigacja
    // (np. "/OpenAction [3 0 R /FitH null]" - otworz na stronie, dopasuj),
    // obecna w wiekszosci legalnych PDF (generatory, edytory). Blokowanie jej
    // odrzucalo realne akta prawne. Krytyczne tylko gdy auto-akcja URUCHAMIA kod.
    const hasLaunch = head.includes("/Launch");
    const hasJs = head.includes("/JavaScript") || head.includes("/JS ") || head.includes("/JS/") || head.includes("/JS(") || head.includes("/JS<");
    const hasAutoAction = head.includes("/OpenAction") || head.includes("/AA");

    if (hasLaunch) {
        findings.push({
            category: "steganography",
            technique: "pdf-launch-action",
            severity: "critical",
            confidence: 92,
            evidence: "PDF zawiera /Launch",
            impact: "Akcja /Launch uruchamia zewnetrzny program przy otwarciu - jednoznaczne ryzyko, blokada.",
        });
    }
    if (hasJs) {
        findings.push({
            category: "steganography",
            technique: "pdf-javascript",
            severity: "critical",
            confidence: 92,
            evidence: "PDF zawiera /JavaScript|/JS",
            impact: "PDF wykonuje JavaScript - jednoznaczne ryzyko, blokada.",
        });
    }
    if (hasAutoAction && !hasLaunch && !hasJs) {
        findings.push({
            category: "steganography",
            technique: "pdf-auto-navigation",
            severity: "low",
            confidence: 40,
            evidence: "PDF zawiera /OpenAction|/AA bez /JavaScript|/Launch (auto-nawigacja)",
            impact: "Akcja automatyczna przy otwarciu bez wykonania kodu (np. GoTo/FitH) - typowo nieszkodliwa nawigacja; odnotowana, nie blokuje.",
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
