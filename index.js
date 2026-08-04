import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({
  region: "europe-west1",
  memory: "512MiB",
  timeoutSeconds: 120,
  maxInstances: 10
});

process.env.DB_BACKEND ||= "firebase";
process.env.AI_PROVIDER ||= "tuzi";
process.env.AI_BASE_URL ||= "https://api.tu-zi.com/v1";
process.env.ANALYSIS_MODEL ||= "gpt-4o-mini";
process.env.NODE_ENV ||= "production";

let handlerPromise;

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = import("./server.js").then(({ server }) => (req, res) => {
      server.emit("request", req, res);
    });
  }
  return handlerPromise;
}

export const api = onRequest(async (req, res) => {
  const handler = await getHandler();
  handler(req, res);
});
