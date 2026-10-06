/**
 * Klasa bledu do logu operacyjnego (nazwa i kod, bez komunikatu). Komunikat
 * bledu storage/parsera/embeddera bywa nosnikiem sciezki z nazwa pliku albo
 * fragmentu tresci pisma (R-CC-06). Jedno zrodlo dla ingestu i kolejki indeksacji.
 */
export function logErrorClass(err: unknown): string {
    if (err instanceof Error) {
        const code = (err as { code?: unknown }).code;
        return typeof code === "string" ? `${err.name}:${code}` : err.name;
    }
    return typeof err;
}
