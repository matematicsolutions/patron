import type { Metadata } from "next";
import { Lato, Bona_Nova, Brygada_1918 } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

/* Kroje Patrona. Wszystkie na SIL OFL 1.1, wszystkie pobierane przez
   next/font przy buildzie i serwowane z wlasnego origin - zero zapytan
   do Google w runtime, zgodnie z obietnica zero-cloud.

   subsets zawiera "latin-ext" swiadomie. UWAGA na czesta pomylke: ta opcja
   NIE decyduje o tym, ktore @font-face trafiaja do CSS - Google zwraca
   wszystkie subsety zawsze (zmierzone 2026-08-21: css2?...&subset=latin
   oddaje latin-ext, cyrillic, greek i vietnamese tak samo jak bez tego
   parametru). Decyduje o PRELOADZIE. Bez latin-ext polskie a-ogonek,
   e-ogonek i l-kreska renderowaly sie poprawnie, ale dopiero po
   doladowaniu drugiego pliku - czyli z migniecien fontu zastepczego
   na tekscie, ktory w PL UI jest wszedzie. Dla de/fr/it/es/pt to bez
   znaczenia (te znaki sa w "latin"); dla pl i vi ma znaczenie. */

const lato = Lato({
    variable: "--font-lato",
    subsets: ["latin", "latin-ext"],
    weight: ["400", "700"],
    display: "swap",
});

const bonaNova = Bona_Nova({
    variable: "--font-bona-nova",
    subsets: ["latin", "latin-ext"],
    weight: ["400", "700"],
    style: ["normal", "italic"],
    display: "swap",
});

const brygada = Brygada_1918({
    variable: "--font-brygada",
    subsets: ["latin", "latin-ext"],
    weight: ["400", "600"],
    style: ["normal", "italic"],
    display: "swap",
});

export const metadata: Metadata = {
    metadataBase: new URL("https://patron.matematicsolutions.com"),
    title: "PATRON - AI Legal Platform",
    description:
        "AI-powered legal document analysis and contract review platform.",
    icons: {
        icon: [
            { url: "/icon.svg", type: "image/svg+xml" },
            { url: "/favicon.ico" },
        ],
        apple: "/apple-touch-icon.png",
    },
    openGraph: {
        type: "website",
        url: "https://patron.matematicsolutions.com",
        siteName: "PATRON",
        title: "PATRON - AI Legal Platform",
        description:
            "AI-powered legal document analysis and contract review platform.",
        images: [
            {
                url: "/link-image.jpg",
                width: 1200,
                height: 651,
                alt: "PATRON",
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: "PATRON - AI Legal Platform",
        description:
            "AI-powered legal document analysis and contract review platform.",
        images: ["/link-image.jpg"],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="pl">
            <body
                className={`${lato.variable} ${bonaNova.variable} ${brygada.variable} font-sans antialiased`}
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
