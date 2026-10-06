// Weryfikatory doreczane ODBIORCY razem z artefaktem audytowym (ADR-0142).
//
// Tresc obu weryfikatorow jest OSADZONA w kodzie, a nie czytana z dysku przy
// eksporcie. Powod: w wersji desktop (Electron) plik pominiety w krokach
// pakowania zniknalby po cichu, a eksport nadal konczylby sie sukcesem - z
// archiwum bez narzedzia weryfikujacego. Osadzenie zamienia to na blad
// kompilacji zamiast cichej niekompletnosci u odbiorcy.
//
// Oba weryfikatory licza dokladnie to samo co Patron:
//   - kanoniczna serializacja z audit-pack.ts (klucze sortowane, JSON.stringify)
//   - SHA-256 nad ta serializacja
//   - dowod przynaleznosci Merkle wg RFC 6962 (audit-merkle.ts)
//   - hash wpisu przeliczony z tresci (computeAuditHash z audit.ts), gdy wpis
//     niesie hash_inputs_complete - audyt 2026-09, C-04 / D-01
//   - zgodnosc zdarzenia paczki z dowodem Merkle (numer i hash)
//   - wyciag z dziennika: ogniwa w obrebie wyciagu, luki jawnie, numery rosnace
//     (verifyAuditExcerpt w audit-bundle.ts)
//   - zerwanie z mocy prawa (ADR-0164, decyzja 2026-10-06): wpis ze znacznikiem
//     legal_break i deklaracja w artefakcie (checkLegalBreakMarker w
//     audit-pack.ts) - osobny stan werdyktu, verify.py konczy sie kodem 3
//
// Zgodnosc obu implementacji z kodem produkcyjnym pilnuje
// audit-verifier-assets.test.ts (wektory kanonikalizacji + przebieg na
// artefakcie zdrowym i zmanipulowanym). NIE edytuj tych ciagow bez
// uruchomienia tego testu.
//
// UWAGA przy edycji: ciagi sa w String.raw - tresc nie moze zawierac
// znaku backtick ani sekwencji ${.

/** Nazwa weryfikatora przegladarkowego w archiwum - imperatyw dla odbiorcy. */
export const VERIFIER_HTML_FILENAME = "SPRAWDZ-TEN-PLIK.html";

/** Nazwa weryfikatora wiersza polecen w archiwum. */
export const VERIFIER_PY_FILENAME = "verify.py";

/** Nazwa instrukcji w archiwum. */
export const VERIFIER_README_FILENAME = "CZYTAJ-TO-NAJPIERW.txt";

/**
 * Weryfikator przegladarkowy - jeden plik, zero instalacji, zero sieci.
 * Wlasna implementacja SHA-256 zamiast crypto.subtle, bo jej dostepnosc przy
 * otwarciu z dysku (file://) zalezy od przegladarki, a odbiorca ma tylko
 * kliknac dwa razy.
 */
export const VERIFIER_HTML = String.raw`<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weryfikacja artefaktu audytowego Patrona</title>
<style>
  :root {
    --tlo: #ffffff; --tekst: #1a1a1a; --slaby: #5b5b5b; --ramka: #d9d9d9;
    --pole: #f6f6f6; --ok: #1a6b32; --ok-tlo: #e8f4ec; --zle: #a11020; --zle-tlo: #fbeaec;
    --uw: #7a4a00; --uw-tlo: #fdf3e1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --tlo: #16181c; --tekst: #eceff3; --slaby: #a2a8b3; --ramka: #333840;
      --pole: #1e2127; --ok: #6fd08c; --ok-tlo: #16301f; --zle: #ff8b96; --zle-tlo: #341419;
      --uw: #f2c46d; --uw-tlo: #33270f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem 4rem; background: var(--tlo); color: var(--tekst);
    font: 16px/1.6 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  .podtytul { color: var(--slaby); margin: 0 0 2rem; font-size: .95rem; }
  #strefa {
    border: 2px dashed var(--ramka); border-radius: 10px; padding: 2.5rem 1.5rem;
    text-align: center; background: var(--pole); cursor: pointer; transition: border-color .15s;
  }
  #strefa:hover, #strefa.nad { border-color: var(--slaby); }
  #strefa p { margin: .35rem 0; }
  #strefa .glowny { font-weight: 600; }
  #strefa .drobny { color: var(--slaby); font-size: .9rem; }
  input[type=file] { display: none; }
  #wynik { margin-top: 2rem; display: none; }
  #wynik.widoczny { display: block; }
  .werdykt { border-radius: 10px; padding: 1.1rem 1.25rem; margin-bottom: 1.5rem; border: 1px solid; }
  .werdykt h2 { margin: 0 0 .35rem; font-size: 1.15rem; }
  .werdykt p { margin: 0; font-size: .95rem; }
  .werdykt.ok { color: var(--ok); background: var(--ok-tlo); border-color: currentColor; }
  .werdykt.zle { color: var(--zle); background: var(--zle-tlo); border-color: currentColor; }
  .werdykt.uwaga { color: var(--uw); background: var(--uw-tlo); border-color: currentColor; }
  dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1rem; margin: 0 0 1.75rem; font-size: .92rem; }
  dl.meta dt { color: var(--slaby); }
  dl.meta dd { margin: 0; overflow-wrap: anywhere; }
  ol.kroki { list-style: none; padding: 0; margin: 0 0 1.75rem; }
  ol.kroki li { border-top: 1px solid var(--ramka); padding: .8rem 0; }
  ol.kroki li:last-child { border-bottom: 1px solid var(--ramka); }
  .krok-glowa { display: flex; gap: .6rem; align-items: baseline; }
  .znacznik { font-weight: 700; }
  .znacznik.ok { color: var(--ok); }
  .znacznik.zle { color: var(--zle); }
  .znacznik.uwaga { color: var(--uw); }
  .krok-tytul { font-weight: 600; }
  .krok-opis { color: var(--slaby); font-size: .9rem; margin: .3rem 0 0 1.7rem; }
  .krok-opis code { font-family: ui-monospace, Consolas, monospace; font-size: .85em; overflow-wrap: anywhere; }
  .zastrzezenie { border-left: 3px solid var(--ramka); padding: .25rem 0 .25rem 1rem; color: var(--slaby); font-size: .9rem; }
  .zastrzezenie strong { color: var(--tekst); }
  footer { margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--ramka); color: var(--slaby); font-size: .85rem; }
  button.drukuj {
    font: inherit; font-size: .9rem; color: var(--tekst); background: var(--pole);
    border: 1px solid var(--ramka); border-radius: 7px; padding: .45rem .9rem; cursor: pointer;
  }
  @media print {
    body { padding: 0; } #strefa, button.drukuj { display: none; }
    .werdykt { border: 1px solid #000; } * { color: #000 !important; background: #fff !important; }
  }
</style>
</head>
<body>
<main>
  <h1>Weryfikacja artefaktu audytowego Patrona</h1>
  <p class="podtytul">
    Sprawdza, czy otrzymany plik nie został zmieniony po wydaniu przez kancelarię.
    Działa w całości na tym urządzeniu - plik nie jest nigdzie wysyłany.
  </p>

  <div id="strefa" tabindex="0" role="button" aria-label="Wybierz plik JSON do sprawdzenia">
    <p class="glowny">Przeciągnij tutaj plik JSON albo kliknij, aby go wskazać</p>
    <p class="drobny">Nazwa zaczyna się od <code>audit-pack-</code> albo <code>audit-bundle-</code></p>
  </div>
  <input type="file" id="plik" accept=".json,application/json">

  <section id="wynik" aria-live="polite"></section>

  <footer>
    Weryfikator jest samodzielny: nie łączy się z siecią, nie potrzebuje dostępu do
    systemu kancelarii ani żadnej instalacji. Możesz zachować ten plik i użyć go ponownie.
  </footer>
</main>

<script>
"use strict";

/* ---------------------------------------------------------------------------
   SHA-256 (FIPS 180-4) w czystym JavaScripcie.
   Świadomie NIE korzystamy z crypto.subtle: przy otwarciu pliku z dysku
   (file://) jego dostępność zależy od przeglądarki, a weryfikator ma działać
   przez podwójne kliknięcie, bez serwera i bez warunków wstępnych.
--------------------------------------------------------------------------- */
var K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];

function utf8Bajty(tekst) {
  var bajty = [], i, c, j;
  for (i = 0; i < tekst.length; i++) {
    c = tekst.charCodeAt(i);
    if (c < 0x80) { bajty.push(c); }
    else if (c < 0x800) { bajty.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < tekst.length) {
      j = tekst.charCodeAt(i + 1);
      if (j >= 0xdc00 && j <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (j - 0xdc00);
        i++;
        bajty.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else {
        /* samotny surogat - tak samo jak TextEncoder: znak zastępczy U+FFFD */
        bajty.push(0xef, 0xbf, 0xbd);
      }
    } else if (c >= 0xd800 && c <= 0xdfff) {
      bajty.push(0xef, 0xbf, 0xbd);
    } else {
      bajty.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return bajty;
}

function sha256Hex(tekst) {
  var bajty = utf8Bajty(tekst);
  var dlugoscBitow = bajty.length * 8;
  bajty.push(0x80);
  while (bajty.length % 64 !== 56) bajty.push(0);
  var wysokie = Math.floor(dlugoscBitow / 0x100000000);
  var niskie = dlugoscBitow >>> 0;
  bajty.push((wysokie >>> 24) & 255, (wysokie >>> 16) & 255, (wysokie >>> 8) & 255, wysokie & 255);
  bajty.push((niskie >>> 24) & 255, (niskie >>> 16) & 255, (niskie >>> 8) & 255, niskie & 255);

  var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var w = new Array(64), blok, t, a, b, c, d, e, f, g, hh, s0, s1, ch, maj, t1, t2;

  for (blok = 0; blok < bajty.length; blok += 64) {
    for (t = 0; t < 16; t++) {
      w[t] = (bajty[blok + t * 4] << 24) | (bajty[blok + t * 4 + 1] << 16) |
             (bajty[blok + t * 4 + 2] << 8) | bajty[blok + t * 4 + 3];
    }
    for (t = 16; t < 64; t++) {
      s0 = ((w[t-15] >>> 7) | (w[t-15] << 25)) ^ ((w[t-15] >>> 18) | (w[t-15] << 14)) ^ (w[t-15] >>> 3);
      s1 = ((w[t-2] >>> 17) | (w[t-2] << 15)) ^ ((w[t-2] >>> 19) | (w[t-2] << 13)) ^ (w[t-2] >>> 10);
      w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0;
    }
    a=h[0]; b=h[1]; c=h[2]; d=h[3]; e=h[4]; f=h[5]; g=h[6]; hh=h[7];
    for (t = 0; t < 64; t++) {
      s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      ch = (e & f) ^ (~e & g);
      t1 = (hh + s1 + ch + K[t] + w[t]) | 0;
      s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      maj = (a & b) ^ (a & c) ^ (b & c);
      t2 = (s0 + maj) | 0;
      hh=g; g=f; f=e; e=(d + t1)|0; d=c; c=b; b=a; a=(t1 + t2)|0;
    }
    h[0]=(h[0]+a)|0; h[1]=(h[1]+b)|0; h[2]=(h[2]+c)|0; h[3]=(h[3]+d)|0;
    h[4]=(h[4]+e)|0; h[5]=(h[5]+f)|0; h[6]=(h[6]+g)|0; h[7]=(h[7]+hh)|0;
  }
  var wynik = "", i2;
  for (i2 = 0; i2 < 8; i2++) wynik += ("00000000" + (h[i2] >>> 0).toString(16)).slice(-8);
  return wynik;
}

/* ---------------------------------------------------------------------------
   Kanoniczna serializacja - odpowiednik canonicalJsonStringify z Patrona.
   Ta sama semantyka JSON.stringify co po stronie wydającej, więc nie ma tu
   ryzyka rozjazdu formatowania liczb ani znaków ucieczki.
--------------------------------------------------------------------------- */
function kanoniczny(wartosc) {
  if (wartosc === null || wartosc === undefined) return JSON.stringify(wartosc);
  var typ = typeof wartosc;
  if (typ === "number" || typ === "boolean" || typ === "string") return JSON.stringify(wartosc);
  if (Array.isArray(wartosc)) {
    var elementy = wartosc.map(function (v) { return kanoniczny(v); });
    return "[" + elementy.join(",") + "]";
  }
  if (typ === "object") {
    var klucze = Object.keys(wartosc).filter(function (k) { return wartosc[k] !== undefined; }).sort();
    var czesci = klucze.map(function (k) {
      return JSON.stringify(k) + ":" + kanoniczny(wartosc[k]);
    });
    return "{" + czesci.join(",") + "}";
  }
  return JSON.stringify(null);
}

function kanonicznySha256(wartosc) { return sha256Hex(kanoniczny(wartosc)); }

/* ---------------------------------------------------------------------------
   Dowód Merkle (RFC 6962) - ten sam algorytm co w Patronie.
--------------------------------------------------------------------------- */
var HEX64 = /^[0-9a-f]{64}$/;

function hashPary(lewy, prawy) {
  if (!HEX64.test(lewy) || !HEX64.test(prawy)) throw new Error("hash w dowodzie nie ma formatu 64 znaków szesnastkowych");
  return sha256Hex(lewy + prawy);
}

function sprawdzDowodMerkle(hashZdarzenia, dowod, oczekiwanyKorzen) {
  if (!HEX64.test(hashZdarzenia)) throw new Error("hash zdarzenia ma zły format");
  if (!HEX64.test(oczekiwanyKorzen)) throw new Error("korzeń Merkle ma zły format");
  var biezacy = hashZdarzenia, i, krok;
  for (i = 0; i < dowod.length; i++) {
    krok = dowod[i];
    if (krok.position === "left") biezacy = hashPary(krok.hash, biezacy);
    else if (krok.position === "right") biezacy = hashPary(biezacy, krok.hash);
    else throw new Error("krok dowodu ma nieznaną pozycję");
  }
  return biezacy === oczekiwanyKorzen;
}

/* ---------------------------------------------------------------------------
   Weryfikacja artefaktu
--------------------------------------------------------------------------- */
var WERSJA_SCHEMATU = "1.0";

function sprawdzIntegralnosc(dok) {
  var integralnosc = dok.integrity;
  if (!integralnosc || typeof integralnosc !== "object") throw new Error("brak sekcji integrity");
  if (integralnosc.algorithm !== "SHA-256") throw new Error("nieobsługiwany algorytm: " + integralnosc.algorithm);
  if (typeof integralnosc.canonical_sha256 !== "string") throw new Error("brak integrity.canonical_sha256");
  var cialo = {}, k;
  for (k in dok) if (Object.prototype.hasOwnProperty.call(dok, k) && k !== "integrity") cialo[k] = dok[k];
  var policzony = kanonicznySha256(cialo);
  return { ok: policzony === integralnosc.canonical_sha256, wPliku: integralnosc.canonical_sha256, policzony: policzony };
}

/* ---------------------------------------------------------------------------
   Hash wpisu dziennika przeliczony z treści - ten sam wzór co w Patronie:
   SHA-256( prev_hash + kanoniczny({ts, event_type, actor_user_id, chat_id,
   document_id, payload}) ). Liczony tylko dla wpisów z hash_inputs_complete:
   tam payload nie był maskowany, więc plik niesie dokładnie to, co hashowano.
--------------------------------------------------------------------------- */
var GENEZA = "0000000000000000000000000000000000000000000000000000000000000000";

function przeliczHash(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  if (typeof e.prev_hash !== "string" || typeof e.ts !== "string" || typeof e.event_type !== "string") return null;
  var p = e.payload_masked;
  var tresc = {
    ts: e.ts,
    event_type: e.event_type,
    actor_user_id: e.actor_user_id === undefined ? null : e.actor_user_id,
    chat_id: e.chat_id === undefined ? null : e.chat_id,
    document_id: e.document_id === undefined ? null : e.document_id,
    payload: (p === null || p === undefined) ? {} : p
  };
  return sha256Hex(e.prev_hash + kanoniczny(tresc));
}

function jestId(x) {
  return typeof x === "number" && isFinite(x) && Math.floor(x) === x;
}

/* ---------------------------------------------------------------------------
   Zerwanie z mocy prawa (RODO art. 17). Wpis zanonimizowany po zapisie ma
   znacznik legal_break: jego hash (liść Merkle, ogniwo łańcucha) jest
   ORYGINALNY, a treść - już po anonimizacji - musi dawać hash_after z
   deklaracji audit.chain.legal_break, która jedzie w tym samym pliku.
   Lustro checkLegalBreakMarker (Patron) i check_legal_break (verify.py).
   Zwraca listę problemów; pusta = zerwanie potwierdzone.
--------------------------------------------------------------------------- */
var POLA_ZERWANIA = ["actor_user_id", "chat_id", "document_id"];
var ZDARZENIE_ZERWANIA = "audit.chain.legal_break";

function etykietaPowodu(powod) {
  return powod === "rodo_art_17_anonymization" ? "RODO art. 17" : String(powod);
}

function sprawdzZerwanie(e, deklaracje) {
  var nr = String(e.id), L = e.legal_break, problemy = [], h, D = null, i, x, p, powod, pole, ids, po, k;
  var zlyFormat = "wpis " + nr + ": znacznik zerwania z mocy prawa ma zły format";
  if (!L || typeof L !== "object" || Array.isArray(L)) return [zlyFormat];
  if (!jestId(L.declaration_event_id) || typeof L.reason !== "string" || typeof L.field !== "string" ||
      POLA_ZERWANIA.indexOf(L.field) < 0 || typeof L.hash_after !== "string" || !HEX64.test(L.hash_after)) {
    return [zlyFormat];
  }
  if (e[L.field] !== null && e[L.field] !== undefined) {
    problemy.push("wpis " + nr + ": pole " + L.field + " nie jest wyzerowane, choć znacznik tak twierdzi");
  }
  if (L.hash_after === e.hash) {
    problemy.push("wpis " + nr + ": hash po zerwaniu równy oryginalnemu - znacznik bez pokrycia");
  }
  if (e.hash_inputs_complete === true) {
    h = przeliczHash(e);
    if (h === null) problemy.push("wpis " + nr + ": niepełny - brak pól potrzebnych do przeliczenia hasha");
    else if (h !== L.hash_after) problemy.push("wpis " + nr + ": treść różni się od zadeklarowanej po zerwaniu - zmiana po anonimizacji");
  }
  for (i = 0; i < deklaracje.length; i++) {
    x = deklaracje[i];
    if (x && typeof x === "object" && !Array.isArray(x) && x.id === L.declaration_event_id) { D = x; break; }
  }
  if (!D) {
    problemy.push("wpis " + nr + ": deklaracji #" + L.declaration_event_id + " nie ma w pliku");
    return problemy;
  }
  if (D.event_type !== ZDARZENIE_ZERWANIA) {
    problemy.push("deklaracja #" + L.declaration_event_id + " nie jest zdarzeniem " + ZDARZENIE_ZERWANIA);
  }
  if (!jestId(e.id) || !(L.declaration_event_id > e.id)) {
    problemy.push("deklaracja #" + L.declaration_event_id + " nie jest późniejsza od wpisu " + nr);
  }
  if (D.hash_inputs_complete === true) {
    h = przeliczHash(D);
    if (h === null) problemy.push("deklaracja #" + L.declaration_event_id + ": niepełna - brak pól potrzebnych do przeliczenia hasha");
    else if (h !== D.hash) problemy.push("deklaracja #" + L.declaration_event_id + ": treść nie zgadza się z jej hashem - deklarację zmieniono");
  }
  p = D.payload_masked;
  if (!p || typeof p !== "object" || Array.isArray(p)) {
    problemy.push("deklaracja #" + L.declaration_event_id + ": nieczytelna treść");
    return problemy;
  }
  powod = typeof p.reason === "string" ? p.reason : "nieznany powod";
  pole = typeof p.field === "string" ? p.field : "actor_user_id";
  if (powod !== L.reason || pole !== L.field) {
    problemy.push("deklaracja #" + L.declaration_event_id + " nazywa inny powód albo inne pole niż znacznik wpisu " + nr);
  }
  ids = p.affected_ids;
  po = p.affected_hashes_after;
  if (!Array.isArray(ids) || !Array.isArray(po) || po.length !== ids.length) {
    problemy.push("deklaracja #" + L.declaration_event_id + " bez hashy po zerwaniu (stary format) - zmiany treści po anonimizacji nie da się wykluczyć");
    return problemy;
  }
  k = -1;
  for (i = 0; i < ids.length; i++) {
    if (jestId(ids[i]) && ids[i] === e.id) { k = i; break; }
  }
  if (k < 0) problemy.push("deklaracja #" + L.declaration_event_id + " nie wymienia wpisu " + nr);
  else if (po[k] !== L.hash_after) problemy.push("deklaracja #" + L.declaration_event_id + " podaje inny hash po zerwaniu dla wpisu " + nr);
  return problemy;
}

/* Opis zerwań do nagłówka: "(RODO art. 17), zadeklarowane zdarzeniem #N". */
function opisZerwania(zerwanie) {
  var nr = zerwanie.deklaracje.map(function (d) { return "#" + d; }).join(", ");
  return "zerwanie z mocy prawa (" + zerwanie.powody.join(", ") + "), zadeklarowane " +
    (zerwanie.deklaracje.length > 1 ? "zdarzeniami " : "zdarzeniem ") + nr;
}

function dodajZerwanie(zbior, L) {
  if (zbior.deklaracje.indexOf(L.declaration_event_id) < 0) zbior.deklaracje.push(L.declaration_event_id);
  var etykieta = etykietaPowodu(L.reason);
  if (zbior.powody.indexOf(etykieta) < 0) zbior.powody.push(etykieta);
}

/* Wyciąg z dziennika w pakiecie dokumentu to wpisy JEDNEJ sprawy - między nimi
   leżą zdarzenia innych spraw i systemowe, których plik nie zawiera. Ogniwo
   sprawdzamy, gdy poprzednik jest w wyciągu; przy kolejnych numerach (albo
   gdy wydawca zadeklarował poprzednika w wyciągu) jest ono WYMAGANE. Reszta to
   luki - raportowane jawnie, bez werdyktu. Lustro verifyAuditExcerpt. */
function sprawdzWyciag(wpisy, deklaracje) {
  var problemy = [], ogniwa = 0, luki = 0, przeliczone = 0, zamaskowane = 0, zerwane = 0, z;
  var zerwanie = { deklaracje: [], powody: [] };
  if (!Array.isArray(wpisy)) {
    return { ok: false, opis: "Wyciąg z dziennika nie jest listą." };
  }
  var znane = Object.create(null), poprzedni = null, i, e, id, h, ph;
  for (i = 0; i < wpisy.length; i++) {
    e = wpisy[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) { problemy.push("wpis wyciągu nie jest obiektem"); continue; }
    id = e.id;
    if (!jestId(id)) { problemy.push("wpis bez poprawnego numeru"); continue; }
    if (poprzedni && !(id > poprzedni.id)) {
      problemy.push("numery nie rosną (wpis " + id + " po " + poprzedni.id + ") - kolejność zmieniona");
    }
    if (e.legal_break !== undefined && e.legal_break !== null) {
      z = sprawdzZerwanie(e, deklaracje);
      if (z.length > 0) problemy.push.apply(problemy, z);
      else { zerwane++; dodajZerwanie(zerwanie, e.legal_break); }
    } else if (e.hash_inputs_complete === true) {
      h = przeliczHash(e);
      if (h === null) problemy.push("wpis " + id + ": niepełny - brak pól potrzebnych do przeliczenia hasha");
      else if (h !== e.hash) problemy.push("wpis " + id + ": treść nie zgadza się z hashem");
      else przeliczone++;
    } else {
      zamaskowane++;
    }
    ph = e.prev_hash;
    if (typeof ph === "string" && Object.prototype.hasOwnProperty.call(znane, ph)) {
      ogniwa++;
    } else if (ph === GENEZA) {
      /* początek łańcucha */
    } else if (e.parent_in_excerpt === true) {
      problemy.push("wpis " + id + ": poprzednika zadeklarowanego w wyciągu nie ma w pliku - wpis usunięto");
    } else if (poprzedni && id === poprzedni.id + 1) {
      if (ph === poprzedni.prev_hash) ogniwa++;
      else problemy.push("ogniwo między kolejnymi wpisami " + poprzedni.id + " i " + id + " przerwane");
    } else if (poprzedni) {
      luki++;
    }
    if (typeof e.hash === "string") znane[e.hash] = id;
    poprzedni = e;
  }
  if (problemy.length > 0) {
    return {
      ok: false,
      opis: "Wykryto: " + problemy.map(esc).join("; ") +
            ". Wpis zmieniono, usunięto z wyciągu albo zmieniono kolejność."
    };
  }
  var opis = "Wyciąg zawiera " + wpisy.length + " wpisów tej sprawy. Sprawdzono " + ogniwa +
    " ogniw między wpisami wyciągu; hash " + przeliczone + " wpisów przeliczono z ich treści.";
  if (zamaskowane > 0) {
    opis += " " + zamaskowane + " wpisów ma treść zamaskowaną (dane osobowe) - ich hashu nie da się " +
      "przeliczyć z tego pliku; zgodność treści z hashem sprawdził system kancelarii przed wydaniem.";
  }
  if (luki > 0) {
    opis += " <strong>To wyciąg, nie pełny łańcuch:</strong> " + luki + " luk - między wpisami tej sprawy " +
      "leżą zdarzenia innych spraw i systemowe, których plik nie zawiera; ogniw przez luki nie da się " +
      "sprawdzić z tego pliku.";
  }
  if (zerwane > 0) {
    zerwanie.deklaracje.sort(function (a, b) { return a - b; });
    opis += " <strong>Zerwanie z mocy prawa:</strong> " + zerwane + " wpisów zanonimizowano po zapisie (" +
      esc(zerwanie.powody.join(", ")) + "). Ich hash w łańcuchu i w ogniwach jest oryginalny, a treść zgadza się " +
      "z hashem po zerwaniu z deklaracji " + esc(zerwanie.deklaracje.map(function (d) { return "#" + d; }).join(", ")) +
      "; deklaracja jest w pliku, nienaruszona i wymienia te wpisy.";
  }
  return { ok: true, opis: opis, zerwanie: zerwane > 0 ? zerwanie : null };
}

/* Zdarzenie w paczce audytora musi być TYM, którego dotyczy dowód Merkle,
   a gdy payload nie był maskowany - zgadzać się z własnym hashem. */
function sprawdzZdarzenie(dok) {
  var e = dok.event, b = dok.merkle_proof_bundle, problemy = [], przeliczony = false, h, z, dekl, zerwanie = null;
  if (!e || typeof e !== "object" || !b || typeof b !== "object") {
    return { ok: false, opis: "Brak sekcji <code>event</code> albo <code>merkle_proof_bundle</code>." };
  }
  if (e.id !== b.event_id) problemy.push("numer zdarzenia różni się od numeru w dowodzie");
  if (e.hash !== b.event_hash) problemy.push("hash zdarzenia różni się od hasha w dowodzie");
  if (e.legal_break !== undefined && e.legal_break !== null) {
    dekl = dok.legal_break_declaration;
    z = sprawdzZerwanie(e, (dekl === undefined || dekl === null) ? [] : [dekl]);
    problemy.push.apply(problemy, z);
    if (z.length === 0) {
      zerwanie = { deklaracje: [e.legal_break.declaration_event_id], powody: [etykietaPowodu(e.legal_break.reason)] };
    }
  } else if (e.hash_inputs_complete === true) {
    h = przeliczHash(e);
    if (h === null) problemy.push("niepełny wpis - brak pól potrzebnych do przeliczenia hasha");
    else if (h !== e.hash) problemy.push("treść zdarzenia nie zgadza się z jego hashem");
    else przeliczony = true;
  }
  if (problemy.length > 0) {
    return { ok: false, opis: "Wykryto: " + problemy.map(esc).join("; ") + "." };
  }
  if (zerwanie) {
    return {
      ok: true,
      zerwanie: zerwanie,
      opis: "Zdarzenie jest tym z dowodu (hash oryginalny: <code>" + esc(e.hash) + "</code>). Jego treść " +
        "zanonimizowano po zapisie z mocy prawa (" + esc(zerwanie.powody[0]) + ", pole " + esc(e.legal_break.field) +
        ")" + (e.hash_inputs_complete === true
          ? " i daje dokładnie hash po zerwaniu z deklaracji: <code>" + esc(e.legal_break.hash_after) + "</code>."
          : "; treść jest zamaskowana, więc zgodność z hashem po zerwaniu sprawdził system kancelarii przed wydaniem.") +
        " Deklaracja #" + esc(e.legal_break.declaration_event_id) + " jest w pliku i wymienia ten wpis z tym hashem."
    };
  }
  return {
    ok: true,
    opis: przeliczony
      ? "Zdarzenie jest tym z dowodu, a jego hash przeliczony z treści zgadza się: <code>" + esc(e.hash) + "</code>"
      : "Zdarzenie jest tym z dowodu. Treść jest zamaskowana (dane osobowe), więc hashu nie da się przeliczyć " +
        "z tego pliku - zgodność treści z hashem sprawdził system kancelarii przed wydaniem."
  };
}

function zweryfikuj(dok) {
  var rodzaj = dok.pack_kind || dok.bundle_kind;
  var kroki = [];
  var zerwanie = null;

  if (rodzaj !== "audit_event_export" && rodzaj !== "deliverable_audit_bundle") {
    throw new Error("Nieznany rodzaj artefaktu: " + String(rodzaj));
  }
  if (dok.schema_version !== WERSJA_SCHEMATU) {
    throw new Error("Wersja schematu " + String(dok.schema_version) +
      " nie jest obsługiwana przez ten weryfikator (obsługiwana: " + WERSJA_SCHEMATU + ").");
  }

  if (rodzaj === "audit_event_export") {
    var integ = sprawdzIntegralnosc(dok);
    kroki.push({
      ok: integ.ok, tytul: "Integralność pliku",
      opis: integ.ok
        ? "Suma kontrolna zgadza się z zapisaną w pliku: <code>" + integ.wPliku + "</code>"
        : "Treść zmieniono po wydaniu. W pliku: <code>" + integ.wPliku + "</code>, policzona: <code>" + integ.policzony + "</code>"
    });

    var wiazanie = sprawdzZdarzenie(dok);
    kroki.push({ ok: wiazanie.ok, tytul: "Zgodność zdarzenia z dowodem", opis: wiazanie.opis });
    if (wiazanie.ok && wiazanie.zerwanie) zerwanie = wiazanie.zerwanie;

    var paczka = dok.merkle_proof_bundle;
    if (!paczka || typeof paczka !== "object") {
      kroki.push({ ok: false, tytul: "Dowód przynależności do dziennika", opis: "Brak sekcji <code>merkle_proof_bundle</code>." });
    } else if (paczka.event_id < paczka.chain_block_start || paczka.event_id > paczka.chain_block_end) {
      kroki.push({ ok: false, tytul: "Dowód przynależności do dziennika",
        opis: "Zdarzenie " + paczka.event_id + " leży poza blokiem [" + paczka.chain_block_start + ", " + paczka.chain_block_end + "]." });
    } else {
      var dobry = sprawdzDowodMerkle(paczka.event_hash, paczka.proof || [], paczka.merkle_root);
      kroki.push({
        ok: dobry, tytul: "Dowód przynależności do dziennika",
        opis: dobry
          ? "Zdarzenie " + paczka.event_id + " odtwarza zapieczętowany korzeń <code>" + paczka.merkle_root + "</code>" +
            (wiazanie.zerwanie ? " (dowód dotyczy oryginalnego hasha wpisu, sprzed zerwania z mocy prawa)" : "")
          : "Dowód nie odtwarza korzenia - wpis w dzienniku kancelarii zmieniono, usunięto albo przestawiono."
      });
    }
  } else {
    var wartosciCzesci = {
      deliverable: dok.deliverable,
      citation_verification: dok.citation_verification,
      audit_log_excerpt: dok.audit_log_excerpt,
      legal_break_declarations: dok.legal_break_declarations,
      model_versions: dok.model_versions,
      cost_log: dok.cost_log
    };
    var czesci = (dok.manifest && dok.manifest.parts) || [];
    var naruszone = czesci.filter(function (cz) {
      return kanonicznySha256(wartosciCzesci[cz.name]) !== cz.sha256;
    }).map(function (cz) { return cz.name; });

    kroki.push({
      ok: naruszone.length === 0, tytul: "Zgodność części składowych",
      opis: naruszone.length === 0
        ? "Wszystkie " + czesci.length + " części (dokument, weryfikacja cytatów, wyciąg z dziennika, wersje modelu, koszt) zgadzają się z wykazem."
        : "Zmieniono następujące części: <strong>" + naruszone.join(", ") + "</strong>."
    });

    var ciag = sprawdzWyciag(dok.audit_log_excerpt,
      Array.isArray(dok.legal_break_declarations) ? dok.legal_break_declarations : []);
    kroki.push({ ok: ciag.ok, tytul: "Ciągłość wyciągu z dziennika", opis: ciag.opis });
    if (ciag.ok && ciag.zerwanie) zerwanie = ciag.zerwanie;

    var integ2 = sprawdzIntegralnosc(dok);
    kroki.push({
      ok: integ2.ok, tytul: "Integralność całości",
      opis: integ2.ok
        ? "Suma kontrolna całego pakietu zgadza się: <code>" + integ2.wPliku + "</code>"
        : "Pakiet zmieniono po wydaniu. W pliku: <code>" + integ2.wPliku + "</code>, policzona: <code>" + integ2.policzony + "</code>"
    });
  }

  var wszystkoOk = kroki.every(function (k) { return k.ok; });
  /* Trzy stany, jak kody verify.py: ok (0), legal_break (3), naruszony (1).
     ok:true znaczy "nie wykryto manipulacji" - także przy zerwaniu z mocy prawa. */
  var stan = !wszystkoOk ? "naruszony" : (zerwanie ? "legal_break" : "ok");
  if (stan === "legal_break") {
    kroki.push({
      ok: true, uwaga: true, tytul: "Zerwanie z mocy prawa",
      opis: "Wpis zanonimizowano po zapisie na podstawie obowiązku prawnego - " + esc(opisZerwania(zerwanie)) +
        ". To nie jest naruszenie, ale wpis nie jest już w pierwotnej postaci: jego oryginalnej treści " +
        "nie da się odtworzyć z tego pliku."
    });
  }
  return { ok: wszystkoOk, stan: stan, zerwanie: stan === "legal_break" ? zerwanie : null, rodzaj: rodzaj, kroki: kroki };
}

/* ---------------------------------------------------------------------------
   Warstwa widoku
--------------------------------------------------------------------------- */
var NAZWY_RODZAJU = {
  audit_event_export: "wyciąg pojedynczego zdarzenia z dziennika",
  deliverable_audit_bundle: "pakiet dokumentu końcowego"
};

function esc(t) {
  return String(t).replace(/[&<>"]/g, function (z) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[z];
  });
}

function pokazBlad(nazwaPliku, wiadomosc) {
  var el = document.getElementById("wynik");
  el.className = "widoczny";
  el.innerHTML =
    '<div class="werdykt zle"><h2>Nie udało się sprawdzić pliku</h2><p>' + esc(wiadomosc) + "</p></div>" +
    '<dl class="meta"><dt>Plik</dt><dd>' + esc(nazwaPliku) + "</dd></dl>";
}

function pokazWynik(nazwaPliku, dok, wynik) {
  var el = document.getElementById("wynik");
  el.className = "widoczny";

  var naglowek = !wynik.ok
    ? '<div class="werdykt zle"><h2>Integralność naruszona</h2><p>Ten plik nie może być uznany za wiarygodny zapis. Szczegóły poniżej.</p></div>'
    : wynik.stan === "legal_break"
      ? '<div class="werdykt uwaga"><h2>OK - ' + esc(opisZerwania(wynik.zerwanie)) + '</h2><p>Plik nie został ' +
        "zmieniony po wydaniu przez kancelarię. Wpis z dziennika zanonimizowano po zapisie na podstawie obowiązku " +
        "prawnego, a deklaracja tego zerwania jest w pliku i została sprawdzona. Nie jest to naruszenie, ale też " +
        "nie jest to wpis w pierwotnej postaci.</p></div>"
      : '<div class="werdykt ok"><h2>Artefakt nienaruszony</h2><p>Plik nie został zmieniony po wydaniu przez kancelarię.</p></div>';

  var meta = '<dl class="meta">' +
    "<dt>Plik</dt><dd>" + esc(nazwaPliku) + "</dd>" +
    "<dt>Rodzaj</dt><dd>" + esc(NAZWY_RODZAJU[wynik.rodzaj] || wynik.rodzaj) + "</dd>" +
    "<dt>Data wydania</dt><dd>" + esc(dok.exported_at || dok.created_at || "nie podano") + "</dd>" +
    (dok.exporter && dok.exporter.email ? "<dt>Wydał</dt><dd>" + esc(dok.exporter.email) + "</dd>" : "") +
    (dok.event ? "<dt>Zdarzenie</dt><dd>nr " + esc(dok.event.id) + ", " + esc(dok.event.event_type) + ", " + esc(dok.event.ts) + "</dd>" : "") +
    "<dt>Sprawdzono</dt><dd>" + esc(new Date().toLocaleString("pl-PL")) + "</dd>" +
    "</dl>";

  var kroki = '<ol class="kroki">' + wynik.kroki.map(function (k) {
    var klasa = !k.ok ? "zle" : (k.uwaga ? "uwaga" : "ok");
    return "<li><div class='krok-glowa'><span class='znacznik " + klasa + "'>" +
      (!k.ok ? "✗" : (k.uwaga ? "!" : "✓")) + "</span><span class='krok-tytul'>" + esc(k.tytul) + "</span></div>" +
      "<p class='krok-opis'>" + k.opis + "</p></li>";
  }).join("") + "</ol>";

  var zastrzezenie =
    '<p class="zastrzezenie"><strong>Zakres tego sprawdzenia.</strong> Weryfikator wykrywa zmianę, ' +
    "usunięcie i przestawienie zapisów. Nie dowodzi natomiast, że plik wystawiła konkretna kancelaria - " +
    "do tego służy podpis kwalifikowany, którego ten artefakt jeszcze nie niesie. " +
    "Hash wpisu jest przeliczany z treści tam, gdzie treść nie była maskowana. Wpisów z zamaskowanymi " +
    "danymi osobowymi nie da się przeliczyć z tego pliku - ich zgodność z hashem sprawdza system kancelarii " +
    "przed wydaniem (niezgodny wpis blokuje wydanie). Wyciąg w pakiecie dokumentu obejmuje jedną sprawę, " +
    "więc nie jest pełnym łańcuchem: luki są pokazane wprost. Wpis zanonimizowany z mocy prawa (RODO art. 17) " +
    "jest sprawdzany wobec deklaracji zerwania dołączonej do pliku i daje osobny wynik.</p>" +
    '<p style="margin-top:1.5rem"><button class="drukuj" type="button" onclick="window.print()">Wydrukuj wynik</button></p>';

  el.innerHTML = naglowek + meta + kroki + zastrzezenie;
}

function obsluzPlik(plik) {
  var czytnik = new FileReader();
  czytnik.onload = function () {
    var dok;
    try {
      dok = JSON.parse(czytnik.result);
    } catch (e) {
      pokazBlad(plik.name, "Plik nie jest poprawnym dokumentem JSON.");
      return;
    }
    if (!dok || typeof dok !== "object" || Array.isArray(dok)) {
      pokazBlad(plik.name, "Zawartość pliku nie jest obiektem JSON.");
      return;
    }
    try {
      pokazWynik(plik.name, dok, zweryfikuj(dok));
    } catch (e) {
      pokazBlad(plik.name, e && e.message ? e.message : String(e));
    }
  };
  czytnik.onerror = function () { pokazBlad(plik.name, "Nie udało się odczytać pliku."); };
  czytnik.readAsText(plik, "utf-8");
}

/* === PODPIĘCIE DO STRONY ===
   Wszystko powyżej tej linii to czyste funkcje bez dostępu do DOM. Test w repo
   wycina ten fragment i sprawdza dokładnie ten kod, który trafia do odbiorcy. */
(function () {
  var strefa = document.getElementById("strefa");
  var wejscie = document.getElementById("plik");

  strefa.addEventListener("click", function () { wejscie.click(); });
  strefa.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); wejscie.click(); }
  });
  wejscie.addEventListener("change", function () {
    if (wejscie.files && wejscie.files[0]) obsluzPlik(wejscie.files[0]);
  });
  ["dragenter", "dragover"].forEach(function (n) {
    strefa.addEventListener(n, function (e) { e.preventDefault(); strefa.classList.add("nad"); });
  });
  ["dragleave", "drop"].forEach(function (n) {
    strefa.addEventListener(n, function (e) { e.preventDefault(); strefa.classList.remove("nad"); });
  });
  strefa.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) obsluzPlik(e.dataTransfer.files[0]);
  });

  /* Umożliwia sprawdzenie tego samego kodu poza przeglądarką (testy w repo). */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { sha256Hex: sha256Hex, kanoniczny: kanoniczny, kanonicznySha256: kanonicznySha256, zweryfikuj: zweryfikuj };
  }
})();
</script>
</body>
</html>
`;

/**
 * Weryfikator wiersza polecen - wylacznie biblioteka standardowa Pythona 3.8+.
 * Kody wyjscia 0/1/2 nadaja sie do kontroli automatycznej po stronie odbiorcy.
 */
export const VERIFIER_PY = String.raw`#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Weryfikator artefaktu audytowego Patrona - samodzielny, biblioteka standardowa.

Odbiorca (sad, regulator, klient kancelarii) potrzebuje WYLACZNIE Pythona 3.8+.
Zero instalacji, zero sieci, zero dostepu do bazy kancelarii, zero kodu Patrona.

Uzycie:
    python verify.py <plik.json>

Kody wyjscia:
    0 - artefakt nienaruszony
    1 - integralnosc naruszona (wpis zmieniony, usuniety lub przestawiony)
    2 - blad wejscia/wyjscia, zly JSON albo nieobslugiwany format
    3 - artefakt nienaruszony, ale zawiera wpis zerwany z mocy prawa
        (np. anonimizacja RODO art. 17), zadeklarowany i potwierdzony
        deklaracja dolaczona do pliku - ani naruszony, ani czyste OK

Obsluguje dwa rodzaje artefaktu:
    audit_event_export      (pack)   - integralnosc pliku + zgodnosc zdarzenia
                                       z dowodem (i z deklaracja zerwania z mocy
                                       prawa, gdy wpis ja niesie) + dowod Merkle
    deliverable_audit_bundle (bundle) - manifest per czesc + wyciag z dziennika
                                       + integralnosc calosci
"""

import hashlib
import json
import math
import re
import sys

SCHEMA_VERSION = "1.0"
HASH_HEX_RE = re.compile(r"^[0-9a-f]{64}$")

# ---------------------------------------------------------------------------
# Kanoniczna serializacja
#
# MUSI dawac znak w znak ten sam wynik co canonicalJsonStringify z Patrona
# (backend/src/lib/audit-pack.ts): obiekty - klucze posortowane alfabetycznie,
# rekurencyjnie; tablice - kolejnosc zachowana; separatory bez spacji.
#
# Formatowanie liczb i escape'owanie tekstu odtwarza JSON.stringify z
# JavaScriptu. Tam, gdzie nie umiemy tego zagwarantowac, przerywamy z bledem
# zamiast policzyc inny hash - falszywy werdykt "naruszony" na zdrowym
# artefakcie bylby grozniejszy niz brak odpowiedzi.
# ---------------------------------------------------------------------------

_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


def _js_string(s):
    out = ['"']
    for ch in s:
        esc = _ESCAPES.get(ch)
        if esc is not None:
            out.append(esc)
        elif ch < " ":
            out.append("\\u%04x" % ord(ch))
        elif "\ud800" <= ch <= "\udfff":
            # Samotny surogat - JavaScript (ES2019) zapisuje go jako \udXXX.
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _js_number(n):
    if isinstance(n, int):
        return str(n)
    if math.isnan(n) or math.isinf(n):
        return "null"  # tak samo robi JSON.stringify
    if n == int(n) and abs(n) < 1e21:
        # JavaScript nie zapisuje ".0" - 1.0 to "1"
        return str(int(n))
    r = repr(n)
    if "e" in r or "E" in r:
        mantissa, _, exponent = r.partition("e")
        sign = ""
        if exponent and exponent[0] in "+-":
            sign, exponent = exponent[0], exponent[1:]
        exponent = exponent.lstrip("0") or "0"
        # JavaScript pisze wykladnik bez zer wiodacych: 1e-7, nie 1e-07
        r = "%se%s%s" % (mantissa, sign if sign else "+", exponent)
    return r


def canonical(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _js_string(value)
    if isinstance(value, (int, float)):
        return _js_number(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    if isinstance(value, dict):
        parts = []
        for k in sorted(value.keys()):
            if not isinstance(k, str):
                raise ValueError("klucz obiektu nie jest tekstem: %r" % (k,))
            parts.append("%s:%s" % (_js_string(k), canonical(value[k])))
        return "{" + ",".join(parts) + "}"
    raise ValueError("nieobslugiwany typ w artefakcie: %r" % (type(value),))


def canonical_sha256(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Dowod Merkle (RFC 6962) - ten sam algorytm co backend/src/lib/audit-merkle.ts
# ---------------------------------------------------------------------------


def _hash_pair(left, right):
    if not HASH_HEX_RE.match(left) or not HASH_HEX_RE.match(right):
        raise ValueError("hash w dowodzie nie ma formatu 64 znakow szesnastkowych")
    return hashlib.sha256((left + right).encode("utf-8")).hexdigest()


def verify_merkle_proof(target_hash, proof, expected_root):
    if not HASH_HEX_RE.match(target_hash):
        raise ValueError("hash zdarzenia nie ma formatu 64 znakow szesnastkowych")
    if not HASH_HEX_RE.match(expected_root):
        raise ValueError("korzen Merkle nie ma formatu 64 znakow szesnastkowych")
    current = target_hash
    for step in proof:
        sibling = step.get("hash")
        position = step.get("position")
        if position == "left":
            current = _hash_pair(sibling, current)
        elif position == "right":
            current = _hash_pair(current, sibling)
        else:
            raise ValueError("krok dowodu ma nieznana pozycje: %r" % (position,))
    return current == expected_root


# ---------------------------------------------------------------------------
# Weryfikacja
# ---------------------------------------------------------------------------


def _check_integrity(doc):
    """Zwraca (ok, oczekiwany, policzony)."""
    integrity = doc.get("integrity")
    if not isinstance(integrity, dict):
        raise ValueError("brak sekcji integrity")
    if integrity.get("algorithm") != "SHA-256":
        raise ValueError("nieobslugiwany algorytm: %r" % (integrity.get("algorithm"),))
    expected = integrity.get("canonical_sha256")
    if not isinstance(expected, str):
        raise ValueError("brak integrity.canonical_sha256")
    body = {k: v for k, v in doc.items() if k != "integrity"}
    actual = canonical_sha256(body)
    return (actual == expected, expected, actual)


GENESIS_HASH = "0" * 64


def _is_id(x):
    if isinstance(x, bool):
        return False
    if isinstance(x, int):
        return True
    return isinstance(x, float) and x.is_integer()


def recompute_event_hash(e):
    """
    Hash wpisu dziennika z jego tresci - ten sam wzor co w Patronie:
    SHA-256(prev_hash + kanoniczny({ts, event_type, actor_user_id, chat_id,
    document_id, payload})). None, gdy brak pol tekstowych do przeliczenia.
    """
    if not isinstance(e, dict):
        return None
    prev, ts, et = e.get("prev_hash"), e.get("ts"), e.get("event_type")
    if not (isinstance(prev, str) and isinstance(ts, str) and isinstance(et, str)):
        return None
    payload = e.get("payload_masked")
    if payload is None:
        payload = {}
    content = {
        "ts": ts,
        "event_type": et,
        "actor_user_id": e.get("actor_user_id"),
        "chat_id": e.get("chat_id"),
        "document_id": e.get("document_id"),
        "payload": payload,
    }
    return hashlib.sha256((prev + canonical(content)).encode("utf-8")).hexdigest()


LEGAL_BREAK_FIELDS = ("actor_user_id", "chat_id", "document_id")
LEGAL_BREAK_EVENT = "audit.chain.legal_break"


def reason_label(reason):
    return "RODO art. 17" if reason == "rodo_art_17_anonymization" else str(reason)


def check_legal_break(e, declarations):
    """
    Zerwanie z mocy prawa (np. RODO art. 17). Wpis zanonimizowany po zapisie
    niesie znacznik legal_break: jego hash (lisc Merkle, ogniwo lancucha) jest
    ORYGINALNY, a tresc - juz po anonimizacji - musi dawac hash_after z
    deklaracji audit.chain.legal_break dolaczonej do pliku. Lustro
    checkLegalBreakMarker (Patron) i sprawdzZerwanie (HTML).
    Zwraca liste problemow; pusta = zerwanie potwierdzone.
    """
    nr = str(e.get("id"))
    lb = e.get("legal_break")
    bad = ["wpis %s: znacznik zerwania z mocy prawa ma zly format" % nr]
    if not isinstance(lb, dict):
        return bad
    decl_id = lb.get("declaration_event_id")
    field = lb.get("field")
    after = lb.get("hash_after")
    if not (_is_id(decl_id) and isinstance(lb.get("reason"), str) and isinstance(field, str)
            and field in LEGAL_BREAK_FIELDS and isinstance(after, str) and HASH_HEX_RE.fullmatch(after)):
        return bad
    problems = []
    if e.get(field) is not None:
        problems.append("wpis %s: pole %s nie jest wyzerowane, choc znacznik tak twierdzi" % (nr, field))
    if after == e.get("hash"):
        problems.append("wpis %s: hash po zerwaniu rowny oryginalnemu - znacznik bez pokrycia" % nr)
    if e.get("hash_inputs_complete") is True:
        h = recompute_event_hash(e)
        if h is None:
            problems.append("wpis %s: niepelny - brak pol potrzebnych do przeliczenia hasha" % nr)
        elif h != after:
            problems.append("wpis %s: tresc rozni sie od zadeklarowanej po zerwaniu - zmiana po anonimizacji" % nr)
    d = None
    for x in declarations:
        if isinstance(x, dict) and _is_id(x.get("id")) and x.get("id") == decl_id:
            d = x
            break
    if d is None:
        problems.append("wpis %s: deklaracji #%s nie ma w pliku" % (nr, decl_id))
        return problems
    if d.get("event_type") != LEGAL_BREAK_EVENT:
        problems.append("deklaracja #%s nie jest zdarzeniem %s" % (decl_id, LEGAL_BREAK_EVENT))
    if not (_is_id(e.get("id")) and decl_id > e.get("id")):
        problems.append("deklaracja #%s nie jest pozniejsza od wpisu %s" % (decl_id, nr))
    if d.get("hash_inputs_complete") is True:
        h = recompute_event_hash(d)
        if h is None:
            problems.append("deklaracja #%s: niepelna - brak pol potrzebnych do przeliczenia hasha" % decl_id)
        elif h != d.get("hash"):
            problems.append("deklaracja #%s: tresc nie zgadza sie z jej hashem - deklaracje zmieniono" % decl_id)
    p = d.get("payload_masked")
    if not isinstance(p, dict):
        problems.append("deklaracja #%s: nieczytelna tresc" % decl_id)
        return problems
    reason = p.get("reason") if isinstance(p.get("reason"), str) else "nieznany powod"
    pfield = p.get("field") if isinstance(p.get("field"), str) else "actor_user_id"
    if reason != lb.get("reason") or pfield != field:
        problems.append("deklaracja #%s nazywa inny powod albo inne pole niz znacznik wpisu %s" % (decl_id, nr))
    ids = p.get("affected_ids")
    hashes_after = p.get("affected_hashes_after")
    if not isinstance(ids, list) or not isinstance(hashes_after, list) or len(hashes_after) != len(ids):
        problems.append("deklaracja #%s bez hashy po zerwaniu (stary format) - zmiany tresci po anonimizacji"
                        " nie da sie wykluczyc" % decl_id)
        return problems
    k = -1
    for i, x in enumerate(ids):
        if _is_id(x) and x == e.get("id"):
            k = i
            break
    if k < 0:
        problems.append("deklaracja #%s nie wymienia wpisu %s" % (decl_id, nr))
    elif hashes_after[k] != after:
        problems.append("deklaracja #%s podaje inny hash po zerwaniu dla wpisu %s" % (decl_id, nr))
    return problems


def describe_legal_break(decl_ids, reasons):
    nr = ", ".join("#%s" % d for d in decl_ids)
    return "zerwanie z mocy prawa (%s), zadeklarowane %s %s" % (
        ", ".join(reasons), "zdarzeniami" if len(decl_ids) > 1 else "zdarzeniem", nr)


def check_pack_event(doc):
    """
    Zwraca (problemy, przeliczony, zerwanie). Zdarzenie musi byc tym z dowodu
    Merkle; zerwanie to None albo (lista id deklaracji, lista powodow).
    """
    e = doc.get("event")
    b = doc.get("merkle_proof_bundle")
    if not isinstance(e, dict) or not isinstance(b, dict):
        return (["brak sekcji event albo merkle_proof_bundle"], False, None)
    problems = []
    if e.get("id") != b.get("event_id"):
        problems.append("numer zdarzenia rozni sie od numeru w dowodzie")
    if e.get("hash") != b.get("event_hash"):
        problems.append("hash zdarzenia rozni sie od hasha w dowodzie")
    recomputed = False
    legal = None
    if e.get("legal_break") is not None:
        decl = doc.get("legal_break_declaration")
        lb_problems = check_legal_break(e, [] if decl is None else [decl])
        problems.extend(lb_problems)
        if not lb_problems:
            lb = e.get("legal_break")
            legal = ([lb.get("declaration_event_id")], [reason_label(lb.get("reason"))])
            recomputed = e.get("hash_inputs_complete") is True
    elif e.get("hash_inputs_complete") is True:
        h = recompute_event_hash(e)
        if h is None:
            problems.append("niepelny wpis - brak pol potrzebnych do przeliczenia hasha")
        elif h != e.get("hash"):
            problems.append("tresc zdarzenia nie zgadza sie z jego hashem")
        else:
            recomputed = True
    return (problems, recomputed, legal if not problems else None)


def verify_pack(doc, out):
    failed = False

    ok, expected, actual = _check_integrity(doc)
    if ok:
        out("[1/3] integralnosc pliku SHA-256: OK")
        out("      %s" % expected)
    else:
        out("[1/3] integralnosc pliku SHA-256: NARUSZONA")
        out("      w pliku:   %s" % expected)
        out("      policzony: %s" % actual)
        out("      -> tresc artefaktu zmieniono po eksporcie z kancelarii")
        failed = True

    problems, recomputed, legal = check_pack_event(doc)
    if problems:
        out("[2/3] zgodnosc zdarzenia z dowodem: NARUSZONA")
        for p in problems:
            out("      - %s" % p)
        failed = True
    elif legal is not None:
        lb = doc.get("event").get("legal_break")
        out("[2/3] zgodnosc zdarzenia z dowodem: OK - ZERWANIE Z MOCY PRAWA")
        out("      hash oryginalny jest tym z dowodu; tresc zanonimizowano (%s, pole %s)"
            % (legal[1][0], lb.get("field")))
        if recomputed:
            out("      i daje dokladnie hash po zerwaniu z deklaracji: %s" % lb.get("hash_after"))
        else:
            out("      - tresc zamaskowana; zgodnosc z hashem po zerwaniu sprawdzil wydawca")
        out("      deklaracja #%s jest w pliku, nienaruszona i wymienia ten wpis" % legal[0][0])
    elif recomputed:
        out("[2/3] zgodnosc zdarzenia z dowodem: OK (hash przeliczony z tresci zdarzenia)")
    else:
        out("[2/3] zgodnosc zdarzenia z dowodem: OK (tresc zamaskowana - hashu nie da sie")
        out("      przeliczyc z pliku; zgodnosc tresci z hashem sprawdzil wydawca przed wydaniem)")

    bundle = doc.get("merkle_proof_bundle")
    if not isinstance(bundle, dict):
        out("[3/3] dowod Merkle: BRAK sekcji merkle_proof_bundle")
        return (1, None)

    event_id = bundle.get("event_id")
    start = bundle.get("chain_block_start")
    end = bundle.get("chain_block_end")
    if not all(isinstance(x, int) for x in (event_id, start, end)):
        out("[3/3] dowod Merkle: niepelny schemat dowodu")
        return (1, None)
    if not (start <= event_id <= end):
        out("[3/3] dowod Merkle: NARUSZONY")
        out("      zdarzenie %d poza blokiem [%d, %d]" % (event_id, start, end))
        return (1, None)

    if verify_merkle_proof(bundle.get("event_hash"), bundle.get("proof") or [], bundle.get("merkle_root")):
        out("[3/3] dowod Merkle: OK")
        out("      zdarzenie %d odtwarza korzen %s" % (event_id, bundle.get("merkle_root")))
        if legal is not None:
            out("      (dowod dotyczy oryginalnego hasha wpisu, sprzed zerwania z mocy prawa)")
    else:
        out("[3/3] dowod Merkle: NARUSZONY")
        out("      dowod nie odtwarza korzenia - wpis w dzienniku kancelarii zmieniono,")
        out("      usunieto albo przestawiono")
        failed = True

    if failed:
        return (1, None)
    return (3, legal) if legal is not None else (0, None)


def verify_excerpt(events, declarations=None):
    """
    Wyciag z dziennika w pakiecie dokumentu to wpisy JEDNEJ sprawy - miedzy nimi
    leza zdarzenia innych spraw i systemowe, ktorych plik nie zawiera (audyt
    2026-09, D-01). Lustro verifyAuditExcerpt (audit-bundle.ts):
      - ogniwo sprawdzone, gdy poprzednik (po hashu) jest w wyciagu;
      - WYMAGANE, gdy numery sa kolejne albo wpis deklaruje poprzednika
        w wyciagu (parent_in_excerpt) - brak to wpis usuniety lub zerwanie;
        kolejne numery z tym samym poprzednikiem to rozwidlenie z wyscigu
        zapisow (ADR-0161), nie zerwanie;
      - pozostale przejscia to LUKI - jawnie, bez werdyktu;
      - numery rosna scisle;
      - hash wpisu z hash_inputs_complete jest przeliczany z tresci;
      - wpis ze znacznikiem legal_break sprawdza check_legal_break wobec
        deklaracji z pliku (ogniwa ida po oryginalnych hashach).
    Zwraca slownik z licznikami i lista problemow.
    """
    if not isinstance(declarations, list):
        declarations = []
    r = {"problems": [], "links": 0, "gaps": 0, "recomputed": 0, "masked": 0, "entries": 0,
         "legal_breaks": 0, "legal_decl_ids": [], "legal_reasons": []}
    if not isinstance(events, list):
        r["problems"].append("wyciag z dziennika nie jest lista")
        return r
    r["entries"] = len(events)
    known = {}
    prev = None
    for e in events:
        if not isinstance(e, dict):
            r["problems"].append("wpis wyciagu nie jest obiektem")
            continue
        eid = e.get("id")
        if not _is_id(eid):
            r["problems"].append("wpis bez poprawnego numeru")
            continue
        if prev is not None and not (eid > prev.get("id")):
            r["problems"].append("numery nie rosna (wpis %s po %s) - kolejnosc zmieniona" % (eid, prev.get("id")))
        if e.get("legal_break") is not None:
            lb_problems = check_legal_break(e, declarations)
            if lb_problems:
                r["problems"].extend(lb_problems)
            else:
                r["legal_breaks"] += 1
                lb = e.get("legal_break")
                if lb.get("declaration_event_id") not in r["legal_decl_ids"]:
                    r["legal_decl_ids"].append(lb.get("declaration_event_id"))
                label = reason_label(lb.get("reason"))
                if label not in r["legal_reasons"]:
                    r["legal_reasons"].append(label)
        elif e.get("hash_inputs_complete") is True:
            h = recompute_event_hash(e)
            if h is None:
                r["problems"].append("wpis %s: niepelny - brak pol potrzebnych do przeliczenia hasha" % eid)
            elif h != e.get("hash"):
                r["problems"].append("wpis %s: tresc nie zgadza sie z hashem" % eid)
            else:
                r["recomputed"] += 1
        else:
            r["masked"] += 1
        ph = e.get("prev_hash")
        if isinstance(ph, str) and ph in known:
            r["links"] += 1
        elif ph == GENESIS_HASH:
            pass
        elif e.get("parent_in_excerpt") is True:
            r["problems"].append("wpis %s: poprzednika zadeklarowanego w wyciagu nie ma w pliku - wpis usunieto" % eid)
        elif prev is not None and eid == prev.get("id") + 1:
            if ph == prev.get("prev_hash"):
                r["links"] += 1
            else:
                r["problems"].append("ogniwo miedzy kolejnymi wpisami %s i %s przerwane" % (prev.get("id"), eid))
        elif prev is not None:
            r["gaps"] += 1
        if isinstance(e.get("hash"), str):
            known[e.get("hash")] = eid
        prev = e
    r["legal_decl_ids"].sort()
    return r


def verify_chain_links(events, declarations, out):
    """
    Krok [2/3] pakietu dokumentu. Zwraca (naruszony, zerwanie), gdzie zerwanie
    to None albo (lista id deklaracji, lista powodow).
    """
    r = verify_excerpt(events, declarations)
    if r["problems"]:
        out("[2/3] wyciag z dziennika: NARUSZONY")
        for p in r["problems"]:
            out("      - %s" % p)
        out("      -> wpis zmieniono, usunieto z wyciagu albo zmieniono kolejnosc")
        return (True, None)
    out("[2/3] wyciag z dziennika: OK (%d wpisow tej sprawy, %d ogniw sprawdzonych," % (r["entries"], r["links"]))
    out("      %d hashy przeliczonych z tresci)" % r["recomputed"])
    if r["masked"]:
        out("      %d wpisow z trescia zamaskowana - hashu nie da sie przeliczyc z pliku;" % r["masked"])
        out("      zgodnosc tresci z hashem sprawdzil wydawca przed wydaniem")
    if r["gaps"]:
        out("      WYCIAG, NIE PELNY LANCUCH: %d luk - miedzy wpisami tej sprawy leza zdarzenia" % r["gaps"])
        out("      innych spraw i systemowe, ktorych plik nie zawiera; ogniw przez luki nie da")
        out("      sie sprawdzic z tego pliku")
    if r["legal_breaks"]:
        out("      ZERWANIE Z MOCY PRAWA: %d wpisow zanonimizowano po zapisie (%s);"
            % (r["legal_breaks"], ", ".join(r["legal_reasons"])))
        out("      ich hash w lancuchu jest oryginalny, a tresc zgadza sie z hashem po zerwaniu")
        out("      z deklaracji %s (w pliku, nienaruszonej, wymieniajacej te wpisy)"
            % ", ".join("#%s" % d for d in r["legal_decl_ids"]))
        return (False, (r["legal_decl_ids"], r["legal_reasons"]))
    return (False, None)


def verify_bundle(doc, out):
    failed = False

    part_values = {
        "deliverable": doc.get("deliverable"),
        "citation_verification": doc.get("citation_verification"),
        "audit_log_excerpt": doc.get("audit_log_excerpt"),
        "legal_break_declarations": doc.get("legal_break_declarations"),
        "model_versions": doc.get("model_versions"),
        "cost_log": doc.get("cost_log"),
    }
    manifest = (doc.get("manifest") or {}).get("parts") or []
    tampered = []
    for part in manifest:
        name = part.get("name")
        if canonical_sha256(part_values.get(name)) != part.get("sha256"):
            tampered.append(name)

    if tampered:
        out("[1/3] manifest czesci: NARUSZONE -> %s" % ", ".join(tampered))
        failed = True
    else:
        out("[1/3] manifest czesci: OK (%d czesci zgodnych)" % len(manifest))

    excerpt_failed, legal = verify_chain_links(doc.get("audit_log_excerpt"), doc.get("legal_break_declarations"), out)
    if excerpt_failed:
        failed = True

    ok, expected, actual = _check_integrity(doc)
    if ok:
        out("[3/3] integralnosc calosci SHA-256: OK")
        out("      %s" % expected)
    else:
        out("[3/3] integralnosc calosci SHA-256: NARUSZONA")
        out("      w pliku:   %s" % expected)
        out("      policzony: %s" % actual)
        failed = True

    if failed:
        return (1, None)
    return (3, legal) if legal is not None else (0, None)


KINDS = {
    "audit_event_export": ("pack_kind", verify_pack, "wyciag pojedynczego zdarzenia"),
    "deliverable_audit_bundle": ("bundle_kind", verify_bundle, "pakiet dokumentu koncowego"),
}


def main(argv):
    def out(line=""):
        sys.stdout.write(line + "\n")

    if len(argv) != 2:
        sys.stderr.write("Uzycie: python verify.py <plik.json>\n")
        return 2

    path = argv[1]
    try:
        with open(path, "rb") as fh:
            doc = json.loads(fh.read().decode("utf-8"))
    except (OSError, IOError) as exc:
        sys.stderr.write("Nie udalo sie odczytac pliku %s: %s\n" % (path, exc))
        return 2
    except ValueError as exc:
        sys.stderr.write("Plik nie jest poprawnym JSON-em: %s\n" % (exc,))
        return 2

    if not isinstance(doc, dict):
        sys.stderr.write("Artefakt nie jest obiektem JSON.\n")
        return 2

    kind = doc.get("pack_kind") or doc.get("bundle_kind")
    entry = KINDS.get(kind)
    if entry is None:
        sys.stderr.write(
            "Nieznany rodzaj artefaktu: %r (oczekiwano jednego z: %s)\n"
            % (kind, ", ".join(sorted(KINDS)))
        )
        return 2

    _, verifier, human = entry

    if doc.get("schema_version") != SCHEMA_VERSION:
        sys.stderr.write(
            "Wersja schematu %r nieobslugiwana przez ten weryfikator (oczekiwano %s).\n"
            % (doc.get("schema_version"), SCHEMA_VERSION)
        )
        return 2

    out("Plik:     %s" % path)
    out("Rodzaj:   %s (%s)" % (kind, human))
    out("Utworzony:%s" % (doc.get("exported_at") or doc.get("created_at") or " (brak daty)"))
    out()

    try:
        code, legal = verifier(doc, out)
    except ValueError as exc:
        sys.stderr.write("Artefakt uszkodzony: %s\n" % (exc,))
        return 2

    out()
    if code == 0:
        out("WYNIK: artefakt nienaruszony.")
        out()
        out("Co to znaczy: plik nie zostal zmieniony po wydaniu przez kancelarie, a kazde")
        out("sprawdzalne ogniwo, hash i dowod w nim jest zgodny (zakres - kroki powyzej).")
        out("Czego to NIE dowodzi: autorstwa kancelarii - do tego sluzy podpis")
        out("kwalifikowany, ktorego ten artefakt jeszcze nie niesie.")
    elif code == 3:
        out("WYNIK: OK - %s." % describe_legal_break(legal[0], legal[1]))
        out()
        out("Co to znaczy: plik nie zostal zmieniony po wydaniu przez kancelarie. Wpis")
        out("z dziennika zanonimizowano po zapisie na podstawie obowiazku prawnego, a")
        out("deklaracja tego zerwania jest w pliku i zostala sprawdzona. To nie jest")
        out("naruszenie, ale tez nie wpis w pierwotnej postaci (kod wyjscia 3).")
    else:
        out("WYNIK: INTEGRALNOSC NARUSZONA - artefakt nie moze byc uznany za wiarygodny.")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
`;

/** Instrukcja dla odbiorcy. Bez polskich znakow - .txt bywa otwierany w
 * starszym kodowaniu na komputerach sadowych, a ogonki zamienilyby sie w szum. */
export const VERIFIER_README = String.raw`JAK SPRAWDZIC, CZY TEN ZAPIS JEST WIARYGODNY
============================================

W tym archiwum znajduje sie zapis z systemu Patron, wydany przez kancelarie,
oraz narzedzia pozwalajace niezaleznie sprawdzic, czy nikt go pozniej nie
zmienil. Sprawdzenie wykonuje sie w calosci na Panstwa urzadzeniu. Nic nie
jest nigdzie wysylane. Nie potrzeba dostepu do systemu kancelarii, konta,
hasla ani polaczenia z internetem.


SPOSOB PIERWSZY - przez przegladarke (nic nie trzeba instalowac)
---------------------------------------------------------------

1. Otworz plik SPRAWDZ-TEN-PLIK.html podwojnym kliknieciem.
   Otworzy sie w przegladarce, ktorej juz Panstwo uzywaja.

2. Przeciagnij na strone plik z rozszerzeniem .json z tego archiwum
   (albo kliknij i wskaz go).

3. Odczytaj wynik. Zielony naglowek "Artefakt nienaruszony" oznacza, ze plik
   jest zgodny z tym, co wydala kancelaria. Czerwony oznacza, ze zostal
   zmieniony i nie mozna go uznac za wiarygodny.

Wynik mozna wydrukowac przyciskiem na dole strony.


SPOSOB DRUGI - przez wiersz polecen (dla dzialu IT i kontroli automatycznej)
---------------------------------------------------------------------------

Wymaga Pythona w wersji 3.8 lub nowszej. Zadnych bibliotek zewnetrznych.

    python verify.py nazwa-pliku.json

Kody wyjscia:
    0 - zapis nienaruszony
    1 - integralnosc naruszona
    2 - blad odczytu pliku albo nieznany format
    3 - zapis nienaruszony, z wpisem zerwanym z mocy prawa (patrz nizej)

Nadaje sie do wpiecia w kontrole automatyczna po stronie odbiorcy.


CO DOKLADNIE JEST SPRAWDZANE
----------------------------

- czy tresc pliku nie zostala zmieniona po wydaniu przez kancelarie,
- czy zapis zdarzenia zgadza sie z zapieczetowanym wczesniej skrotem
  calego dziennika (dowod przynaleznosci, standard RFC 6962) i czy jest
  to dokladnie zdarzenie, ktorego dotyczy dowod,
- czy skrot (hash) wpisu zgadza sie z jego trescia - tam, gdzie tresc
  nie byla maskowana,
- w pakiecie dokumentu: czy z wyciagu z dziennika nie usunieto wpisu i nie
  zmieniono kolejnosci wpisow. Wyciag obejmuje JEDNA sprawe, wiec nie jest
  pelnym lancuchem - miedzy jego wpisami leza zdarzenia innych spraw.
  Takie luki narzedzia pokazuja wprost; ogniw przez luke nie da sie
  sprawdzic z tego pliku.

Wynik "OK - zerwanie z mocy prawa" (w przegladarce naglowek pomaranczowy,
w wierszu polecen kod 3) oznacza, ze wpis zanonimizowano po zapisie na
podstawie obowiazku prawnego (np. RODO art. 17), a narzedzia z tego archiwum
sprawdzily dolaczona do pliku deklaracje tego zerwania - to nie jest
naruszenie, ale oryginalnej tresci wpisu nie da sie z pliku odtworzyc.

Oba narzedzia licza dokladnie to samo i musza dac ten sam wynik. Jesli daja
rozny - prosze zwrocic sie do kancelarii, bo oznacza to uszkodzenie pliku.


CZEGO TO SPRAWDZENIE NIE DOWODZI
--------------------------------

Nie dowodzi, ze plik wystawila konkretna kancelaria. Zapis jest odporny na
NIEZAUWAZONA zmiane, ale nie jest podpisany podpisem kwalifikowanym - ktos,
kto dysponuje calym plikiem, moze zbudowac inny plik wewnetrznie spojny.
Dowodem pochodzenia bedzie dopiero podpis kwalifikowany, ktorego ta wersja
zapisu jeszcze nie niesie.

Nie dowodzi rowniez, ze tresc zapisu jest prawdziwa merytorycznie. Swiadczy
o tym, co system zapisal w chwili zdarzenia, a nie o tym, czy bylo to
trafne.

Dane osobowe w wyciagu z dziennika sa zamaskowane. Skrotu wpisu z
zamaskowana trescia nie da sie przeliczyc z tego pliku. Zgodnosc tresci
takich wpisow z ich skrotem sprawdza system kancelarii przed wydaniem -
wpis niezgodny blokuje wydanie zapisu. Te kontrole odbiorca przyjmuje
na wiare wydawcy, dopoki zapis nie niesie podpisu kwalifikowanego.


PODSTAWA
--------

Zapis prowadzony jest w sposob odpowiadajacy wymogom rejestrowania zdarzen
z art. 12 rozporzadzenia Parlamentu Europejskiego i Rady (UE) 2024/1689 (akt
w sprawie sztucznej inteligencji). Nie przesadza to o kwalifikacji konkretnego
wdrozenia jako systemu wysokiego ryzyka.

Patron, MateMatic Solutions, https://matematicsolutions.com
`;
