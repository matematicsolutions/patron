"use client";

import { useEffect } from "react";
import { t } from "@/i18n";

export default function GlobalError({
    error,
}: {
    error: Error & { digest?: string };
}) {
    useEffect(() => {
        console.error("Global error:", error);
    }, [error]);

    return (
        <html lang="pl">
            <head>
                <title>{t("error.somethingWentWrong")} – Patron</title>
                <style>{`
                    /* ZADNEGO @import z sieci. global-error zastepuje root layout,
                       wiec nie ma tu zmiennych next/font - ale pobieranie kroju z
                       zewnetrznego CDN bylo realnym wyjsciem na zewnatrz w
                       produkcie zero-cloud, i to akurat w chwili awarii. Stos
                       systemowy renderuje sie zawsze i nie wychodzi z maszyny.
                       Nie wpisuj tu nazwy hosta - trafia do bundla i zapala
                       falszywy alarm w audycie egress grepem. */

                    * { margin: 0; padding: 0; box-sizing: border-box; }

                    /* Awers (ADR-0149): Cloud Dancer + Cocoa, przycisk w zlocie
                       pieczeci. Strona bledu MUSI byc w palecie produktu - to
                       ostatnia rzecz, jaka mecenas widzi przed zamknieciem. */
                    body {
                        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                        background-color: #f1eee5;
                        color: #2b2219;
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }

                    .error-container {
                        text-align: center;
                        max-width: 480px;
                        padding: 2rem;
                    }

                    .error-title {
                        font-family: Georgia, 'Times New Roman', serif;
                        font-size: 1.75rem;
                        font-weight: 400;
                        color: #2b2219;
                        margin-bottom: 0.75rem;
                    }

                    .error-message {
                        font-size: 0.9375rem;
                        color: #6e6459;
                        line-height: 1.6;
                        margin-bottom: 2rem;
                    }

                    .btn-back {
                        display: inline-flex;
                        align-items: center;
                        gap: 0.5rem;
                        padding: 0.625rem 1.25rem;
                        border-radius: 0.375rem;
                        font-size: 0.875rem;
                        font-weight: 500;
                        font-family: inherit;
                        cursor: pointer;
                        transition: all 0.15s ease;
                        text-decoration: none;
                        border: none;
                        background-color: #7a5f2b;
                        color: #f8f6ef;
                    }

                    .btn-back:hover {
                        background-color: #6a5225;
                    }

                    .btn-back:active {
                        transform: scale(0.98);
                    }
                `}</style>
            </head>
            <body>
                <div className="error-container">
                    <h1 className="error-title">
                        {t("error.somethingWentWrong")}
                    </h1>
                    <p className="error-message">
                        {t("error.unexpectedError")}
                    </p>
                    <button
                        className="btn-back"
                        onClick={() => window.history.back()}
                    >
                        {t("error.back")}
                    </button>
                </div>
            </body>
        </html>
    );
}
