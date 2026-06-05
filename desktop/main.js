const { app, BrowserWindow, shell, Menu, safeStorage, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const isDev = process.argv.includes('--dev');

const BACKEND_PORT = 3001;
const FRONTEND_PORT = 3000;

// Korzen zasobow. W trybie spakowanym (instalator NSIS) backend i frontend
// leza w process.resourcesPath (extraResources electron-builder), nie obok
// main.js. W trybie dev/repo - katalog nadrzedny repo.
const RES = () => (app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'));

// Uruchamianie podprocesow przez Node WBUDOWANY w Electron (process.execPath +
// ELECTRON_RUN_AS_NODE=1) - bez wymogu zewnetrznego node/npm na maszynie klienta
// (cel "jeden instalator", ADR-0091). W trybie dev zostaje zewnetrzny toolchain
// (deweloper go ma) - nizej rozgalezienie po app.isPackaged.
const ELECTRON_NODE = process.execPath;

// ── Tryb local (zero-cloud single-user, ADR-0053/0062) ──────────────────────
// Sekrety per-instalacja: generowane raz i persystowane w userData. MUSZA byc
// stabilne miedzy uruchomieniami - inaczej zaszyfrowane klucze API usera staja
// sie nieodczytywalne, a linki download (HMAC) przestaja sie walidowac.
function getOrCreateSecret(name) {
  const dir = path.join(app.getPath('userData'), 'secrets');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* brak pliku - wygeneruj ponizej */
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

// ADR-0072: klucz szyfrowania at-rest bazy SQLite chroniony przez OS keychain /
// DPAPI (Electron safeStorage). W przeciwienstwie do getOrCreateSecret (plik
// plaintext 0600) klucz bazy NIGDY nie lezy na dysku w jawnej postaci - tylko
// jako blob zaszyfrowany przez OS. Zwraca jawny klucz (do wstrzykniecia w env
// backendu) albo null gdy szyfrowanie wylaczone.
//
// Aktywne tylko gdy PATRON_DB_ENCRYPTION=on. Wymaga w backendzie sterownika
// cipher-capable (better-sqlite3-multiple-ciphers) - inaczej backend rzuci
// fail-loud (lib/db/atrest.ts). Domyslnie OFF = baza plaintext jak dotad.
function getOrCreateDbKey() {
  if (process.env.PATRON_DB_ENCRYPTION !== 'on') return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      '[PATRON] PATRON_DB_ENCRYPTION=on, ale OS keychain/DPAPI niedostepny - ' +
      'NIE utworze klucza w plaintext. Przerwij lub wylacz szyfrowanie.',
    );
  }
  const dir = path.join(app.getPath('userData'), 'secrets');
  fs.mkdirSync(dir, { recursive: true });
  const blobFile = path.join(dir, 'db_key.enc');
  try {
    const enc = fs.readFileSync(blobFile);
    const key = safeStorage.decryptString(enc);
    if (key) return key;
  } catch {
    /* brak/nieczytelny blob - wygeneruj nowy ponizej */
  }
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(blobFile, safeStorage.encryptString(key), { mode: 0o600 });
  return key;
}

// Env wstrzykiwany do backendu: SQLite + storage FS + dane w userData + sekrety.
function backendLocalEnv() {
  const ud = app.getPath('userData');
  const env = {
    PATRON_DB_BACKEND: 'sqlite',
    PATRON_STORAGE: 'fs',
    PATRON_DB_PATH: path.join(ud, 'patron.db'),
    PATRON_STORAGE_DIR: path.join(ud, 'sprawy'),
    PATRON_BRAIN_DIR: path.join(ud, 'brain'),
    DOWNLOAD_SIGNING_SECRET: getOrCreateSecret('download_signing_secret'),
    USER_API_KEYS_ENCRYPTION_SECRET: getOrCreateSecret('api_keys_encryption_secret'),
    // Desktop single-user: adwokat JEST Operatorem na wlasnej maszynie. Jego wybor
    // modelu chmurowego (np. Libra/Anthropic - glowne narzedzie prawnikow w PL) jest
    // swiadoma zgoda na egress. Zdejmujemy domyslny twardy blok chmury dla spraw
    // objetych tajemnica; egress POZOSTAJE w pelni audytowany (dowod AI Act art. 12),
    // a PII jest maskowane przed wyslaniem. Kancelaria moze zaostrzyc rygor wylaczajac
    // te zmienne (tryb serwerowy/fabryczny ich nie ustawia). Patrz ADR-0101.
    ALLOW_US_PROVIDERS: process.env.ALLOW_US_PROVIDERS ?? 'true',
    PATRON_ALLOW_PRIVILEGED_CLOUD: process.env.PATRON_ALLOW_PRIVILEGED_CLOUD ?? 'true',
  };
  const dbKey = getOrCreateDbKey();
  if (dbKey) env.PATRON_DB_ENCRYPTION_KEY = dbKey;

  // Embedder RAG: wskaz lokalnie zbundlowane wagi (dist-resources/backend/models),
  // jesli sa. Bez tego transformers.js probowalby pobrac z sieci (zablokowane
  // fail-closed) i retrieval degradowalby do BM25+graf. Ustawiamy tylko gdy
  // katalog faktycznie istnieje - inaczej nie nadpisujemy domyslnej sciezki.
  const modelsDir = path.join(RES(), 'backend', 'models');
  if (fs.existsSync(modelsDir)) {
    env.PATRON_EMBED_MODELS_PATH = modelsDir;
  }

  // OCR skanow/zdjec (ADR-0074/0075): silnik LOKALNY zero-cloud. Bez tego
  // isOcrConfigured()=false i obrazy (jpg/png/tiff) sa odrzucane na wejsciu -
  // realny blocker uzytecznosci dla akt papierowych (pilot Beata: "nie czyta
  // dokumentow"). PATRON_OCR_CMD jest engine-agnostic (silnik wybierany env, nie
  // kodem). Priorytet rezolucji:
  //   1) jawny override Operatora (process.env.PATRON_OCR_CMD) - nie ruszamy,
  //   2) Tesseract zbundlowany w instalatorze (dist-resources/backend/ocr/...),
  //   3) Tesseract zainstalowany recznie w znanej lokalizacji (maszyna dev).
  // Sciezka silnika ZAWSZE w cudzyslowie - tokenizer ocrRunner.ts respektuje
  // cudzyslowy, wiec "C:\Program Files\..." ze spacjami nie rozpada sie na argv.
  const ocr = resolveOcr();
  if (ocr) {
    env.PATRON_OCR_CMD = ocr.cmd;
    if (ocr.tessdata) env.TESSDATA_PREFIX = ocr.tessdata;
  }
  return env;
}

// Rezolucja lokalnego silnika OCR (Tesseract). Zwraca {cmd, tessdata?} albo null.
// stdout-mode: silnik pisze rozpoznany tekst na stdout (patrz ocrRunner.ts).
function resolveOcr() {
  // 1) Override Operatora - process.env jest rozlewane PRZED backendLocalEnv()
  //    w startBackend, wiec zwracamy null by nie nadpisac swiadomej konfiguracji.
  if (process.env.PATRON_OCR_CMD && process.env.PATRON_OCR_CMD.trim()) return null;

  const exe = process.platform === 'win32' ? 'tesseract.exe' : 'tesseract';

  // 2) Bundlowany w instalatorze (ADR-0075). Staging w prepare-resources.cjs.
  const bundledExe = path.join(RES(), 'backend', 'ocr', 'tesseract', exe);
  const bundledTessdata = path.join(RES(), 'backend', 'ocr', 'tessdata');
  if (fs.existsSync(bundledExe)) {
    return {
      cmd: `"${bundledExe}" {input} stdout -l pol --psm 1`,
      tessdata: fs.existsSync(bundledTessdata) ? bundledTessdata : undefined,
    };
  }

  // 3) Recznie zainstalowany Tesseract (maszyna deweloperska). tessdata pol moze
  //    byc obok exe (instalator UB-Mannheim) - wskazujemy gdy zawiera pol.
  const knownDirs = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Tesseract-OCR',
        'C:\\Program Files (x86)\\Tesseract-OCR',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Tesseract-OCR'),
      ]
    : ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
  for (const dir of knownDirs) {
    if (!dir) continue;
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) {
      const td = path.join(dir, 'tessdata');
      const hasPol = fs.existsSync(path.join(td, 'pol.traineddata'));
      return {
        cmd: `"${p}" {input} stdout -l pol --psm 1`,
        tessdata: hasPol ? td : undefined,
      };
    }
  }
  return null;
}

let win = null;
let backendProc = null;
let frontendProc = null;

// ── Czeka aż port odpowie ──────────────────────────────────────────────────
function waitForPort(port, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      const req = http.get(`http://localhost:${port}`, res => {
        res.destroy();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Port ${port} nie odpowiada po ${timeout}ms`));
        } else {
          setTimeout(check, 800);
        }
      });
      req.end();
    }
    check();
  });
}

// ── Odpala backend ─────────────────────────────────────────────────────────
function startBackend() {
  console.log('[PATRON] Startuję backend…');
  const backendDir = path.join(RES(), 'backend');
  const entry = path.join(backendDir, 'dist', 'index.js');

  const env = {
    ...process.env,
    ...backendLocalEnv(),
    NODE_ENV: 'production',
    PORT: String(BACKEND_PORT),
    // Bind loopback - API kancelarii nie wychodzi na LAN (parytet z backendem,
    // ktory i tak wymusza 127.0.0.1 dla sqlite, ale ustawiamy jawnie).
    PATRON_HOST: '127.0.0.1',
  };

  if (app.isPackaged) {
    // Node wbudowany w Electron - zero zaleznosci od node/npm u klienta.
    // ELECTRON_RUN_AS_NODE: proces dziedziczy V8/Node Electrona (stad
    // better-sqlite3 musi byc zrebuildowany pod ABI Electrona - patrz
    // desktop/scripts/prepare-resources.cjs i ADR-0091).
    backendProc = spawn(ELECTRON_NODE, [entry], {
      cwd: backendDir,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    // Dev/repo: zewnetrzny node (deweloper ma toolchain, dist zbudowany lokalnie).
    backendProc = spawn('node', ['dist/index.js'], {
      cwd: backendDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
  }

  backendProc.stdout.on('data', d => process.stdout.write(`[backend] ${d}`));
  backendProc.stderr.on('data', d => process.stderr.write(`[backend] ${d}`));
  backendProc.on('exit', code => console.log(`[backend] exit ${code}`));
}

// ── Odpala frontend ────────────────────────────────────────────────────────
// W produkcji frontend jest serwowany PRODUKCYJNIE z buildu standalone Next.js
// (frontend/server.js + .next/static + public), NIE przez serwer deweloperski.
// Standalone bundluje wlasne minimalne node_modules, wiec nie wymaga pelnych
// zaleznosci frontu na maszynie klienta. UWAGA: zmienne NEXT_PUBLIC_* sa
// wstrzykiwane w czasie BUILDU (next build), nie runtime - ustawiamy je w
// desktop/scripts/prepare-resources.cjs, nie tutaj.
function startFrontend() {
  console.log('[PATRON] Startuję frontend…');

  if (app.isPackaged) {
    const standaloneDir = path.join(RES(), 'frontend');
    const server = path.join(standaloneDir, 'server.js');
    frontendProc = spawn(ELECTRON_NODE, [server], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: String(FRONTEND_PORT),
        // Serwer standalone Next.js: loopback only.
        HOSTNAME: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    // Dev/repo: serwer deweloperski (NEXT_PUBLIC_* inline'owane runtime przez next dev).
    const frontendDir = path.join(RES(), 'frontend');
    frontendProc = spawn('npm', ['run', 'dev'], {
      cwd: frontendDir,
      env: {
        ...process.env,
        PORT: String(FRONTEND_PORT),
        NEXT_PUBLIC_PATRON_LOCAL_MODE: 'true',
        NEXT_PUBLIC_API_BASE_URL: `http://localhost:${BACKEND_PORT}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
  }

  frontendProc.stdout.on('data', d => process.stdout.write(`[frontend] ${d}`));
  frontendProc.stderr.on('data', d => process.stderr.write(`[frontend] ${d}`));
  frontendProc.on('exit', code => console.log(`[frontend] exit ${code}`));
}

// ── Okno główne ────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'PATRON',
    backgroundColor: '#0e1825',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Most do natywnego pickera folderu (FIX pilot Beata: "nie wiem jak skopiowac
      // sciezke - chce jak zalacznik"). Wystawia tylko bezpieczne, jawne API
      // (window.patron.selectFolder) - bez nodeIntegration, bez require w rendererze.
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  // Otwieraj linki zewnętrzne w przeglądarce systemowej.
  // ADR-0071: walidacja schematu PRZED openExternal. Bez niej model (przez
  // prompt injection w tresci dokumentu/odpowiedzi) moze wstawic link
  // file:// / javascript: / inny, ktorego klik otworzylby dowolny handler OS
  // (lancuch E2E z audytu). Dozwolone tylko bezpieczne schematy nawigacji.
  const SAFE_EXTERNAL_SCHEMES = new Set(['https:', 'http:', 'mailto:']);
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const scheme = new URL(url).protocol;
      if (SAFE_EXTERNAL_SCHEMES.has(scheme)) {
        shell.openExternal(url);
      } else {
        console.warn('[security] zablokowano openExternal dla schematu:', scheme);
      }
    } catch {
      console.warn('[security] zablokowano openExternal dla niepoprawnego URL');
    }
    return { action: 'deny' };
  });

  // Defense-in-depth: blokuj nawigacje glownego okna poza lokalny origin
  // aplikacji (renderer nie moze zostac przekierowany na zewnetrzny URL).
  win.webContents.on('will-navigate', (event, navUrl) => {
    try {
      const host = new URL(navUrl).hostname;
      if (host !== 'localhost' && host !== '127.0.0.1') {
        event.preventDefault();
        console.warn('[security] zablokowano nawigacje okna do:', navUrl);
      }
    } catch {
      event.preventDefault();
    }
  });

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  // Minimalne menu — bez domyślnych pozycji Electron
  const menu = Menu.buildFromTemplate([
    {
      label: 'PATRON',
      submenu: [
        { label: 'Pełny ekran', accelerator: 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Zamknij', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      // Submenu Edytuj - bez niego skroty schowka (Ctrl+C/V/X/Z/A) sa martwe,
      // bo w Electronie akcje edycyjne sa podpiete przez role menu, a minimalne
      // menu ich nie mialo. Blokowalo wklejanie klucza API w Konto -> Modele
      // (zgloszenie Pilot-01-Czechowicz). Jawne pozycje z polskimi labelami;
      // akceleratory pochodza z domyslnych roli edycyjnych Electrona.
      label: 'Edytuj',
      submenu: [
        { label: 'Cofnij', role: 'undo' },
        { label: 'Ponów', role: 'redo' },
        { type: 'separator' },
        { label: 'Wytnij', role: 'cut' },
        { label: 'Kopiuj', role: 'copy' },
        { label: 'Wklej', role: 'paste' },
        { type: 'separator' },
        { label: 'Zaznacz wszystko', role: 'selectAll' },
      ],
    },
    {
      label: 'Sprawa',
      submenu: [
        { label: 'Nowa sprawa', accelerator: 'CmdOrCtrl+N', click: () => win?.webContents.send('new-case') },
        { label: 'Odśwież', accelerator: 'CmdOrCtrl+R', role: 'reload' },
      ],
    },
    ...(isDev ? [{
      label: 'Dev',
      submenu: [
        { label: 'DevTools', accelerator: 'F12', role: 'toggleDevTools' },
        { label: 'Reload hard', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
      ],
    }] : []),
  ]);
  Menu.setApplicationMenu(menu);

  // Menu kontekstowe (prawy-klik) dla pol edytowalnych - czesc uzytkownikow
  // (mecenasi) wkleja mysza, nie skrotem. Bez tego brak pozycji "Wklej" pod
  // prawym klawiszem. Pokazujemy tylko akcje dozwolone przez editFlags.
  win.webContents.on('context-menu', (_event, params) => {
    const { isEditable, editFlags, selectionText } = params;
    let template = [];
    if (isEditable) {
      template = [
        { label: 'Cofnij', role: 'undo', enabled: editFlags.canUndo },
        { label: 'Ponów', role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { label: 'Wytnij', role: 'cut', enabled: editFlags.canCut },
        { label: 'Kopiuj', role: 'copy', enabled: editFlags.canCopy },
        { label: 'Wklej', role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { label: 'Zaznacz wszystko', role: 'selectAll', enabled: editFlags.canSelectAll },
      ];
    } else if (selectionText && selectionText.trim().length > 0) {
      template = [{ label: 'Kopiuj', role: 'copy', enabled: editFlags.canCopy }];
    }
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: win });
    }
  });

  win.loadURL(`http://localhost:${FRONTEND_PORT}`);
}

// ── Splash / loading screen ────────────────────────────────────────────────
function showSplash() {
  const splash = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#0e1825',
    webPreferences: { nodeIntegration: false },
  });

  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: #0e1825;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100vh;
    font-family: 'Segoe UI', sans-serif;
    color: #c9a55a;
    user-select: none;
  }
  .logo { font-size: 36px; letter-spacing: 0.18em; font-weight: 300; margin-bottom: 8px; }
  .logo span { opacity: 0.5; }
  .sub { font-size: 11px; color: rgba(255,255,255,0.35); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 36px; }
  .bar-track { width: 240px; height: 2px; background: rgba(255,255,255,0.08); border-radius: 1px; overflow: hidden; }
  .bar-fill { height: 100%; background: #c9a55a; border-radius: 1px; animation: load 8s ease-out forwards; }
  @keyframes load { from{width:0%} to{width:90%} }
  .status { font-size: 10px; color: rgba(255,255,255,0.25); margin-top: 12px; letter-spacing: 0.06em; }
</style>
</head>
<body>
  <div class="logo">PAT<span>R</span>ON</div>
  <div class="sub">Warsztat pracy prawnika</div>
  <div class="bar-track"><div class="bar-fill"></div></div>
  <div class="status">Uruchamianie…</div>
</body>
</html>
  `)}`);

  return splash;
}

// ── Boot sequence ──────────────────────────────────────────────────────────
// IPC: natywny picker folderu sprawy (FIX pilot Beata). Renderer wola
// window.patron.selectFolder() (patrz preload.js); zwraca wybrana sciezke albo
// null gdy Operator anulowal. Read-only wybor katalogu - nie dotyka FS sam.
ipcMain.handle('patron:selectFolder', async () => {
  const res = await dialog.showOpenDialog(win ?? undefined, {
    title: 'Wybierz folder sprawy',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

app.whenReady().then(async () => {
  const splash = showSplash();

  startBackend();
  startFrontend();

  try {
    // Czekaj na oba serwisy równolegle
    await Promise.all([
      waitForPort(BACKEND_PORT, 90000),
      waitForPort(FRONTEND_PORT, 90000),
    ]);

    createWindow();
    splash.close();
  } catch (err) {
    console.error('[PATRON] Boot error:', err.message);
    splash.close();

    // Pokaż błąd w oknie
    const errWin = new BrowserWindow({ width: 500, height: 300, backgroundColor: '#0e1825' });
    errWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <body style="background:#0e1825;color:#ffb4ab;font-family:monospace;padding:32px">
        <h2 style="color:#c9a55a;margin-bottom:16px">PATRON — błąd uruchomienia</h2>
        <pre style="font-size:12px;opacity:0.8">${err.message}</pre>
        <p style="margin-top:24px;font-size:11px;opacity:0.5">Sprawdź czy backend i frontend są zbudowane.<br>Uruchom: npm run build w katalogach backend/ i frontend/</p>
      </body>
    `)}`);
  }
});

// ── Cleanup ────────────────────────────────────────────────────────────────
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  backendProc?.kill();
  frontendProc?.kill();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
