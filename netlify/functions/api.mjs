import { Readable, Writable } from "node:stream";
import { once } from "node:events";

let requestListenerPromise;

async function getRequestListener() {
  if (!requestListenerPromise) {
    requestListenerPromise = import("../../server.js").then(({ server }) => {
      const [listener] = server.listeners("request");
      if (!listener) throw new Error("HTTP handler from server.js was not initialized.");
      return listener;
    });
  }
  return requestListenerPromise;
}

class NetlifyResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.headersSent = false;
  }

  _write(chunk, encoding, callback) {
    this.headersSent = true;
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    callback();
  }

  setHeader(name, value) {
    this.headers[name] = value;
    return this;
  }

  getHeader(name) {
    return this.headers[name];
  }

  hasHeader(name) {
    return Object.keys(this.headers).some((key) => key.toLowerCase() === String(name).toLowerCase());
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    this.headersSent = true;
    return this;
  }

  toNetlifyResponse() {
    return {
      statusCode: this.statusCode,
      headers: this.headers,
      body: Buffer.concat(this.chunks).toString("utf8")
    };
  }
}

function getOriginalPath(event) {
  const candidates = [event.rawUrl, event.path].filter(Boolean);
  for (const candidate of candidates) {
    let pathname;
    try {
      pathname = new URL(candidate, "https://netlify.local").pathname;
    } catch {
      continue;
    }

    const functionPrefix = "/.netlify/functions/api";
    if (pathname === functionPrefix || pathname.startsWith(`${functionPrefix}/`)) {
      const suffix = pathname.slice(functionPrefix.length);
      if (!suffix || suffix === "/health") return "/health";
      return `/api${suffix}`;
    }
    if (pathname === "/health" || pathname === "/api" || pathname.startsWith("/api/")) return pathname;
  }
  return "/";
}

export default async function handler(event) {
  try {
    const requestListener = await getRequestListener();
    const body = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");
    const headers = Object.fromEntries(
      Object.entries(event.headers || {}).map(([name, value]) => [name.toLowerCase(), value])
    );
    const requestUrl = new URL(event.rawUrl || event.path || "/", "https://netlify.local");
    const pathname = getOriginalPath(event);
    const request = Readable.from(body.length ? [body] : []);
    request.method = event.httpMethod || "GET";
    request.url = `${pathname}${requestUrl.search}`;
    request.headers = headers;

    const response = new NetlifyResponse();
    const finished = once(response, "finish");
    requestListener(request, response);
    await finished;
    return response.toNetlifyResponse();
  } catch (error) {
    console.error("Netlify API function failed:", error);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Внутренняя ошибка сервера. Проверьте логи Netlify Function." })
    };
  }
}
