"use client";

// Jedyne wejscie do react-markdown we frontendzie (audyt 2026-09, A-20).
//
// Odpowiedz modelu jest tekstem, na ktory wplywa dokument strony przeciwnej
// (prompt injection). react-markdown domyslnie zamienia `![x](https://host/?d=...)`
// na <img src=...> - przegladarka lub Electron wysyla wtedy GET z danymi sprawy
// w query stringu, ZANIM prawnik cokolwiek kliknie. Dotyczy to takze wariantow
// reference-style (`![a][r]` + `[r]: url`) i protocol-relative (`//host`).
//
// Zasady tego modulu:
// - obraz z markdown NIGDY nie tworzy <img>: nic w aplikacji nie potrzebuje
//   obrazow z odpowiedzi modelu ani z promptow workflow, wiec blokujemy wszystkie
//   (lacznie z data: i blob:) - zero zadan sieciowych bez klikniecia;
// - link <a> dopuszcza tylko http/https/mailto oraz adresy wzgledne/kotwice;
//   inny schemat (javascript:, data:, vbscript:, file:, ...) jest neutralizowany
//   do zwyklego tekstu; zawsze rel="noopener noreferrer";
// - wszystkie pozostale atrybuty URL (src, cite, poster, ...) sa usuwane;
// - surowy HTML: react-markdown bez rehype-raw zamienia go na tekst. rehype-raw
//   nie jest importowany nigdzie w src - pilnuje tego `SafeMarkdown.test.tsx`.
//
// Wywolujacy moze nadpisac dowolny element OPROCZ `img` i `a` (typ to wymusza);
// styl linku podaje przez `linkClassName`. Bramka w tescie pilnuje, ze zaden
// plik w src poza tym modulem nie importuje react-markdown.
import ReactMarkdown, {
    type Components,
    type ExtraProps,
    type Options,
    type UrlTransform,
} from "react-markdown";
import { useMemo, type ComponentPropsWithoutRef } from "react";
import { ImageOff } from "lucide-react";
import { t } from "@/i18n";

const SAFE_LINK_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * Schemat URL tak, jak go zobaczy przegladarka: parser URL usuwa ASCII tab/LF/CR
 * z calego adresu i obcina wiodace znaki kontrolne i spacje, wiec
 * "java\nscript:" to nadal javascript:. Brak schematu = adres wzgledny,
 * kotwica albo protocol-relative.
 */
export function urlScheme(url: string): string | null {
    const cleaned = url.replace(/[\u0000- \u007f]/g, "");
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
    return m ? m[1].toLowerCase() : null;
}

/** href linku po neutralizacji; `undefined` = link zablokowany. */
export function safeHref(url: string | undefined | null): string | undefined {
    if (url === undefined || url === null || url === "") return undefined;
    const scheme = urlScheme(url);
    if (scheme === null) return url;
    return SAFE_LINK_SCHEMES.has(scheme) ? url : undefined;
}

/**
 * urlTransform dla react-markdown: jedyny przepuszczany atrybut URL to href
 * elementu <a> (po `safeHref`). src obrazu i kazdy inny atrybut URL znika.
 */
export const safeUrlTransform: UrlTransform = (url, key, node) => {
    if (key === "href" && node.tagName === "a") return safeHref(url);
    return undefined;
};

function isExternal(href: string): boolean {
    const scheme = urlScheme(href);
    return scheme === "http" || scheme === "https" || href.startsWith("//");
}

/** Obraz z markdown: tekst alt + nieaktywna informacja, bez <img>. */
export function BlockedMarkdownImage({
    alt,
}: ComponentPropsWithoutRef<"img"> & ExtraProps) {
    return (
        <span
            data-markdown-image-blocked=""
            title={t("safeMarkdown.imageBlockedTitle")}
            className="inline-flex items-center gap-1 rounded border border-dashed border-gray-300 px-1 text-[0.85em] text-gray-500 not-italic"
        >
            <ImageOff className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
                {t("safeMarkdown.imageBlocked")}
                {alt ? `: ${alt}` : ""}
            </span>
        </span>
    );
}

function makeSafeLink(linkClassName?: string) {
    return function SafeMarkdownLink({
        node: _node,
        href,
        children,
        className,
        target: _target,
        rel: _rel,
        ...rest
    }: ComponentPropsWithoutRef<"a"> & ExtraProps) {
        // Druga linia obrony: urlTransform juz to zrobil, ale komponent nie
        // zaklada, ze zawsze stoi za nim.
        const safe = safeHref(href);
        if (!safe) {
            return (
                <span
                    data-markdown-link-blocked=""
                    title={t("safeMarkdown.linkBlocked")}
                    className={className ?? linkClassName}
                >
                    {children}
                </span>
            );
        }
        return (
            <a
                {...rest}
                href={safe}
                className={className ?? linkClassName}
                rel="noopener noreferrer"
                {...(isExternal(safe) ? { target: "_blank" } : {})}
            >
                {children}
            </a>
        );
    };
}

/** Wspolny zestaw komponentow: `img` i `a` w wersji bezpiecznej. */
export function safeMarkdownComponents(
    linkClassName?: string,
): Required<Pick<Components, "img" | "a">> {
    return { img: BlockedMarkdownImage, a: makeSafeLink(linkClassName) };
}

export type SafeMarkdownComponents = Omit<Components, "img" | "a">;

export interface SafeMarkdownProps
    extends Omit<Options, "components" | "urlTransform"> {
    components?: SafeMarkdownComponents;
    /** Klasa CSS linkow (zamiast wlasnego komponentu `a`). */
    linkClassName?: string;
}

export function SafeMarkdown({
    components,
    linkClassName,
    ...rest
}: SafeMarkdownProps) {
    const safe = useMemo(
        () => safeMarkdownComponents(linkClassName),
        [linkClassName],
    );
    return (
        <ReactMarkdown
            {...rest}
            urlTransform={safeUrlTransform}
            components={{ ...components, ...safe }}
        />
    );
}
