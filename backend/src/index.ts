import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { chatRouter } from "./routes/chat";
import { projectsRouter } from "./routes/projects";
import { projectChatRouter } from "./routes/projectChat";
import { documentsRouter } from "./routes/documents";
import { tabularRouter } from "./routes/tabular";
import { workflowsRouter } from "./routes/workflows";
import { userRouter } from "./routes/user";
import { downloadsRouter } from "./routes/downloads";
import { auditRouter } from "./routes/audit";
import { securityRouter } from "./routes/security";
import { metricsRouter } from "./routes/metrics";
import { foldersRouter } from "./routes/folders";
import { draftRouter } from "./routes/draft";
import { rodoRouter } from "./routes/rodo";
import { usageRouter } from "./routes/usage";
import { skillsRouter } from "./routes/skills";
import { createServerSupabase, isSqliteBackend } from "./lib/supabase";
import { runAutoCompute } from "./lib/audit-merkle-roots";
import {
  parseIntervalHours,
  parsePositiveInt,
} from "./lib/audit-merkle-scheduler";

const app = express();
const PORT = process.env.PORT ?? 3001;
const isProduction = process.env.NODE_ENV === "production";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function minutes(value: number): number {
  return value * 60 * 1000;
}

function hours(value: number): number {
  return minutes(value * 60);
}

function makeLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
    message: {
      detail:
        options.message ?? "Too many requests. Please try again later.",
    },
  });
}

const generalLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_GENERAL_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_GENERAL_MAX", 300),
});

const chatLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_CHAT_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_CHAT_MAX", 30),
  message: "Too many chat requests. Please try again later.",
});

const chatCreateLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_CHAT_CREATE_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_CHAT_CREATE_MAX", 60),
});

const uploadLimiter = makeLimiter({
  windowMs: hours(envInt("RATE_LIMIT_UPLOAD_WINDOW_HOURS", 1)),
  max: envInt("RATE_LIMIT_UPLOAD_MAX", 50),
  message: "Too many upload requests. Please try again later.",
});

app.disable("x-powered-by");
app.set("trust proxy", envInt("TRUST_PROXY_HOPS", 1));

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: isProduction
      ? {
          maxAge: 15552000,
          includeSubDomains: true,
        }
      : false,
    referrerPolicy: { policy: "no-referrer" },
  }),
);

// Dodatkowe nagłówki bezpieczeństwa (helmet nie ustawia ich domyślnie).
// Permissions-Policy: domyślnie zerujemy uprawnienia do API które
// kancelaria-grade aplikacji nie potrzebuje (kamera, mikrofon, geo,
// czujniki, MIDI itp.). Ułatwia audyt RODO art. 32.
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    [
      "accelerometer=()",
      "ambient-light-sensor=()",
      "autoplay=()",
      "battery=()",
      "camera=()",
      "display-capture=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "usb=()",
    ].join(", "),
  );
  // X-DNS-Prefetch-Control: jawnie wyłączony (helmet domyślnie ma off, ale
  // dorzucamy dla pewności na wszelkich proxy).
  res.setHeader("X-DNS-Prefetch-Control", "off");
  next();
});

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
  }),
);

app.use(generalLimiter);

app.use(express.json({ limit: "50mb" }));

app.post("/chat", chatLimiter);
app.post("/projects/:projectId/chat", chatLimiter);
app.post("/tabular-review/:reviewId/chat", chatLimiter);
app.post("/tabular-review/:reviewId/generate", chatLimiter);
app.post("/chat/create", chatCreateLimiter);
app.post("/chat/:chatId/generate-title", chatCreateLimiter);
app.post("/draft/refine", chatLimiter);
app.post("/single-documents", uploadLimiter);
app.post("/single-documents/:documentId/versions", uploadLimiter);
app.post("/projects/:projectId/documents", uploadLimiter);

app.use("/chat", chatRouter);
app.use("/projects", projectsRouter);
app.use("/projects/:projectId/chat", projectChatRouter);
app.use("/single-documents", documentsRouter);
app.use("/tabular-review", tabularRouter);
app.use("/workflows", workflowsRouter);
app.use("/user", userRouter);
app.use("/users", userRouter);
app.use("/download", downloadsRouter);
app.use("/api/audit", auditRouter);
app.use("/api/security", securityRouter);
app.use("/metrics", metricsRouter);
app.use("/folders", foldersRouter);
app.use("/draft", draftRouter);
app.use("/rodo", rodoRouter);
app.use("/api/usage", usageRouter);
app.use("/skills", skillsRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

// ADR-0036: hybrid auto-trigger Merkle audit root. Tick co
// PATRON_MERKLE_CHECK_INTERVAL_MS (default 1h). Decyzja compute pure
// function `shouldComputeNextRoot` w lib/audit-merkle-scheduler.
// TODO ADR-0041: distributed lock (Postgres advisory lock) gdy backend
// bedzie multi-instance. Obecnie self-host single-instance per kancelaria.
function startMerkleScheduler(): void {
  const checkIntervalMs = envInt("PATRON_MERKLE_CHECK_INTERVAL_MS", 3600000);
  const countThreshold = parsePositiveInt(
    process.env.PATRON_MERKLE_AUTO_COUNT_THRESHOLD,
    1000,
  );
  const intervalMs = parseIntervalHours(
    process.env.PATRON_MERKLE_AUTO_INTERVAL_HOURS,
    24 * 3600 * 1000,
  );

  setInterval(async () => {
    try {
      const db = createServerSupabase();
      const result = await runAutoCompute(db, {
        countThreshold,
        intervalMs,
        computedBy: "auto-scheduler",
      });
      if (result.decision.compute && result.computeResult?.ok) {
        const root = result.computeResult.root;
        console.log(
          `[merkle:auto] root #${root?.id} computed (reason=${result.decision.reason}, events=${root?.event_count})`,
        );
      } else if (result.decision.compute && !result.computeResult?.ok) {
        console.warn(
          `[merkle:auto] compute FAIL (reason=${result.decision.reason}): ${result.computeResult?.error}`,
        );
      }
      // decision.compute === false = skip, brak loga (norma)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[merkle:auto] tick FAIL: ${msg}`);
    }
  }, checkIntervalMs);

  console.log(
    `[merkle:auto] scheduler started (check=${Math.floor(checkIntervalMs / 1000)}s, count_threshold=${countThreshold}, interval=${Math.floor(intervalMs / 3600 / 1000)}h)`,
  );
}

// Bind loopback w trybie desktop (sqlite, auth bypass) - inaczej API kancelarii
// jest dostepne w calej sieci LAN. Tryb serwerowy zachowuje 0.0.0.0; override env.
const HOST = process.env.PATRON_HOST ?? (isSqliteBackend() ? "127.0.0.1" : "0.0.0.0");
app.listen(Number(PORT), HOST, () => {
  console.log(`PATRON backend running on ${HOST}:${PORT}`);
  startMerkleScheduler();
});
