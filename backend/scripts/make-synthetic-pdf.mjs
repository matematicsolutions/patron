// Generator syntetycznego PDF-a z warstwa tekstu - material do pomiarow ingestu
// (ADR-0156). Zero zaleznosci npm, zero tresci realnej: akta kancelarii nie sluza
// za material benchmarkowy.
//
// Jeden operator pokazania tekstu NA SLOWO z jawnym pozycjonowaniem - tak produkuja
// PDF-y generatory sadowe i warstwy tekstowe z OCR - zamiast jednej linii na Tj.
// To mnozy liczbe operatorow na stronie ~12x przy podobnym wolumenie tekstu, czyli
// zbliza koszt ekstrakcji do realnego.
//
// uzycie: node scripts/make-synthetic-pdf.mjs [stron] [plik] [linii-na-strone]
//   node scripts/make-synthetic-pdf.mjs 200 akta200.pdf 60   # ~4,7 MB, 200 stron
import fs from "fs";

const PAGES = Number(process.argv[2] ?? 200);
const OUT = process.argv[3] ?? "syntetyk.pdf";
const LINES = Number(process.argv[4] ?? 42);

const LEX = [
  "Sad Okregowy w sprawie o zachowek ustalil nastepujacy stan faktyczny",
  "Powod wniosl o zasadzenie kwoty tytulem zachowku wraz z odsetkami",
  "Pozwana podniosla zarzut przedawnienia roszczenia na podstawie art 1007 KC",
  "Biegly sadowy oszacowal wartosc nieruchomosci na dzien otwarcia spadku",
  "W ocenie Sadu zarzut ten nie zasluguje na uwzglednienie z podanych przyczyn",
  "Zgodnie z utrwalonym orzecznictwem Sadu Najwyzszego uchwala III CZP 11 13",
  "Substrat zachowku oblicza sie z uwzglednieniem darowizn doliczanych do spadku",
  "Koszty procesu Sad rozdzielil stosunkowo na podstawie art 100 KPC",
];

const objects = [];
function addObj(body) {
  objects.push(body);
  return objects.length;
}

const catalogNo = addObj(null);
const pagesNo = addObj(null);
const fontNo = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

const pageNos = [];
for (let p = 1; p <= PAGES; p++) {
  let stream = "BT /F1 9 Tf\n";
  for (let l = 0; l < LINES; l++) {
    const words = `${l + 1}. ${LEX[(p + l) % LEX.length]} poz ${p}.${l}`.split(" ");
    let x = 40;
    const y = 800 - l * 9;
    for (const w of words) {
      stream += `1 0 0 1 ${x} ${y} Tm (${w}) Tj\n`;
      x += w.length * 5 + 3;
    }
  }
  stream += "ET";
  const contentNo = addObj(
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  );
  pageNos.push(
    addObj(
      `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontNo} 0 R >> >> /Contents ${contentNo} 0 R >>`,
    ),
  );
}

objects[catalogNo - 1] = `<< /Type /Catalog /Pages ${pagesNo} 0 R >>`;
objects[pagesNo - 1] = `<< /Type /Pages /Kids [${pageNos
  .map((n) => `${n} 0 R`)
  .join(" ")}] /Count ${PAGES} >>`;

let out = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(out, "latin1"));
  out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xrefOff = Buffer.byteLength(out, "latin1");
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objects.length; i++) {
  out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`;

fs.writeFileSync(OUT, Buffer.from(out, "latin1"));
console.log(
  `${OUT}: ${PAGES} stron, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`,
);
