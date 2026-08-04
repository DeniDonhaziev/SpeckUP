const FILLER_RULES = [
  { phrase: "собственно говоря", allowance: 0, kind: "phrase" },
  { phrase: "короче говоря", allowance: 0, kind: "phrase" },
  { phrase: "это самое", allowance: 0, kind: "hesitation" },
  { phrase: "так сказать", allowance: 0, kind: "phrase" },
  { phrase: "как его", allowance: 0, kind: "hesitation" },
  { phrase: "на самом деле", allowance: 1, kind: "context" },
  { phrase: "если честно", allowance: 1, kind: "context" },
  { phrase: "можно сказать", allowance: 1, kind: "context" },
  { phrase: "в принципе", allowance: 1, kind: "context" },
  { phrase: "в общем", allowance: 1, kind: "context" },
  { phrase: "в целом", allowance: 1, kind: "context" },
  { phrase: "как бы", allowance: 1, kind: "context" },
  { phrase: "собственно", allowance: 1, kind: "ambiguous" },
  { phrase: "короче", allowance: 1, kind: "ambiguous" },
  { phrase: "значит", allowance: 1, kind: "ambiguous" },
  { phrase: "типа", allowance: 1, kind: "ambiguous" },
  { phrase: "ну", allowance: 2, kind: "ambiguous" },
  { phrase: "вот", allowance: 2, kind: "ambiguous" },
  { phrase: "э-э", allowance: 0, kind: "hesitation" },
  { phrase: "эээ", allowance: 0, kind: "hesitation" },
  { phrase: "ээ", allowance: 0, kind: "hesitation" },
  { phrase: "эм", allowance: 0, kind: "hesitation" },
  { phrase: "ммм", allowance: 0, kind: "hesitation" },
  { phrase: "мм", allowance: 0, kind: "hesitation" },
  { phrase: "э", allowance: 0, kind: "hesitation" },
  { phrase: "м-м", allowance: 0, kind: "hesitation" }
].sort((a, b) => b.phrase.length - a.phrase.length);

const FILLER_PATTERNS = FILLER_RULES.map((rule) => rule.phrase);

const CONCLUSION_MARKERS = [
  "таким образом",
  "подводя итог",
  "в итоге",
  "поэтому",
  "следовательно",
  "мой вывод",
  "итак"
];

const ARGUMENT_MARKERS = [
  "потому что",
  "во-первых",
  "во-вторых",
  "например",
  "причина",
  "аргумент",
  "с одной стороны",
  "с другой стороны"
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWords(text) {
  return normalizeText(text).match(/[а-яa-z0-9]+/gi) ?? [];
}

function getSentences(text) {
  return String(text ?? "")
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function makePhrasePattern(phrase) {
  const pieces = phrase
    .split(/\s+/)
    .map((piece) => escapeRegExp(piece).replace(/\\-/g, "[-—–]?"));
  return new RegExp(`(^|[^а-яёa-z0-9])(${pieces.join("\\s+")})(?=$|[^а-яёa-z0-9])`, "giu");
}

function wordsBefore(text, start, count = 4) {
  return (text.slice(Math.max(0, start - 100), start).toLowerCase().match(/[а-яёa-z]+/giu) ?? []).slice(-count);
}

function wordsAfter(text, end, count = 4) {
  return (text.slice(end, Math.min(text.length, end + 100)).toLowerCase().match(/[а-яёa-z]+/giu) ?? []).slice(0, count);
}

function isSentenceStart(text, start) {
  const before = text.slice(0, start);
  const lastBoundary = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n"));
  return before.slice(lastBoundary + 1).trim().length === 0;
}

function hasPausePunctuation(text, start, end) {
  const left = text.slice(Math.max(0, start - 4), start);
  const right = text.slice(end, Math.min(text.length, end + 4));
  return /[,;:…—–-]\s*$/.test(left) || /^\s*[,;:…—–-]/.test(right);
}

function isSemanticUse(rule, text, start, end) {
  const before = wordsBefore(text, start);
  const after = wordsAfter(text, end);
  const previous = before.at(-1) || "";
  const next = after[0] || "";
  const nextTwo = after.slice(0, 2).join(" ");
  const around = normalizeText(text.slice(Math.max(0, start - 35), Math.min(text.length, end + 55)));

  if (rule.phrase === "значит") {
    return next === "что" || next === "ли" || ["это", "не", "что", "который", "которая", "которое"].includes(previous);
  }

  if (rule.phrase === "типа") {
    const adjectiveLike = /(ого|его|ого|ого|ого|ого|ого|ого|ого)$/u.test(previous);
    return adjectiveLike || ["нового", "этого", "такого", "данного", "другого", "определенного", "разного", "одного"].includes(previous);
  }

  if (rule.phrase === "вот") {
    return ["это", "этот", "эта", "эти", "здесь", "там", "почему", "что", "кто", "так", "такой", "такая", "такие"].includes(next);
  }

  if (rule.phrase === "ну") {
    return ["и", "что", "а", "тогда", "да", "нет", "ладно"].includes(next);
  }

  if (rule.phrase === "короче") {
    return next === "чем" || ["стал", "стала", "стало", "будет", "был", "была", "сделай", "сделать", "оказался", "оказалась", "получился"].includes(previous);
  }

  if (rule.phrase === "в общем") {
    return ["случае", "виде", "списке", "доступе", "порядке", "смысле", "объеме", "итоге"].includes(next);
  }

  if (rule.phrase === "в целом") {
    return ["мире", "классе", "проекте", "компании", "стране", "системе"].includes(next);
  }

  if (rule.phrase === "как бы") {
    return next === "ни" || nextTwo.endsWith(" ни") || around.includes("как бы то ни было") || /как бы\s+[а-яё]+\s+ни\b/u.test(around);
  }

  return false;
}

function findRuleCandidates(text, rule) {
  const candidates = [];
  const pattern = makePhrasePattern(rule.phrase);
  for (const match of text.matchAll(pattern)) {
    const prefixLength = match[1]?.length || 0;
    const matchedText = match[2];
    const start = (match.index || 0) + prefixLength;
    const end = start + matchedText.length;
    if (isSemanticUse(rule, text, start, end)) continue;
    candidates.push({
      phrase: rule.phrase,
      start,
      end,
      text: text.slice(start, end),
      signal: isSentenceStart(text, start) || hasPausePunctuation(text, start, end),
      reason: rule.kind === "hesitation" ? "звук заминки" : "лишняя речевая связка"
    });
  }
  return candidates;
}

function selectFillerCandidates(rule, candidates) {
  if (!candidates.length) return [];
  if (rule.kind === "hesitation" || rule.allowance === 0) return candidates;

  return candidates.filter((candidate, index) => {
    const previous = candidates[index - 1];
    const repeatedClosely = previous && candidate.start - previous.end < 18;
    const exceedsNaturalAllowance = index >= rule.allowance;
    const clearlyOverused = candidates.length >= rule.allowance + 2;
    return repeatedClosely || (exceedsNaturalAllowance && (candidate.signal || clearlyOverused));
  });
}

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

function countFillers(text) {
  const safeText = String(text ?? "");
  const selected = [];

  for (const rule of FILLER_RULES) {
    const candidates = findRuleCandidates(safeText, rule);
    for (const candidate of selectFillerCandidates(rule, candidates)) {
      if (!selected.some((existing) => overlaps(existing, candidate))) selected.push(candidate);
    }
  }

  selected.sort((a, b) => a.start - b.start);
  const grouped = new Map();
  for (const item of selected) grouped.set(item.phrase, (grouped.get(item.phrase) || 0) + 1);

  const details = [...grouped.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "ru"));

  return {
    total: selected.length,
    details,
    occurrences: selected.map((item) => ({
      phrase: item.phrase,
      start: item.start,
      end: item.end,
      text: item.text,
      reason: item.reason
    }))
  };
}

function countImmediateRepetitions(words) {
  const repetitions = [];
  for (let index = 1; index < words.length; index += 1) {
    if (words[index] === words[index - 1] && words[index].length > 2) repetitions.push(words[index]);
  }

  const grouped = Object.entries(
    repetitions.reduce((acc, word) => {
      acc[word] = (acc[word] ?? 0) + 1;
      return acc;
    }, {})
  )
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);

  return { total: repetitions.length, details: grouped };
}

function sentenceStats(sentences) {
  const lengths = sentences.map((sentence) => getWords(sentence).length);
  const longSentences = lengths.filter((length) => length > 24).length;
  const average = lengths.length ? Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length) : 0;
  return { average, longSentences, sentenceCount: sentences.length };
}

function rateFeedback(wpm) {
  if (!wpm) return "Темп пока невозможно определить.";
  if (wpm < 85) return "Темп медленный. Попробуйте формулировать мысль увереннее и уменьшить затяжные паузы.";
  if (wpm < 115) return "Спокойный темп. Он хорошо подходит для сложных объяснений.";
  if (wpm <= 155) return "Комфортный разговорный темп.";
  if (wpm <= 180) return "Темп немного быстрый. Делайте короткие паузы после главных мыслей.";
  return "Очень быстрый темп. Слушателю может быть трудно следить за аргументами.";
}

function buildRecommendations({ fillers, repetitions, wpm, sentences, structureScore, pauses }) {
  const recommendations = [];
  if (fillers.total > 2) recommendations.push("Заменяйте повторяющиеся слова-паразиты короткой молчаливой паузой.");
  if (repetitions.total > 0) recommendations.push("Перед началом предложения сформулируйте его мысленно, чтобы не повторять одно слово подряд.");
  if (wpm > 165) recommendations.push("После каждого аргумента делайте паузу примерно на одну секунду.");
  else if (wpm > 0 && wpm < 90) recommendations.push("Используйте заранее подготовленную схему: тезис, причина, пример, вывод.");
  if (sentences.longSentences > 0) recommendations.push("Разделяйте длинные предложения: одна фраза — одна основная мысль.");
  if (structureScore < 70) recommendations.push("Завершайте ответ отдельным выводом, который прямо отвечает на тему.");
  if ((pauses?.maxSeconds ?? 0) > 3) recommendations.push("Сократите самые длинные паузы: держите в уме следующий пункт плана.");
  return [...new Set(recommendations)].slice(0, 4);
}

export function analyzeLocally({ transcript, durationSeconds = 60, pauses = {} }) {
  const safeDuration = Math.max(1, Number(durationSeconds) || 60);
  const words = getWords(transcript);
  const sentencesList = getSentences(transcript);
  const fillers = countFillers(transcript);
  const repetitions = countImmediateRepetitions(words);
  const sentences = sentenceStats(sentencesList);
  const normalized = normalizeText(transcript);
  const wpm = Math.round((words.length / safeDuration) * 60);

  const hasArgument = ARGUMENT_MARKERS.some((marker) => normalized.includes(marker));
  const hasConclusion = CONCLUSION_MARKERS.some((marker) => normalized.includes(marker));
  const hasEnoughBody = words.length >= Math.max(35, safeDuration * 0.55);

  const structureScore = clamp(35 + (sentences.sentenceCount >= 3 ? 15 : 0) + (hasArgument ? 20 : 0) + (hasConclusion ? 20 : 0) + (hasEnoughBody ? 10 : 0));
  const fillerPenalty = Math.min(34, fillers.total * 5);
  const repetitionPenalty = Math.min(20, repetitions.total * 7);
  const longSentencePenalty = Math.min(20, sentences.longSentences * 6);
  const clarityScore = clamp(100 - fillerPenalty - repetitionPenalty - longSentencePenalty);
  const paceDistance = wpm < 85 ? 85 - wpm : wpm > 175 ? wpm - 175 : 0;
  const paceScore = clamp(100 - paceDistance * 1.35);
  const pauseScore = clamp(100 - Math.max(0, (Number(pauses.count) || 0) - 4) * 5 - Math.max(0, (Number(pauses.maxSeconds) || 0) - 2.5) * 9);
  const overallScore = clamp(clarityScore * 0.32 + structureScore * 0.32 + paceScore * 0.2 + pauseScore * 0.16);

  return {
    mode: "local-contextual",
    overallScore,
    wordCount: words.length,
    wpm,
    paceScore,
    paceFeedback: rateFeedback(wpm),
    clarityScore,
    structureScore,
    pauseScore,
    fillers,
    repetitions,
    sentences,
    pauses: {
      count: Number(pauses.count) || 0,
      maxSeconds: Number(pauses.maxSeconds) || 0,
      totalSeconds: Number(pauses.totalSeconds) || 0
    },
    recommendations: buildRecommendations({ fillers, repetitions, wpm, sentences, structureScore, pauses })
  };
}

export { FILLER_PATTERNS };
