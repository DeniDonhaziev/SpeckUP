// Vercel Serverless Function Handler
import http from "node:http";

// Важно: импортируем server ПОСЛЕ установки переменных окружения
process.env.DB_BACKEND = process.env.DB_BACKEND || "firebase";
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.AI_PROVIDER = process.env.AI_PROVIDER || "tuzi";
process.env.AI_BASE_URL = process.env.AI_BASE_URL || "https://api.tu-zi.com/v1";
process.env.ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || "gpt-4o-mini";

let serverPromise;

async function getServer() {
  if (!serverPromise) {
    serverPromise = import("../server.js").then(module => module.server);
  }
  return serverPromise;
}

export default async function handler(req, res) {
  try {
    const server = await getServer();

    // Эмулируем HTTP запрос для Node.js сервера
    const incomingMessage = Object.assign(
      new http.IncomingMessage(),
      {
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.body
      }
    );

    // Если есть тело запроса, передаём его
    if (req.body) {
      incomingMessage.push(
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
      );
      incomingMessage.push(null);
    }

    server.emit("request", incomingMessage, res);
  } catch (error) {
    console.error("Handler error:", error);
    res.status(500).json({ error: error.message });
  }
}

