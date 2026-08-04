import crypto from "node:crypto";

export const SESSION_DAYS = 30;

export function normalizeHomework(payload) {
  const title = String(payload.title || "").trim().slice(0, 160);
  const description = String(payload.description || "").trim().slice(0, 5000);
  if (title.length < 3) throw httpError(400, "Введите название задания.");
  if (description.length < 10) throw httpError(400, "Добавьте описание задания.");
  const dueDate = String(payload.dueDate || "").slice(0, 10);
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw httpError(400, "Некорректная дата сдачи.");
  return {
    title,
    description,
    category: String(payload.category || "everyday").slice(0, 50),
    durationSeconds: clampInt(payload.durationSeconds || 60, 30, 300),
    points: clampInt(payload.points || 30, 1, 500),
    dueDate: dueDate || null,
    active: payload.active !== false
  };
}

export function calculateUserStats(userId, data) {
  const results = data.results.filter((item) => item.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const reviewed = data.submissions.filter((item) => item.userId === userId && item.status === "reviewed");
  const averageScore = results.length ? Math.round(results.reduce((sum, item) => sum + item.score, 0) / results.length) : 0;
  const first = results.slice(0, Math.min(3, results.length));
  const last = results.slice(-Math.min(3, results.length));
  const firstAverage = first.length ? first.reduce((sum, item) => sum + item.score, 0) / first.length : 0;
  const lastAverage = last.length ? last.reduce((sum, item) => sum + item.score, 0) / last.length : 0;
  const progress = results.length > 1 ? Math.round(lastAverage - firstAverage) : 0;
  const trainingPoints = results.reduce((sum, item) => sum + Math.max(2, Math.round(item.score / 5)), 0);
  const homeworkPoints = reviewed.reduce((sum, submission) => {
    const homework = data.homeworks.find((item) => item.id === submission.homeworkId);
    return sum + Math.round((homework?.points || 0) * (submission.score || 0) / 100);
  }, 0);
  const points = trainingPoints + homeworkPoints;
  return {
    points,
    level: Math.max(1, Math.floor(points / 100) + 1),
    averageScore,
    progress,
    trainings: results.length,
    homeworkCompleted: reviewed.length,
    streak: calculateStreak(results)
  };
}

export function calculateStreak(results) {
  const days = [...new Set(results.map((item) => item.createdAt.slice(0, 10)))].sort().reverse();
  if (!days.length) return 0;
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const firstDay = new Date(`${days[0]}T00:00:00`);
  const diff = Math.round((cursor - firstDay) / 86400000);
  if (diff > 1) return 0;
  cursor = firstDay;
  for (const day of days) {
    const current = new Date(`${day}T00:00:00`);
    if (Math.round((cursor - current) / 86400000) > (streak === 0 ? 0 : 1)) break;
    streak += 1;
    cursor = current;
  }
  return streak;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    blocked: Boolean(user.blocked),
    isDemo: Boolean(user.isDemo),
    createdAt: user.createdAt
  };
}

export function createUserRecord({ name, email, password, role = "student", isDemo = false }) {
  const { salt, hash } = hashPassword(password);
  return {
    id: crypto.randomUUID(),
    name: sanitizeName(name),
    email: normalizeEmail(email),
    passwordSalt: salt,
    passwordHash: hash,
    role,
    blocked: false,
    isDemo,
    createdAt: new Date().toISOString()
  };
}

export function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  try {
    const actual = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(expectedHash, "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 8) throw httpError(400, "Пароль должен содержать минимум 8 символов.");
  if (value.length > 200) throw httpError(400, "Пароль слишком длинный.");
}

export function sanitizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase().slice(0, 160);
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function clampInt(value, min, max) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? Math.round(number) : min));
}

export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
