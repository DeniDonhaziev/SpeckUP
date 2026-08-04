import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "./database.js";

function createDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orator-db-"));
  const database = new Database(path.join(directory, "database.json"), {
    adminEmail: "admin@test.local",
    adminPassword: "Admin123!",
    seedDemoData: false
  });
  return { database, directory };
}

test("регистрирует ученика и создаёт постоянную сессию", () => {
  const { database, directory } = createDatabase();
  try {
    const user = database.register({ name: "Анна Тестова", email: "anna@test.local", password: "Password123" });
    assert.equal(user.role, "student");
    const authenticated = database.authenticate("anna@test.local", "Password123");
    assert.equal(authenticated.id, user.id);
    const token = database.createSession(user.id);
    assert.equal(database.getUserBySession(token)?.email, "anna@test.local");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("считает очки рейтинга из тренировок и проверенного задания", () => {
  const { database, directory } = createDatabase();
  try {
    const user = database.register({ name: "Иван Тестов", email: "ivan@test.local", password: "Password123" });
    database.saveResult(user.id, { topic: "Тема", score: 80, wpm: 125, fillers: 2, structure: 84 });
    const admin = database.authenticate("admin@test.local", "Admin123!");
    const homework = database.createHomework(admin.id, { title: "Проверка речи", description: "Расскажите историю с ясным выводом.", points: 40 });
    const submission = database.submitHomework(user.id, homework.id, "Это достаточно длинный тестовый ответ ученика для проверки.");
    database.reviewSubmission(submission.id, { score: 75, feedback: "Хорошая структура." });
    const row = database.getLeaderboard().find((item) => item.id === user.id);
    assert.equal(row.points, 46); // 80 / 5 + 75% от 40
    assert.equal(row.homeworkCompleted, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("пустой рейтинг не содержит вымышленных учеников", () => {
  const { database, directory } = createDatabase();
  try {
    assert.deepEqual(database.getLeaderboard(), []);
    const user = database.register({ name: "Реальный Ученик", email: "real@test.local", password: "Password123" });
    const rows = database.getLeaderboard();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, user.id);
    assert.equal(rows[0].name, "Реальный Ученик");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
