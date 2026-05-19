import { Request, Response, NextFunction } from "express";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Single admin client, created once instead of per request.
let adminClient: SupabaseClient | undefined;

function getAdminClient(): SupabaseClient | null {
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!supabaseUrl || !serviceKey) return null;
  if (!adminClient) {
    adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
  }
  return adminClient;
}

// Token validation cache. Without it every request triggers a network call to
// Supabase Auth (getUser), which does not scale. TTL bounds staleness: a revoked
// token keeps working for at most TOKEN_CACHE_TTL_MS.
interface CachedUser {
  userId: string;
  userEmail: string;
  expiresAt: number;
}

const TOKEN_CACHE_TTL_MS = 60_000;
const TOKEN_CACHE_MAX = 5_000;
const tokenCache = new Map<string, CachedUser>();

function cacheGet(token: string): CachedUser | null {
  const hit = tokenCache.get(token);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    tokenCache.delete(token);
    return null;
  }
  return hit;
}

function cacheSet(token: string, userId: string, userEmail: string): void {
  // Evict the oldest entry when full (Map preserves insertion order).
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(token, {
    userId,
    userEmail,
    expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
  });
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ detail: "Missing or invalid Authorization header" });
    return;
  }
  const token = auth.slice(7).trim();

  const cached = cacheGet(token);
  if (cached) {
    res.locals.userId = cached.userId;
    res.locals.userEmail = cached.userEmail;
    res.locals.token = token;
    next();
    return;
  }

  const admin = getAdminClient();
  if (!admin) {
    res.status(500).json({ detail: "Server auth is not configured" });
    return;
  }

  const { data } = await admin.auth.getUser(token);
  if (!data.user) {
    res.status(401).json({ detail: "Invalid or expired token" });
    return;
  }

  const userId = data.user.id;
  const userEmail = data.user.email?.toLowerCase() ?? "";
  cacheSet(token, userId, userEmail);

  res.locals.userId = userId;
  res.locals.userEmail = userEmail;
  res.locals.token = token;
  next();
}
