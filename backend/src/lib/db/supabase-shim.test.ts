// Testy adaptera SQLite (db/supabase-shim) - kontrakt API supabase-js uzywany
// przez backend. Swieza tymczasowa baza per uruchomienie (PATRON_DB_PATH).

import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// `any`: createServerSupabase() zwraca SupabaseClient (shim rzutowany), ktorego
// generyki nie znaja schematu - luzny typ w tescie jest swiadomy i celowy.
let db: any;
let appendAuditEvent: typeof import("../audit").appendAuditEvent;
const tmp = path.join(os.tmpdir(), `patron-shim-test-${Date.now()}.db`);

beforeAll(async () => {
  process.env.PATRON_DB_BACKEND = "sqlite";
  process.env.PATRON_DB_PATH = tmp;
  const supa = await import("../supabase");
  db = supa.createServerSupabase();
  ({ appendAuditEvent } = await import("../audit"));
});

afterAll(async () => {
  const { closeDb } = await import("./sqlite-connection");
  closeDb();
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

describe("supabase-shim: CRUD + jsonb round-trip", () => {
  it("insert+select+single nadaje UUID i parsuje jsonb (shared_with)", async () => {
    const r = await db
      .from("projects")
      .insert({ user_id: "u1", name: "Sprawa", shared_with: ["a@x.pl"] })
      .select()
      .single();
    expect(r.error).toBeNull();
    expect(typeof r.data.id).toBe("string");
    expect(r.data.id).toHaveLength(36);
    expect(r.data.shared_with).toEqual(["a@x.pl"]);
  });

  it("chat_messages.content (jsonb array) round-trip", async () => {
    const chat = await db.from("chats").insert({ user_id: "u1" }).select().single();
    const msg = await db
      .from("chat_messages")
      .insert({ chat_id: chat.data.id, role: "assistant", content: [{ type: "text" }] })
      .select()
      .single();
    expect(Array.isArray(msg.data.content)).toBe(true);
  });

  it("single() na braku wiersza zwraca data=null bez rzucania", async () => {
    const miss = await db.from("projects").select("*").eq("id", "brak").single();
    expect(miss.data).toBeNull();
  });
});

describe("supabase-shim: filtry i modyfikatory", () => {
  it("count exact head", async () => {
    const chat = await db.from("chats").insert({ user_id: "u2" }).select().single();
    await db.from("chat_messages").insert({ chat_id: chat.data.id, role: "user", content: [] });
    const c = await db
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chat.data.id);
    expect(c.count).toBe(1);
  });

  it(".or() z eq oraz in(parens)", async () => {
    const proj = await db.from("projects").insert({ user_id: "u3", name: "P" }).select().single();
    await db.from("chats").insert({ user_id: "u3", project_id: proj.data.id });
    const r = await db
      .from("chats")
      .select("*")
      .or(`user_id.eq.u3,project_id.in.(${proj.data.id})`);
    expect(r.data.length).toBeGreaterThanOrEqual(1);
  });

  it("filtr boolean eq false", async () => {
    await db.from("workflows").insert({ user_id: "u4", title: "w", type: "assistant", is_system: false });
    const r = await db.from("workflows").select("*").eq("user_id", "u4").eq("is_system", false);
    expect(r.data.length).toBe(1);
  });

  it("upsert onConflict aktualizuje istniejacy wiersz", async () => {
    const base = { user_id: "u5", provider: "claude", iv: "i", auth_tag: "t" };
    await db.from("user_api_keys").upsert({ ...base, encrypted_key: "e1", updated_at: "t1" }, { onConflict: "user_id,provider" });
    await db.from("user_api_keys").upsert({ ...base, encrypted_key: "e2", updated_at: "t2" }, { onConflict: "user_id,provider" });
    const r = await db.from("user_api_keys").select("encrypted_key").eq("user_id", "u5").eq("provider", "claude");
    expect(r.data.length).toBe(1);
    expect(r.data[0].encrypted_key).toBe("e2");
  });
});

describe("supabase-shim: audit hash-chain", () => {
  it("dwa appendy linkuja sie (prev_hash = poprzedni hash) i order desc limit 1 zwraca ostatni", async () => {
    const a1 = await appendAuditEvent(db, { event_type: "chat.message.user", actor_user_id: "u1", payload: { n: 1 } });
    const a2 = await appendAuditEvent(db, { event_type: "chat.message.assistant", actor_user_id: "u1", payload: { n: 2 } });
    expect(a1.ok).toBe(true);
    expect(a2.ok).toBe(true);
    expect(a2.row!.prev_hash).toBe(a1.row!.hash);
    const last = await db.from("audit_log").select("hash").order("id", { ascending: false }).limit(1);
    expect(last.data[0].hash).toBe(a2.row!.hash);
  });
});

describe("supabase-shim: auth single-user", () => {
  it("getUser / listUsers / getUserById zwracaja lokalnego usera", async () => {
    const gu = await db.auth.getUser("ignored");
    expect(gu.data.user).not.toBeNull();
    const lu = await db.auth.admin.listUsers({ perPage: 1000 });
    expect(lu.data.users.length).toBeGreaterThanOrEqual(1);
    const gid = await db.auth.admin.getUserById(gu.data.user.id);
    expect(gid.data.user.id).toBe(gu.data.user.id);
  });
});
