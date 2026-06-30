// Zarzadzanie kluczem danych (DEK) z envelope encryption (ADR-0138).
//
// Model: KEK (key-encryption-key) owija DEK (data-encryption-key). DEK szyfruje
// wartosci pol (field-crypto). DEK przechowywany OWINIETY przez KEK w tabeli
// `encryption_keys` - sam material DEK nigdy nie leży w bazie w plaintext.
//
// KEK: desktop = `PATRON_FIELD_ENCRYPTION_KEK` wstrzykiwany z OS keychain/DPAPI
// (model ADR-0072); serwer = env secret. KEK NIGDY plaintext na dysku, backend
// zna go tylko jako zmienna srodowiskowa. KEK = sha256(secret) -> 32B (jak userApiKeys).
//
// Per-tenant: desktop = 1 DEK (`LOCAL_USER_ID`); serwer = DEK per organization/user.
//
// FAIL-LOUD: gdy szyfrowanie wlaczone (`PATRON_FIELD_ENCRYPTION=on`) a brak KEK -
// rzucamy (jak atrest.ts), zamiast cicho pracowac bez ochrony.

import crypto from "crypto";
import { createServerSupabase } from "../supabase";
import { encryptField, decryptField } from "./field-crypto";

type Db = ReturnType<typeof createServerSupabase>;

/** Wersja KEK - do re-wrap przy rotacji (US3). MVP = 1. */
export const KEK_VERSION = 1;

/** Czy field-level encryption jest wlaczone (opt-in, domyslnie OFF). */
export function isFieldEncryptionEnabled(): boolean {
    return (process.env.PATRON_FIELD_ENCRYPTION ?? "").trim().toLowerCase() === "on";
}

/**
 * Laduje KEK (32B) = sha256(`PATRON_FIELD_ENCRYPTION_KEK`). Fail-loud gdy brak -
 * nie pozwalamy szyfrowac/odszyfrowywac bez klucza glownego.
 */
export function loadKek(): Buffer {
    const secret = process.env.PATRON_FIELD_ENCRYPTION_KEK;
    if (!secret) {
        throw new Error(
            "PATRON_FIELD_ENCRYPTION wlaczone, ale brak PATRON_FIELD_ENCRYPTION_KEK. " +
                "Odmawiam pracy bez klucza glownego (fail-loud, jak atrest/ADR-0072).",
        );
    }
    return crypto.createHash("sha256").update(secret, "utf8").digest();
}

// Cache odwinietych DEK w pamieci procesu (NIGDY na dysku). Klucz = tenantId.
const dekCache = new Map<string, Buffer>();

/**
 * Zwraca DEK (32B) dla tenanta - tworzy przy pierwszym uzyciu (generuj losowy ->
 * owin KEK -> zapisz `encryption_keys`), w kolejnych odwija z bazy. Idempotentny
 * na wyscig (unique tenant_id; przy kolizji insertu czyta zapisany wiersz).
 */
export async function getOrCreateDek(db: Db, tenantId: string): Promise<Buffer> {
    const cached = dekCache.get(tenantId);
    if (cached) return cached;

    const kek = loadKek();

    const existing = await db
        .from("encryption_keys")
        .select("wrapped_dek")
        .eq("tenant_id", tenantId)
        .maybeSingle();
    const wrappedExisting = (existing.data as { wrapped_dek?: string } | null)
        ?.wrapped_dek;
    if (wrappedExisting) {
        const dek = Buffer.from(decryptField(wrappedExisting, kek), "base64");
        dekCache.set(tenantId, dek);
        return dek;
    }

    const dek = crypto.randomBytes(32);
    const wrapped = encryptField(dek.toString("base64"), kek);
    const { error } = await db.from("encryption_keys").insert({
        tenant_id: tenantId,
        wrapped_dek: wrapped,
        kek_version: KEK_VERSION,
    });
    if (error) {
        // Wyscig: rownolegly proces zalozyl klucz -> przeczytaj zapisany.
        const again = await db
            .from("encryption_keys")
            .select("wrapped_dek")
            .eq("tenant_id", tenantId)
            .maybeSingle();
        const w = (again.data as { wrapped_dek?: string } | null)?.wrapped_dek;
        if (w) {
            const dek2 = Buffer.from(decryptField(w, kek), "base64");
            dekCache.set(tenantId, dek2);
            return dek2;
        }
        throw new Error(
            `encryption_keys insert nie powiodl sie: ${error.message ?? String(error)}`,
        );
    }
    dekCache.set(tenantId, dek);
    return dek;
}

/** Czysci cache DEK (test / rotacja). */
export function clearDekCache(): void {
    dekCache.clear();
}
