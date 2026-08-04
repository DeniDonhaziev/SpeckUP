import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(root, ".env");

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = readEnv(envPath);
const credsFile = env.FIREBASE_CREDENTIALS_FILE;
let serviceAccount = null;

if (credsFile && fs.existsSync(credsFile)) {
  serviceAccount = JSON.parse(fs.readFileSync(credsFile, "utf8"));
}

console.log("=== Скопируйте в Render → Environment ===\n");
console.log("AI_API_KEY=" + (env.AI_API_KEY || env.OPENAI_API_KEY || "(заполните)"));
console.log("ADMIN_EMAIL=" + (env.ADMIN_EMAIL || "(заполните)"));
console.log("ADMIN_PASSWORD=" + (env.ADMIN_PASSWORD || "(заполните)"));
console.log("DB_BACKEND=firebase");

if (serviceAccount) {
  console.log("\nFIREBASE_SERVICE_ACCOUNT=(вставьте одной строкой JSON ниже)");
  console.log(JSON.stringify(serviceAccount));
} else {
  console.log("\nFIREBASE_SERVICE_ACCOUNT=(не найден JSON, укажите вручную)");
}

console.log("\n=== Остальное уже в render.yaml ===");
console.log("AI_PROVIDER=tuzi");
console.log("AI_BASE_URL=https://api.tu-zi.com/v1");
console.log("ANALYSIS_MODEL=gpt-4o-mini");
