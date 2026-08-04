import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeLocally, FILLER_PATTERNS } from "./src/localAnalysis.js";
import { getPublicCategories, getRandomTopic } from "./src/topics.js";
import { createDatabase } from "./src/createDatabase.js";
import { httpError } from "./src/database.js";
import { analyzeSpeech, getAiConfig, resolveAiConfig, transcribeAudio } from "./src/aiProvider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
loadEnv(path.join(__dirname, ".env"));

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const maxBodyBytes = 20 * 1024 * 1024;
const sessionCookieName = "orator_session";
const database = await createDatabase({
  dataDir,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminName: process.env.ADMIN_NAME
});
const aiConfig = await resolveAiConfig();

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;

    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/config") {
      return sendJson(res, 200, {
        aiEnabled: aiConfig.enabled && aiConfig.aiProbeOk,
        aiProvider: aiConfig.provider,
        aiModel: aiConfig.analysisModel,
        aiStatus: aiConfig.aiProbeOk ? "ready" : (aiConfig.aiProbeReason || "key_invalid"),
        maxRecordingSeconds: 90,
        registrationEnabled: true
      });
    }

    if (req.method === "GET" && pathname === "/api/categories") {
      return sendJson(res, 200, { categories: getPublicCategories() });
    }

    if (req.method === "GET" && pathname === "/api/topic") {
      const category = requestUrl.searchParams.get("category") || "everyday";
      const exclude = requestUrl.searchParams.get("exclude") || "";
      return sendJson(res, 200, { topic: getRandomTopic(category, exclude) });
    }

    if (req.method === "POST" && pathname === "/api/auth/register") {
      const body = await readJson(req, 64 * 1024);
      const user = await database.register(body);
      const token = await database.createSession(user.id);
      setSessionCookie(res, token);
      return sendJson(res, 201, { user });
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJson(req, 64 * 1024);
      const user = await database.authenticate(body.email, body.password);
      const token = await database.createSession(user.id);
      setSessionCookie(res, token);
      return sendJson(res, 200, { user });
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      await database.deleteSession(getSessionToken(req));
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      return sendJson(res, 200, { user: await getCurrentUser(req) });
    }

    if (req.method === "GET" && pathname === "/api/dashboard") {
      const user = await requireUser(req);
      return sendJson(res, 200, await database.getDashboard(user.id));
    }

    if (req.method === "GET" && pathname === "/api/leaderboard") {
      return sendJson(res, 200, { leaderboard: await database.getLeaderboard() });
    }

    if (req.method === "GET" && pathname === "/api/homeworks") {
      const user = await requireUser(req);
      return sendJson(res, 200, { homeworks: await database.getHomeworks(user.id) });
    }

    const homeworkSubmitMatch = pathname.match(/^\/api\/homeworks\/([^/]+)\/submit$/);
    if (req.method === "POST" && homeworkSubmitMatch) {
      const user = await requireUser(req);
      const body = await readJson(req, 256 * 1024);
      const submission = await database.submitHomework(user.id, homeworkSubmitMatch[1], body.answer);
      return sendJson(res, 200, { submission });
    }

    if (req.method === "GET" && pathname === "/api/admin/overview") {
      await requireAdmin(req);
      return sendJson(res, 200, await database.getAdminOverview());
    }

    if (req.method === "POST" && pathname === "/api/admin/homeworks") {
      const admin = await requireAdmin(req);
      const body = await readJson(req, 256 * 1024);
      return sendJson(res, 201, { homework: await database.createHomework(admin.id, body) });
    }

    const adminHomeworkMatch = pathname.match(/^\/api\/admin\/homeworks\/([^/]+)$/);
    if (adminHomeworkMatch && req.method === "PATCH") {
      await requireAdmin(req);
      const body = await readJson(req, 256 * 1024);
      return sendJson(res, 200, { homework: await database.updateHomework(adminHomeworkMatch[1], body) });
    }
    if (adminHomeworkMatch && req.method === "DELETE") {
      await requireAdmin(req);
      await database.deleteHomework(adminHomeworkMatch[1]);
      return sendJson(res, 200, { ok: true });
    }

    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && req.method === "PATCH") {
      const admin = await requireAdmin(req);
      const body = await readJson(req, 64 * 1024);
      return sendJson(res, 200, { user: await database.updateUser(adminUserMatch[1], body, admin.id) });
    }

    const reviewMatch = pathname.match(/^\/api\/admin\/submissions\/([^/]+)$/);
    if (reviewMatch && req.method === "PATCH") {
      await requireAdmin(req);
      const body = await readJson(req, 128 * 1024);
      return sendJson(res, 200, { submission: await database.reviewSubmission(reviewMatch[1], body) });
    }

    if (req.method === "POST" && pathname === "/api/analyze") {
      return await handleAnalyze(req, res);
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(pathname, req.method === "HEAD", res);
    }

    return sendJson(res, 404, { error: "Маршрут не найден." });
  } catch (error) {
    console.error(error);
    const status = error.statusCode || 500;
    if (!res.headersSent) sendJson(res, status, { error: error.message || "Внутренняя ошибка сервера." });
    else res.end();
  }
});

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  server.listen(port, host, () => {
    const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.FIREBASE_HOSTING_URL || `http://localhost:${port}`;
    console.log(`\nSPEAKUP запущен: ${publicUrl}`);
    console.log(process.env.OPENAI_API_KEY || process.env.AI_API_KEY ? "ИИ-анализ включён." : "Деморежим: API-ключ не указан.");
    if (aiConfig.enabled) {
      const status = aiConfig.aiProbeOk ? "подключён" : `ошибка: ${aiConfig.aiProbeReason || "неверный ключ или base URL"}`;
      console.log(`ИИ: ${aiConfig.provider} → ${aiConfig.analysisModel} (${status})`);
    }
    console.log(`Админ: ${process.env.ADMIN_EMAIL || "admin@minute.local"}`);
    if (database.backend === "firebase") {
      console.log("База данных: Firebase Firestore");
    } else {
      console.log(`База данных: локальный файл ${path.join(dataDir, "database.json")}`);
    }
    console.log("");
  });
}

export { server, database, aiConfig };

async function handleAnalyze(req, res) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJson(res, 400, { error: "Не найден multipart boundary." });

  const body = await readRequestBody(req, maxBodyBytes);
  const { fields, files } = parseMultipart(body, boundaryMatch[1] || boundaryMatch[2]);
  const audioFiles = Object.entries(files)
    .filter(([name, file]) => (name === "audio" || /^audio\d+$/.test(name)) && file?.data?.length)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([, file]) => file);
  const topic = String(fields.topic || "Свободная тема").slice(0, 500);
  const category = String(fields.category || "everyday").slice(0, 50);
  const browserTranscript = String(fields.transcript || "").trim().slice(0, 20000);
  const durationSeconds = Math.min(180, Math.max(1, Number(fields.durationSeconds) || 60));
  const pauses = parsePauses(fields.pauses);
  let transcript = browserTranscript;
  let transcriptionSource = browserTranscript ? "browser" : "none";
  let transcriptionWarning = "";

  if (aiConfig.transcriptionEnabled && aiConfig.aiProbeOk && audioFiles.length) {
    try {
      const parts = [];
      for (const audio of audioFiles) {
        const part = await transcribeAudio(audio, aiConfig);
        if (part) parts.push(part);
      }
      transcript = parts.join(" ").trim() || browserTranscript;
      transcriptionSource = "ai-full-recording";
    } catch (error) {
      if (browserTranscript) {
        transcript = browserTranscript;
        transcriptionSource = "browser";
      } else {
        transcriptionWarning = `Не удалось расшифровать аудиозапись: ${error.message}`;
        throw error;
      }
    }
  }

  if (!transcript) {
    return sendJson(res, 422, {
      error: "Речь не распознана. Откройте сайт в Google Chrome или добавьте AI_API_KEY в файл .env."
    });
  }

  const metrics = analyzeLocally({ transcript, durationSeconds, pauses });
  let coach = null;
  let aiWarning = "";

  if (aiConfig.enabled && aiConfig.aiProbeOk) {
    try {
      coach = await analyzeSpeech({ topic, transcript, metrics }, aiConfig);
    } catch (error) {
      aiWarning = `ИИ-разбор временно недоступен: ${error.message}`;
    }
  } else if (aiConfig.enabled && !aiConfig.aiProbeOk) {
    aiWarning = `ИИ-разбор недоступен: ${aiConfig.aiProbeReason || "проверьте API-ключ на https://api.tu-zi.com"}`;
  }

  const user = await getCurrentUser(req);
  let savedResult = null;
  if (user) {
    savedResult = await database.saveResult(user.id, {
      topic,
      category,
      score: metrics.overallScore,
      wpm: metrics.wpm,
      fillers: metrics.fillers.total,
      structure: metrics.structureScore
    });
  }

  return sendJson(res, 200, {
    transcript,
    transcriptionSource,
    metrics,
    coach,
    savedResult,
    fillersDictionary: FILLER_PATTERNS,
    warnings: [transcriptionWarning, aiWarning, user ? "" : "Войдите в аккаунт, чтобы сохранить результат в рейтинге."].filter(Boolean),
    aiEnabled: aiConfig.enabled && aiConfig.aiProbeOk
  });
}

async function getCurrentUser(req) {
  return database.getUserBySession(getSessionToken(req));
}

async function requireUser(req) {
  const user = await getCurrentUser(req);
  if (!user) throw httpError(401, "Сначала войдите в аккаунт.");
  return user;
}

async function requireAdmin(req) {
  const user = await requireUser(req);
  if (user.role !== "admin") throw httpError(403, "Доступ разрешён только администраторам.");
  return user;
}

function getSessionToken(req) {
  const cookie = String(req.headers.cookie || "");
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === sessionCookieName) return decodeURIComponent(value.join("="));
  }
  return "";
}

function isSecureCookie() {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return Boolean(process.env.RENDER || process.env.FUNCTION_TARGET || process.env.K_SERVICE || process.env.NODE_ENV === "production");
}

function setSessionCookie(res, token) {
  const secure = isSecureCookie() ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function serveStatic(urlPath, headOnly, res) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return sendText(res, 400, "Некорректный адрес."); }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, relative);
  if (!filePath.startsWith(`${publicDir}${path.sep}`) && filePath !== publicDir) return sendText(res, 403, "Доступ запрещён.");

  let stat;
  try { stat = fs.statSync(filePath); } catch { return sendText(res, 404, "Страница не найдена."); }
  if (!stat.isFile()) return sendText(res, 404, "Страница не найдена.");

  res.writeHead(200, {
    "Content-Type": mimeType(filePath),
    "Content-Length": stat.size,
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "microphone=(self)"
  });
  if (headOnly) return res.end();
  fs.createReadStream(filePath).pipe(res);
}

function mimeType(filePath) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  }[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = httpError(413, "Запрос слишком большой.");
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req, limit) {
  const buffer = await readRequestBody(req, limit);
  if (!buffer.length) return {};
  try { return JSON.parse(buffer.toString("utf8")); }
  catch { throw httpError(400, "Некорректный JSON."); }
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const fields = {};
  const files = {};
  const positions = [];
  let cursor = 0;
  while (cursor < body.length) {
    const found = body.indexOf(delimiter, cursor);
    if (found === -1) break;
    positions.push(found);
    cursor = found + delimiter.length;
  }
  for (let index = 0; index < positions.length - 1; index += 1) {
    let part = body.subarray(positions[index] + delimiter.length, positions[index + 1]);
    if (part.subarray(0, 2).toString() === "\r\n") part = part.subarray(2);
    if (part.subarray(-2).toString() === "\r\n") part = part.subarray(0, -2);
    if (!part.length || part.subarray(0, 2).toString() === "--") continue;
    const headerEnd = part.indexOf(headerSeparator);
    if (headerEnd === -1) continue;
    const headerText = part.subarray(0, headerEnd).toString("utf8");
    const content = part.subarray(headerEnd + headerSeparator.length);
    const name = headerText.match(/name="([^"]+)"/i)?.[1];
    if (!name) continue;
    const filename = headerText.match(/filename="([^"]*)"/i)?.[1];
    const type = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "application/octet-stream";
    if (filename !== undefined) files[name] = { filename: filename || "upload.bin", type, data: content };
    else fields[name] = content.toString("utf8");
  }
  return { fields, files };
}

function parsePauses(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return {
      count: Math.max(0, Number(parsed.count) || 0),
      maxSeconds: Math.max(0, Number(parsed.maxSeconds) || 0),
      totalSeconds: Math.max(0, Number(parsed.totalSeconds) || 0)
    };
  } catch {
    return { count: 0, maxSeconds: 0, totalSeconds: 0 };
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  if (!res.hasHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.statusCode = status;
  res.end(body);
}

function sendText(res, status, message) {
  const body = String(message);
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
