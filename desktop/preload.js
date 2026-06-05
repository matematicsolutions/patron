// Preload PATRON - most renderer <-> main przez contextBridge (contextIsolation:true).
// Wystawia WYLACZNIE jawne, bezpieczne API. Bez nodeIntegration, bez surowego
// ipcRenderer/require w rendererze (defense-in-depth - renderer renderuje tresc
// dokumentow, ktore moga zawierac prompt-injection).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('patron', {
  // Natywny picker folderu sprawy. Zwraca sciezke (string) albo null (anulowano).
  // FIX pilot Beata: nietechniczny uzytkownik nie umie skopiowac sciezki ("chce
  // jak zalacznik") - picker zastepuje recznie wpisywane pole tekstowe.
  selectFolder: () => ipcRenderer.invoke('patron:selectFolder'),
  // Flaga obecnosci powloki Electron - frontend wlacza picker tylko w desktopie
  // (w przegladarce/dev bez Electrona zostaje fallback na pole tekstowe).
  isDesktop: true,
});
