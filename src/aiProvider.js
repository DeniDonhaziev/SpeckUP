const PROVIDER_PRESETS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    analysisModel: "gpt-4o-mini",
    transcribeModel: "gpt-4o-mini-transcribe",
    useResponsesApi: true
  },
  proxyapi: {
    baseUrl: "https://openai.api.proxyapi.ru/v1",
    analysisModel: "google/gemini-2.5-pro",
    transcribeModel: "openai/whisper-1",
    useResponsesApi: false
  },
  aitunnel: {
    baseUrl: "https://api.aitunnel.ru/v1",
    analysisModel: "gpt-4o",
    transcribeModel: "whisper-1",
    useResponsesApi: false
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    analysisModel: "deepseek-chat",
    transcribeModel: "",
    useResponsesApi: false
  },
  chatanywhere: {
    baseUrl: "https://api.chatanywhere.tech/v1",
    analysisModel: "deepseek-chat",
    transcribeModel: "",
    useResponsesApi: false
  },
  tuzi: {
    baseUrl: "https://api.tu-zi.com/v1",
    analysisModel: "gpt-4o-mini",
    transcribeModel: "",
    useResponsesApi: false
  }
};

const DEFAULT_BASE_URL = "https://api.tu-zi.com/v1";

function resolveEnvModel(envKeys, fallback) {
  for (const key of envKeys) {
    if (key in process.env) return String(process.env[key] || "").trim();
  }
  return String(fallback || "").trim();
}

export function getAiConfig() {
  const apiKey = String(process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const presetName = String(process.env.AI_PROVIDER || "auto").toLowerCase();
  const preset = PROVIDER_PRESETS[presetName] || null;
  const baseUrl = String(process.env.AI_BASE_URL || preset?.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const analysisModel = resolveEnvModel(["ANALYSIS_MODEL", "AI_ANALYSIS_MODEL"], preset?.analysisModel || "gpt-4o-mini");
  const transcribeModel = resolveEnvModel(["TRANSCRIBE_MODEL", "AI_TRANSCRIBE_MODEL"], preset?.transcribeModel || "");
  const useResponsesApi = process.env.AI_USE_RESPONSES_API === "true";

  return {
    enabled: Boolean(apiKey),
    apiKey,
    baseUrl,
    analysisModel,
    transcribeModel,
    transcriptionEnabled: Boolean(apiKey && transcribeModel),
    provider: presetName === "auto" ? detectProviderName(baseUrl) : presetName
  };
}

function detectProviderName(baseUrl) {
  if (baseUrl.includes("proxyapi.ru")) return "proxyapi";
  if (baseUrl.includes("aitunnel.ru")) return "aitunnel";
  if (baseUrl.includes("deepseek.com")) return "deepseek";
  if (baseUrl.includes("chatanywhere")) return "chatanywhere";
  if (baseUrl.includes("tu-zi.com")) return "tuzi";
  if (baseUrl.includes("openai.com")) return "openai";
  return "custom";
}

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

function humanizeApiError(message) {
  const text = String(message || "");
  if (/unsupported_country|Country, region, or territory not supported/i.test(text)) {
    return "OpenAI заблокирован в вашем регионе. Используйте ChatAnywhere (AI_PROVIDER=chatanywhere), а не OpenAI напрямую.";
  }
  if (/wrong api key|ApiKey错误|invalid api key|authentication/i.test(text)) {
    return "Неверный API-ключ. Получите новый на https://api.chatanywhere.tech";
  }
  return text;
}

export async function transcribeAudio(file, config = getAiConfig()) {
  if (!config.transcriptionEnabled) throw new Error("Транскрибация не настроена.");
  const form = new FormData();
  form.append("file", new Blob([file.data], { type: file.type || "audio/webm" }), file.filename || "speech.webm");
  form.append("model", config.transcribeModel);
  form.append("language", "ru");
  form.append("response_format", "json");
  form.append("prompt", "Русская речь о публичных выступлениях. Сохраняй слова-паразиты, повторы и незаконченные фразы точно, не исправляй их.");

  const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: authHeaders(config.apiKey),
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(humanizeApiError(data?.error?.message || data?.message || `Ошибка транскрибации (${response.status})`));
  return String(data.text || "").trim();
}

const FEEDBACK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    relevanceScore: { type: "integer", minimum: 0, maximum: 100 },
    logicScore: { type: "integer", minimum: 0, maximum: 100 },
    confidenceScore: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" }, maxItems: 3 },
    issues: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          fragment: { type: "string" },
          explanation: { type: "string" },
          correction: { type: "string" }
        },
        required: ["fragment", "explanation", "correction"]
      }
    },
    improvedAnswer: { type: "string" },
    improvements: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string" }
    },
    nextExercise: { type: "string" }
  },
  required: ["relevanceScore", "logicScore", "confidenceScore", "summary", "strengths", "issues", "improvedAnswer", "improvements", "nextExercise"]
};

function buildFallbackExercise({ topic, metrics }) {
  const safeTopic = String(topic || "Свободная тема").slice(0, 120);
  if (metrics?.fillers?.total > 2) {
    return `Запишите 60 секунд на тему «${safeTopic}» и после каждой мысли делайте паузу 1 секунду вместо слов-паразитов.`;
  }
  if ((metrics?.pauses?.maxSeconds ?? 0) > 3) {
    return `Подготовьте 3 пункта плана на тему «${safeTopic}» и проговорите их вслух за 60 секунд без пауз дольше 2 секунд.`;
  }
  if ((metrics?.structureScore ?? 0) < 70) {
    return `Напишите короткий план «тезис → аргумент → пример → вывод» и запишите ответ на «${safeTopic}» строго по этой схеме.`;
  }
  return `Перезапишите ответ на «${safeTopic}»: начните с главного вывода, затем добавьте один конкретный пример из жизни.`;
}

export function normalizeCoachFeedback(raw, { topic, metrics } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const improvementsFromAi = Array.isArray(raw.improvements)
    ? raw.improvements.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const improvementsFromIssues = Array.isArray(raw.issues)
    ? raw.issues
      .map((item) => String(item?.correction || item?.explanation || "").trim())
      .filter(Boolean)
    : [];
  const improvements = (improvementsFromAi.length ? improvementsFromAi : improvementsFromIssues).slice(0, 5);
  const nextExercise = String(raw.nextExercise || raw.next_exercise || raw.exercise || "").trim()
    || buildFallbackExercise({ topic, metrics });

  return {
    relevanceScore: Number(raw.relevanceScore) || 0,
    logicScore: Number(raw.logicScore) || 0,
    confidenceScore: Number(raw.confidenceScore) || 0,
    summary: String(raw.summary || "").trim(),
    strengths: Array.isArray(raw.strengths) ? raw.strengths.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 3) : [],
    issues: Array.isArray(raw.issues) ? raw.issues : [],
    improvedAnswer: String(raw.improvedAnswer || raw.improved_answer || "").trim(),
    improvements,
    nextExercise
  };
}

function buildAnalysisPrompt({ topic, transcript, metrics }) {
  return [
    "Ты доброжелательный, но требовательный тренер по русской устной речи.",
    "Оцени только то, что подтверждается расшифровкой. Не придумывай ошибки произношения, эмоций или голоса.",
    "Учитывай, что автоматическая расшифровка может ошибаться.",
    "Исправленный ответ должен звучать естественно и помещаться примерно в одну минуту.",
    "Не ругай разговорный стиль сам по себе. Отмечай только то, что мешает ясности, логике и убедительности.",
    "Не называй одиночные слова «ну», «вот», «значит», «просто» или «типа» паразитами без явного повторения или пустого употребления. Учитывай смысл фразы целиком.",
    "Поле improvements — 3–5 конкретных советов именно по этому выступлению (не общие шаблоны). Каждый совет ссылается на проблему из расшифровки или метрик.",
    "Поле nextExercise — одно практическое упражнение на 5–10 минут, чтобы прокачать слабое место этого выступления.",
    "Верни только JSON без markdown и комментариев.",
    "",
    `Тема: ${topic}`,
    `Расшифровка: ${transcript}`,
    `Автоматические показатели: ${JSON.stringify(metrics)}`
  ].join("\n");
}

function extractChatContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return "";
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function parseJsonResponse(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Модель вернула пустой ответ");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Не удалось прочитать структурированный ответ модели");
    return JSON.parse(match[0]);
  }
}

async function analyzeWithResponsesApi({ topic, transcript, metrics }, config) {
  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: { ...authHeaders(config.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.analysisModel,
      store: false,
      input: buildAnalysisPrompt({ topic, transcript, metrics }),
      text: { format: { type: "json_schema", name: "speech_feedback", strict: true, schema: FEEDBACK_SCHEMA } }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(humanizeApiError(data?.error?.message || data?.message || `Ошибка ИИ-анализа (${response.status})`));
  return parseJsonResponse(extractOutputText(data));
}

async function analyzeWithChatCompletions({ topic, transcript, metrics }, config) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { ...authHeaders(config.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.analysisModel,
      temperature: 0.2,
      max_tokens: 2500,
      messages: [
        { role: "system", content: "Ты эксперт по русской устной речи. Отвечай строго в JSON по заданной схеме." },
        { role: "user", content: buildAnalysisPrompt({ topic, transcript, metrics }) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "speech_feedback",
          strict: true,
          schema: FEEDBACK_SCHEMA
        }
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 400 && /response_format|json_schema/i.test(String(data?.error?.message || data?.message || ""))) {
      return analyzeWithJsonObjectFallback({ topic, transcript, metrics }, config);
    }
    throw new Error(humanizeApiError(data?.error?.message || data?.message || `Ошибка ИИ-анализа (${response.status})`));
  }
  return parseJsonResponse(extractChatContent(data));
}

async function analyzeWithJsonObjectFallback({ topic, transcript, metrics }, config) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { ...authHeaders(config.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.analysisModel,
      temperature: 0.2,
      max_tokens: 2500,
      messages: [
        {
          role: "system",
          content: `Верни JSON с полями: relevanceScore, logicScore, confidenceScore, summary, strengths, issues, improvedAnswer, improvements (3-5 персональных советов), nextExercise (практическое упражнение). Поле issues — массив объектов с fragment, explanation, correction.`
        },
        { role: "user", content: buildAnalysisPrompt({ topic, transcript, metrics }) }
      ],
      response_format: { type: "json_object" }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(humanizeApiError(data?.error?.message || data?.message || `Ошибка ИИ-анализа (${response.status})`));
  return parseJsonResponse(extractChatContent(data));
}

export async function analyzeSpeech(payload, config = getAiConfig()) {
  if (!config.enabled) throw new Error("ИИ не настроен.");
  const raw = config.useResponsesApi
    ? await analyzeWithResponsesApi(payload, config)
    : await analyzeWithChatCompletions(payload, config);
  return normalizeCoachFeedback(raw, payload);
}

export async function verifyAiConnection(config = getAiConfig()) {
  if (!config.enabled) return { ok: false, reason: "API key missing" };
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { ...authHeaders(config.apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.analysisModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 3
      })
    });
    if (response.ok) return { ok: true, provider: config.provider, model: config.analysisModel };
    const data = await response.json().catch(() => ({}));
    return {
      ok: false,
      provider: config.provider,
      model: config.analysisModel,
      reason: humanizeApiError(data?.error?.message || data?.message || `HTTP ${response.status}`)
    };
  } catch (error) {
    return { ok: false, provider: config.provider, reason: error.message };
  }
}

const AUTO_PROBE_TARGETS = ["tuzi", "chatanywhere", "proxyapi", "aitunnel", "deepseek"];

function inferProviderFromKey(apiKey) {
  if (/^sk-hi/i.test(apiKey)) return "tuzi";
  if (/^sk-aitunnel-/i.test(apiKey)) return "aitunnel";
  if (/^sk-or-/i.test(apiKey)) return "openrouter";
  return null;
}

export async function resolveAiConfig() {
  const initial = getAiConfig();
  if (!initial.enabled) return { ...initial, aiProbeOk: false };

  const inferred = inferProviderFromKey(initial.apiKey);
  if (inferred && !process.env.AI_BASE_URL && (!process.env.AI_PROVIDER || process.env.AI_PROVIDER === "auto")) {
    const preset = PROVIDER_PRESETS[inferred];
    if (preset) {
      const candidate = {
        ...initial,
        baseUrl: preset.baseUrl,
        analysisModel: preset.analysisModel,
        transcribeModel: preset.transcribeModel,
        useResponsesApi: preset.useResponsesApi,
        provider: inferred,
        transcriptionEnabled: Boolean(initial.apiKey && preset.transcribeModel)
      };
      const check = await verifyAiConnection(candidate);
      return {
        ...candidate,
        aiProbeOk: check.ok,
        aiProbeReason: check.ok ? undefined : check.reason
      };
    }
  }

  if (process.env.AI_BASE_URL || (process.env.AI_PROVIDER && process.env.AI_PROVIDER !== "auto")) {
    const check = await verifyAiConnection(initial);
    return { ...initial, aiProbeOk: check.ok, aiProbeReason: check.reason };
  }

  for (const name of AUTO_PROBE_TARGETS) {
    const preset = PROVIDER_PRESETS[name];
    if (!preset) continue;
    const candidate = {
      ...initial,
      baseUrl: preset.baseUrl,
      analysisModel: preset.analysisModel,
      transcribeModel: preset.transcribeModel,
      useResponsesApi: preset.useResponsesApi,
      provider: name,
      transcriptionEnabled: Boolean(initial.apiKey && preset.transcribeModel)
    };
    const check = await verifyAiConnection(candidate);
    if (check.ok) return { ...candidate, aiProbeOk: true };
  }

  const fallbackCheck = await verifyAiConnection(initial);
  return { ...initial, aiProbeOk: fallbackCheck.ok, aiProbeReason: fallbackCheck.reason };
}
