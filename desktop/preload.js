// Preload PATRON - most renderer <-> main przez contextBridge (contextIsolation:true).
// Wystawia WYLACZNIE jawne, bezpieczne API. Bez nodeIntegration, bez surowego
// ipcRenderer/require w rendererze (defense-in-depth - renderer renderuje tresc
// dokumentow, ktore moga zawierac prompt-injection).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('patron', {
  // Natywny picker folderu sprawy. Zwraca sciezke (string) albo null (anulowano).
  // FIX pilot Rumpole: nietechniczny uzytkownik nie umie skopiowac sciezki ("chce
  // jak zalacznik") - picker zastepuje recznie wpisywane pole tekstowe.
  selectFolder: () => ipcRenderer.invoke('patron:selectFolder'),
  // Nawigacja zlecona z menu systemowego (Nowa sprawa, Akta i dowody,
  // Ustawienia). Renderer dostaje TYLKO sciezke wewnetrzna - zadnego adresu
  // zewnetrznego ani dowolnego kodu. Zwraca funkcje odpinajaca sluchacza, zeby
  // komponent Reacta mogl posprzatac po sobie przy odmontowaniu.
  onMenuNavigate: (cb) => {
    const handler = (_e, sciezka) => {
      if (typeof sciezka === 'string' && sciezka.startsWith('/')) cb(sciezka);
    };
    ipcRenderer.on('menu:navigate', handler);
    return () => ipcRenderer.removeListener('menu:navigate', handler);
  },
  // Flaga obecnosci powloki Electron - frontend wlacza picker tylko w desktopie
  // (w przegladarce/dev bez Electrona zostaje fallback na pole tekstowe).
  isDesktop: true,
});
