#!/usr/bin/env tsx
// Zasila profil DEMONSTRACYJNY danymi syntetycznymi pod zrzuty ekranu.
//
//   PATRON_DB_PATH=... PATRON_STORAGE_DIR=... npm run dev   (backend, port 3001)
//   npx tsx scripts/zasil-profil-demo.ts
//
// Powod istnienia: zrzuty do media kitu powstawaly na ZYWYM profilu roboczym.
// Boczny panel PATRONa pokazuje "Ostatnie sprawy" i "Historie czatow" na KAZDYM
// kadrze, a w profilu roboczym siedza nazwy prawdziwych kancelarii, pilotazowe
// NDA i akta. Jeden zrzut z niewlasciwym stanem panelu = nazwa klienta
// w publicznym pliku PNG. To nie jest ryzyko, ktore wolno zostawiac przypadkowi
// w produkcie sprzedawanym na tajemnicy zawodowej.
//
// Obsada jest SYNTETYCZNA i celowo rozpoznawalna jako syntetyczna (ulica
// Kwiatowa, Acme, Galeria Polnoc) - ta sama, ktorej uzywa smoke-surfaces.

import { Document, Packer, Paragraph } from "docx";

const BASE = process.env.PATRON_DEMO_BASE || "http://localhost:3001";
const MODEL = process.env.PATRON_DEMO_MODEL?.trim() || "ollama/llama3:latest";
// Backend w trybie sqlite ignoruje token, ale naglowek musi byc (ADR-0062).
const AUTH = { Authorization: "Bearer local" };

async function docx(paras: string[]): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ children: paras.map((t) => new Paragraph(t)) }] }));
}

async function wgraj(nazwa: string, paras: string[]): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([await docx(paras)]), nazwa);
  const r = await fetch(`${BASE}/single-documents`, { method: "POST", body: form });
  if (r.status !== 201) throw new Error(`upload ${nazwa} -> ${r.status}`);
  const b = (await r.json()) as { id: string };
  console.log(`  wgrane: ${nazwa} (${b.id})`);
  return b.id;
}

async function sse(r: Response, ms: number): Promise<Record<string, unknown>[]> {
  const zdarzenia: Record<string, unknown>[] = [];
  const czytnik = r.body?.getReader();
  if (!czytnik) return zdarzenia;
  const dek = new TextDecoder();
  let bufor = "";
  const koniec = Date.now() + ms;
  while (Date.now() < koniec) {
    const { done, value } = await czytnik.read();
    if (done) break;
    bufor += dek.decode(value, { stream: true });
    const czesci = bufor.split("\n\n");
    bufor = czesci.pop() ?? "";
    for (const c of czesci) {
      for (const linia of c.split("\n")) {
        if (!linia.startsWith("data:")) continue;
        try { zdarzenia.push(JSON.parse(linia.slice(5).trim())); } catch { /* keep-alive */ }
      }
    }
  }
  return zdarzenia;
}

async function czat(tresc: string, opcje: Record<string, unknown> = {}): Promise<string | null> {
  const r = await fetch(`${BASE}/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: tresc }], ...opcje }),
  });
  const zd = await sse(r, 240_000);
  const surowe = JSON.stringify(zd);
  const id = surowe.match(/"chat_id"\s*:\s*"([0-9a-f-]{36})"/i)?.[1]
    ?? surowe.match(/"chatId"\s*:\s*"([0-9a-f-]{36})"/i)?.[1]
    ?? null;
  console.log(`  czat: ${tresc.slice(0, 58)}... -> ${id ?? "brak id w SSE"} (${zd.length} zdarzen)`);
  return id;
}

async function main() {
  console.log(`Zasilanie profilu demo przez ${BASE} (model ${MODEL})\n`);

  // Sprawa, zeby panel boczny pokazywal akta, a nie "Brak spraw".
  const sprawa = await fetch(`${BASE}/projects`, {
    method: "POST", headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify({ name: "Umowa najmu Kwiatowa", cm_number: "2026/114" }),
  });
  console.log(`  sprawa: ${sprawa.status} ${sprawa.status < 300 ? "utworzona" : await sprawa.text()}`);

  const najem = await wgraj("Umowa-najmu-Kwiatowa-5.docx", [
    "UMOWA NAJMU LOKALU UZYTKOWEGO",
    "zawarta w Krakowie pomiedzy Galeria Polnoc sp. z o.o. (Wynajmujacy) a Acme Retail sp. z o.o. (Najemca).",
    "Par. 1. Przedmiotem najmu jest lokal uzytkowy nr 5 przy ulicy Kwiatowej w Krakowie o powierzchni 114 m2.",
    "Par. 2. Umowa zostaje zawarta na czas oznaczony wynoszacy 24 miesiace, liczony od dnia wydania lokalu.",
    "Par. 3. Kazdej ze stron przysluguje prawo wypowiedzenia umowy z zachowaniem trzymiesiecznego okresu wypowiedzenia, ze skutkiem na koniec miesiaca kalendarzowego.",
    "Par. 4. Czynsz najmu wynosi 45 000 EUR rocznie i platny jest z gory do dziesiatego dnia kazdego miesiaca.",
    "Par. 5. Za opoznienie w zwrocie lokalu po zakonczeniu najmu Najemca zaplaci kare umowna w wysokosci 200 zl za kazdy dzien zwloki.",
    "Par. 6. Wszelkie zmiany umowy wymagaja formy pisemnej pod rygorem niewaznosci.",
  ]);

  await wgraj("Umowa-dostawy-Acme-2026.docx", [
    "UMOWA DOSTAWY",
    "zawarta pomiedzy Acme Retail sp. z o.o. (Zamawiajacy) a Nordwind Logistik GmbH (Dostawca).",
    "Par. 1. Dostawca zobowiazuje sie do dostarczania towaru partiami, zgodnie z harmonogramem.",
    "Par. 2. Umowa obowiazuje przez 12 miesiecy z mozliwoscia przedluzenia o kolejne 12 miesiecy.",
    "Par. 3. Kazda ze stron moze wypowiedziec umowe z zachowaniem miesiecznego okresu wypowiedzenia.",
    "Par. 4. Za zwloke w dostawie Dostawca zaplaci kare umowna w wysokosci 0,2 procent wartosci partii za kazdy dzien.",
  ]);

  console.log("\nCzekam na zindeksowanie...");
  await new Promise((r) => setTimeout(r, 8000));

  // Kadr "kontrola zrodel" powstaje na TYM czacie: trzy twierdzenia, kazde
  // z przypisem do wgranej umowy. Pytanie jest tak sformulowane, zeby model
  // musial siegnac do trzech ROZNYCH paragrafow.
  const id = await czat(
    "Jaki jest termin wypowiedzenia i wysokość kary umownej w umowie najmu lokalu przy ulicy Kwiatowej? " +
    "Podaj też, na jaki czas zawarto umowę. Każde twierdzenie oprzyj na dokumencie.",
    { documentIds: [najem] },
  );

  await czat("Jak zaimportować akta sprawy do PATRONa?");
  await czat("Zasady analizy umów - od czego zacząć przegląd nowego kontraktu?");

  console.log(`\nGOTOWE. Czat do kadru groundingu: ${id ?? "NIE USTALONO - sprawdz recznie"}`);
}

main().catch((e) => { console.error("zasilanie padlo:", e); process.exit(1); });
