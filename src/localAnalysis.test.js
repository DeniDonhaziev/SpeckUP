import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLocally } from "./localAnalysis.js";

test("не считает одиночное разговорное ну паразитом", () => {
  const result = analyzeLocally({
    transcript: "Ну, я считаю, что это полезно. Поэтому стоит попробовать.",
    durationSeconds: 30,
    pauses: { count: 1, maxSeconds: 1.2, totalSeconds: 1.2 }
  });

  assert.equal(result.fillers.total, 0);
  assert.ok(result.wpm > 0);
});

test("не путает смысловые слова со словами-паразитами", () => {
  const result = analyzeLocally({
    transcript: "Это значит, что устройство нового типа работает лучше. Вот почему я его выбрал.",
    durationSeconds: 30
  });

  assert.equal(result.fillers.total, 0);
});

test("находит повторяющиеся связки и звуки заминки", () => {
  const result = analyzeLocally({
    transcript: "Ну, ну, ну, я как бы не знаю, эм, что сказать.",
    durationSeconds: 30
  });

  assert.equal(result.fillers.details.find((item) => item.word === "ну")?.count, 2);
  assert.equal(result.fillers.details.find((item) => item.word === "эм")?.count, 1);
  assert.equal(result.fillers.occurrences.length, 3);
});

test("не выходит за диапазон оценок", () => {
  const result = analyzeLocally({
    transcript: "ну ну ну ну ну ну",
    durationSeconds: 60,
    pauses: { count: 20, maxSeconds: 10, totalSeconds: 40 }
  });

  for (const key of ["overallScore", "paceScore", "clarityScore", "structureScore", "pauseScore"]) {
    assert.ok(result[key] >= 0 && result[key] <= 100);
  }
});
