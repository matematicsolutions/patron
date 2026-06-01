const { app, BrowserWindow, shell, Menu, safeStorage } = require('electron');
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
  };
  const dbKey = getOrCreateDbKey();
  if (dbKey) env.PATRON_DB_ENCRYPTION_KEY = dbKey;
  return env;
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
