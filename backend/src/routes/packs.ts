// Router paczek wiedzy (kanal dystrybucji chunkowej, ADR-0140).
//
// Trzy endpointy dla desktopu single-user:
//   GET  /api/packs          - lista lokalnych paczek + stempel kanalu (bez sieci)
//   GET  /api/packs/updates  - dry-run: dla kazdej paczki czy kanal ma nowsza
//                              wersje i ile bajtow trzeba pobrac (zrodlo
//                              komunikatu UI "dostepna aktualizacja X->Y")
//   POST /api/packs/update   - aktualizacja jednej paczki w miejscu (delta)
//
// Autoryzacja: requireAuth + requireAdmin (parytet z /api/status - zarzadzanie
// paczkami to akt Operatora). Zadnych danych klienta w ruchu: kanal serwuje
// wylacznie opublikowane paczki wiedzy (ruch wychodzacy = GET manifestu/chunkow).
// Plik zajety przez inny proces -> 409 z czytelnym komunikatem (PackBusyError).

import { Router } from "express";
import path from "path";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  PackBusyError,
  checkUpdate,
  listPackFiles,
  packsDir,
  readChannelStamp,
  updatePack,
} from "../lib/pack-channel";

export const packsRouter = Router();
packsRouter.use(requireAuth, requireAdmin);

/** Tylko nazwa pliku z katalogu paczek - zero path traversal. */
function resolvePackFile(name: unknown): string | null {
  if (typeof name !== "string" || !/^[\w][\w.-]*\.(sqlite|db)$/i.test(name)) return null;
  const full = path.join(packsDir(), name);
  return listPackFiles().includes(full) ? full : null;
}

function stampOrNull(file: string) {
  try {
    return readChannelStamp(file);
  } catch {
    return null;
  }
}

packsRouter.get("/", (_req, res) => {
  const packs = listPackFiles().map((file) => ({
    file: path.basename(file),
    ...(stampOrNull(file) ?? {
      channelUrl: null,
      channelVersion: null,
      packName: null,
      edition: "full",
    }),
  }));
  res.json({ dir: packsDir(), packs });
});

packsRouter.get("/updates", async (_req, res) => {
  const updates = await Promise.all(
    listPackFiles().map(async (file) => {
      const base = { file: path.basename(file) };
      const stamp = stampOrNull(file);
      if (!stamp?.channelUrl) return { ...base, status: "bez_kanalu" as const };
      try {
        const check = await checkUpdate(file);
        return {
          ...base,
          packName: stamp.packName,
          edition: stamp.edition,
          ...check,
          downloadMb: Math.round(check.downloadBytes / 1024 / 1024),
          packMb: Math.round(check.packSize / 1024 / 1024),
        };
      } catch (err) {
        // Kanal nieosiagalny (offline / abonament wygasl) to stan, nie awaria -
        // paczka dalej dziala, wiec zgloszenie per paczka zamiast 5xx calosci.
        return { ...base, status: "kanal_nieosiagalny" as const, detail: String(err) };
      }
    }),
  );
  res.json({ updates });
});

packsRouter.post("/update", async (req, res) => {
  const file = resolvePackFile((req.body as { file?: unknown } | undefined)?.file);
  if (!file) {
    res.status(400).json({ detail: "Nieznana paczka. Podaj nazwe pliku z katalogu paczek." });
    return;
  }
  try {
    const result = await updatePack(file);
    res.json({ file: path.basename(file), ...result });
  } catch (err) {
    if (err instanceof PackBusyError) {
      res.status(409).json({ detail: err.message });
      return;
    }
    res.status(502).json({ detail: `Aktualizacja nie powiodla sie: ${String(err)}` });
  }
});
