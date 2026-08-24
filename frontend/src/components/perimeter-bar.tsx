// Pasek perymetru - JEDYNA stala powierzchnia governance w produkcie.
//
// Po co to istnieje: lancuch skrotow, bramka egress i gateway MCP to jedyne
// rzeczy, ktorych nie ma zaden konkurent w kategorii (zmierzone 2026-08-21 na
// Harvey, Legora, Hebbia, Wexler, Libra, Omnilexia, Beck-Noxtua). Do tej pory
// siedzialy w /admin/audit i /account/connectors, czyli tam, gdzie prawnik
// zaglada raz w zyciu.
//
// ADR-0149 (korekta WM 2026-08-21): pasek przejmuje CALY stan trwaly po gornych
// banerach. Zasada: STAN TRWALY nalezy do perymetru, ZMIANA STANU do banera.
// Kazdy segment jest klikalny i prowadzi tam, gdzie sie tym zarzadza - dzieki
// temu gorne 10% ekranu wraca do sprawy, a governance ma JEDNA powierzchnie
// zamiast dwoch mowiacych to samo.
//
// Cisza nadal nie jest informacja: pasek renderuje sie ZAWSZE, a brak
// odpowiedzi o konfiguracji to stan "nie potwierdzam", nigdy zielony.
//
// Pasywny: czyta stan, niczego nie loguje i niczego nie zmienia.

"use client";

import type { ReactElement, ReactNode } from "react";
import { useEgressConfig } from "@/hooks/useEgressConfig";
import { useMcpSecurityStatus } from "@/hooks/useMcpSecurityStatus";
import { useSelectedModel } from "@/app/hooks/useSelectedModel";
import { isLocalModel } from "@/lib/modelEgress";
import Link from "next/link";
import { t } from "@/i18n";

// "cloud-blocked" = polityka egresu zamknieta, ale wybrany model jest chmurowy.
// Router zablokuje wyjscie, wiec stan jest ochronny - ale zdanie "dane nie
// opuszczaja urzadzenia" bylo w nim FALSZYWE, bo nic o tych danych nie mowi
// polityka, ktora dopiero ma cos zablokowac. Osobny stan zamiast milczenia:
// ostrzezenie jest tu lepsze niz zielono.
type Posture = "local" | "cloud-blocked" | "cloud" | "unknown";

/** Segment paska: klikalny, prowadzi tam, gdzie zarzadza sie tym faktem. */
function Segment({
    href,
    title,
    testId,
    className = "",
    children,
}: {
    href: string;
    title: string;
    testId?: string;
    className?: string;
    children: ReactNode;
}): ReactElement {
    return (
        <Link
            href={href}
            title={title}
            data-testid={testId}
            className={`inline-flex items-baseline gap-1.5 self-center rounded-sm underline-offset-2 transition-colors hover:underline focus-visible:underline ${className}`}
        >
            {children}
        </Link>
    );
}

function Divider(): ReactElement {
    return <span className="mx-4 w-px self-stretch bg-rev-border" aria-hidden="true" />;
}

export function PerimeterBar(): ReactElement {
    const { config } = useEgressConfig();
    const { status } = useMcpSecurityStatus();
    const [model] = useSelectedModel();

    // Czy model WIDOCZNY obok jest lokalny. Do 2026-08-24 pasek czytal w tym
    // miejscu `config.local_model_configured`, czyli "gdzies w env ustawiono
    // PATRON_LOCAL_MODEL" - co jest zupelnie innym zdaniem niz "ten model jest
    // lokalny". Zmierzony efekt na profilu demo: "MODEL
    // openrouter/google/gemini-3-flash-preview (lokalny)".
    const modelIsLocal = isLocalModel(model);

    // Postawa to KONIUNKCJA polityki i modelu w uzyciu:
    //   - zielone "dane nie opuszczaja urzadzenia" wymaga zamknietej polityki
    //     ORAZ lokalnego modelu - jest ZAROBIONE, nie domyslne;
    //   - zamknieta polityka + model chmurowy = "cloud-blocked" (router zablokuje,
    //     ale o danych nic nie obiecujemy);
    //   - otwarta flaga egresu = "cloud" nawet przy lokalnym modelu glownym, bo
    //     model glowny to nie caly ruch: tytul czatu i przeglad tabelaryczny ida
    //     na DEFAULT_TITLE_MODEL (chmura) niezaleznie od wyboru w pickerze.
    // fail-closed: brak konfiguracji nie awansuje na zielony
    const posture: Posture =
        config === null
            ? "unknown"
            : config.privileged_cloud.allowed || config.us_providers.allowed
              ? "cloud"
              : modelIsLocal
                ? "local"
                : "cloud-blocked";

    const tone = posture === "local" ? "text-rev-ok" : "text-rev-warn";
    const dot = posture === "local" ? "bg-rev-ok" : "bg-rev-warn";

    const postureText =
        posture === "local"
            ? t("perimeter.local")
            : posture === "unknown"
              ? t("perimeter.unknown")
              : posture === "cloud-blocked"
                ? t("perimeter.cloudBlocked")
                : config?.privileged_cloud.allowed
                  ? t("perimeter.cloudPrivileged")
                  : t("perimeter.cloudUs");

    const blocked = status?.audit_summary_24h.by_action.denied ?? 0;

    return (
        <footer
            data-testid="perimeter-bar"
            data-posture={posture}
            aria-label={t("perimeter.label")}
            // Perymetr jest ZAWSZE rewersem biezacego motywu (ciemny pas na
            // jasnym ekranie i odwrotnie): governance to "druga strona kartki",
            // widoczna obwodowo i nigdy nie zlewajaca sie z trescia. Segmenty
            // rozdziela wloskowata kreska - pas ma czytac sie jako JEDEN
            // instrument pomiarowy, nie luzny zbior napisow.
            className="flex shrink-0 flex-wrap items-stretch gap-y-1 border-t border-rev-border bg-rev-background px-4 py-2 text-[11px] leading-tight text-rev-muted-foreground"
        >
            {/* Postawa perymetru: klik prowadzi tam, gdzie Operator moze swoja
                zgode ODWOLAC - to jest sens wyprowadzenia jej na powierzchnie. */}
            <Segment
                href="/account/models"
                title={t("perimeter.policyLink")}
                testId="perimeter-posture-link"
                className={`font-semibold ${tone}`}
            >
                <span
                    className={`h-[7px] w-[7px] shrink-0 translate-y-[-1px] rounded-full ${dot}`}
                    aria-hidden="true"
                />
                {postureText}
            </Segment>

            <Divider />

            <Segment
                href="/account/models"
                title={t("perimeter.policyLink")}
                testId="perimeter-model-link"
            >
                <span className="uppercase tracking-[0.08em]">{t("perimeter.model")}</span>
                <span className="font-mono text-rev-foreground">{model}</span>
                {/* Plakietka opisuje MODEL OBOK, nie zawartosc env. */}
                {modelIsLocal ? (
                    <span
                        className="text-rev-ok"
                        data-testid="perimeter-local-badge"
                    >
                        ({t("perimeter.localModel")})
                    </span>
                ) : null}
            </Segment>

            {/* Lancuch skrotow, Merkle i eksport teczki dowodowej zyja pod
                /admin/audit, do ktorego do 2026-08-21 NIE PROWADZIL ZADEN LINK -
                dalo sie tam wejsc tylko wpisujac adres. Jedyne funkcje, ktorych
                nie ma konkurencja, byly nieosiagalne. */}
            {status ? (
                <>
                    <Divider />
                    <Segment
                        href="/admin/audit"
                        title={t("perimeter.auditLink")}
                        testId="perimeter-gateway-link"
                    >
                        <span className="uppercase tracking-[0.08em]">
                            {t("perimeter.gateway")}
                        </span>
                        <span
                            className={
                                status.gateway.active ? "text-rev-ok" : "text-rev-warn"
                            }
                        >
                            {status.gateway.active
                                ? t("perimeter.gatewayActive")
                                : t("perimeter.gatewayInactive")}
                        </span>
                        <span className="font-mono text-rev-foreground">
                            {status.audit_summary_24h.decisions_total}
                        </span>
                        <span>{t("perimeter.decisions24h")}</span>
                        {blocked > 0 ? (
                            <span className="font-semibold text-rev-bad">
                                {blocked} {t("perimeter.blocked")}
                            </span>
                        ) : null}
                    </Segment>
                    <Link
                        href="/admin/audit"
                        data-testid="perimeter-audit-link"
                        title={t("perimeter.auditLink")}
                        // Odsylacz do akt to znak autorytetu - jedyne zloto na
                        // pasku, dobite do prawej krawedzi jak pieczec na dole
                        // dokumentu.
                        className="ml-auto inline-flex items-baseline gap-1 self-center rounded-sm pl-4 font-semibold uppercase tracking-[0.08em] text-rev-gold underline-offset-2 hover:underline focus-visible:underline"
                    >
                        <span aria-hidden="true">⏣</span>
                        {t("perimeter.auditLink")}
                    </Link>
                </>
            ) : null}
        </footer>
    );
}
