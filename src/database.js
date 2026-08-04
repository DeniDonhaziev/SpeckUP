import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  SESSION_DAYS,
  calculateUserStats,
  clampInt,
  createUserRecord,
  httpError,
  isValidEmail,
  normalizeEmail,
  normalizeHomework,
  publicUser,
  safeEqual,
  sanitizeName,
  sha256,
  validatePassword,
  verifyPassword
} from "./databaseCore.js";

export { httpError } from "./databaseCore.js";

export class Database {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.options = options;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.data = this.#load();
    this.#seed();
  }

  #empty() {
    return {
      version: 2,
      users: [],
      sessions: [],
      results: [],
      homeworks: [],
      submissions: []
    };
  }

  #load() {
    if (!fs.existsSync(this.filePath)) return this.#empty();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return { ...this.#empty(), ...parsed };
    } catch (error) {
      const backup = `${this.filePath}.broken-${Date.now()}`;
      fs.copyFileSync(this.filePath, backup);
      console.warn(`Повреждённая база сохранена как ${backup}:`, error.message);
      return this.#empty();
    }
  }

  #save() {
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(temp, this.filePath);
  }

  #seed() {
    const adminEmail = normalizeEmail(this.options.adminEmail || "admin@minute.local");
    if (!this.data.users.some((user) => user.email === adminEmail)) {
      const user = createUserRecord({
        name: this.options.adminName || "Администратор",
        email: adminEmail,
        password: this.options.adminPassword || "Admin123!",
        role: "admin",
        isDemo: false
      });
      this.data.users.push(user);
    }

    const demoUserIds = new Set(this.data.users.filter((user) => user.isDemo).map((user) => user.id));
    if (demoUserIds.size) {
      this.data.users = this.data.users.filter((user) => !demoUserIds.has(user.id));
      this.data.results = this.data.results.filter((item) => !demoUserIds.has(item.userId));
      this.data.sessions = this.data.sessions.filter((item) => !demoUserIds.has(item.userId));
      this.data.submissions = this.data.submissions.filter((item) => !demoUserIds.has(item.userId));
    }

    if (!this.data.homeworks.length) {
      const admin = this.data.users.find((user) => user.role === "admin");
      this.data.homeworks.push({
        id: crypto.randomUUID(),
        title: "Убедительная самопрезентация",
        description: "Подготовьте минутное выступление: кто вы, чем можете быть полезны и какой результат хотите получить. Используйте структуру: тезис → доказательство → пример → призыв.",
        category: "work",
        durationSeconds: 60,
        points: 30,
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        active: true,
        createdBy: admin?.id || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    this.cleanupSessions();
    this.#save();
  }

  register({ name, email, password }) {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) throw httpError(400, "Введите корректный email.");
    if (this.data.users.some((user) => user.email === normalizedEmail)) throw httpError(409, "Пользователь с таким email уже зарегистрирован.");
    if (sanitizeName(name).length < 2) throw httpError(400, "Имя должно содержать минимум 2 символа.");
    validatePassword(password);
    const user = createUserRecord({ name, email: normalizedEmail, password, role: "student" });
    this.data.users.push(user);
    this.#save();
    return publicUser(user);
  }

  authenticate(email, password) {
    const user = this.data.users.find((item) => item.email === normalizeEmail(email));
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) throw httpError(401, "Неверный email или пароль.");
    if (user.blocked) throw httpError(403, "Аккаунт заблокирован администратором.");
    return publicUser(user);
  }

  createSession(userId) {
    this.cleanupSessions();
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256(token);
    this.data.sessions.push({
      id: crypto.randomUUID(),
      userId,
      tokenHash,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString()
    });
    this.#save();
    return token;
  }

  getUserBySession(token) {
    if (!token) return null;
    const tokenHash = sha256(token);
    const session = this.data.sessions.find((item) => safeEqual(item.tokenHash, tokenHash) && new Date(item.expiresAt).getTime() > Date.now());
    if (!session) return null;
    const user = this.data.users.find((item) => item.id === session.userId && !item.blocked);
    return user ? publicUser(user) : null;
  }

  deleteSession(token) {
    if (!token) return;
    const tokenHash = sha256(token);
    this.data.sessions = this.data.sessions.filter((item) => !safeEqual(item.tokenHash, tokenHash));
    this.#save();
  }

  cleanupSessions() {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((item) => new Date(item.expiresAt).getTime() > Date.now());
    if (before !== this.data.sessions.length && fs.existsSync(this.filePath)) this.#save();
  }

  saveResult(userId, result) {
    const entry = {
      id: crypto.randomUUID(),
      userId,
      topic: String(result.topic || "Свободная тема").slice(0, 500),
      category: String(result.category || "everyday").slice(0, 50),
      score: clampInt(result.score, 0, 100),
      wpm: clampInt(result.wpm, 0, 400),
      fillers: clampInt(result.fillers, 0, 999),
      structure: clampInt(result.structure, 0, 100),
      createdAt: new Date().toISOString()
    };
    this.data.results.push(entry);
    this.#save();
    return entry;
  }

  getDashboard(userId) {
    const results = this.data.results
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const submissions = this.data.submissions.filter((item) => item.userId === userId);
    const stats = calculateUserStats(userId, this.data);
    const activeHomeworks = this.getHomeworks(userId).filter((item) => item.active).slice(0, 4);
    return {
      stats,
      recentResults: results.slice(0, 6),
      activeHomeworks,
      completedHomeworks: submissions.filter((item) => ["submitted", "reviewed"].includes(item.status)).length
    };
  }

  getLeaderboard() {
    return this.data.users
      .filter((user) => user.role === "student" && !user.blocked && !user.isDemo)
      .map((user) => ({ user: publicUser(user), ...calculateUserStats(user.id, this.data) }))
      .sort((a, b) => b.points - a.points || b.averageScore - a.averageScore || a.user.name.localeCompare(b.user.name, "ru"))
      .map((item, index) => ({
        place: index + 1,
        id: item.user.id,
        name: item.user.name,
        isDemo: item.user.isDemo,
        points: item.points,
        level: item.level,
        averageScore: item.averageScore,
        progress: item.progress,
        trainings: item.trainings,
        homeworkCompleted: item.homeworkCompleted
      }));
  }

  getHomeworks(userId = null, includeInactive = false) {
    return this.data.homeworks
      .filter((item) => includeInactive || item.active)
      .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")))
      .map((item) => {
        const submission = userId ? this.data.submissions.find((entry) => entry.homeworkId === item.id && entry.userId === userId) : null;
        return { ...item, submission: submission ? { ...submission } : null };
      });
  }

  createHomework(adminId, payload) {
    const homework = normalizeHomework(payload);
    const now = new Date().toISOString();
    const entry = {
      id: crypto.randomUUID(),
      ...homework,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now
    };
    this.data.homeworks.push(entry);
    this.#save();
    return entry;
  }

  updateHomework(id, payload) {
    const index = this.data.homeworks.findIndex((item) => item.id === id);
    if (index === -1) throw httpError(404, "Задание не найдено.");
    const current = this.data.homeworks[index];
    this.data.homeworks[index] = { ...current, ...normalizeHomework({ ...current, ...payload }), updatedAt: new Date().toISOString() };
    this.#save();
    return this.data.homeworks[index];
  }

  deleteHomework(id) {
    const exists = this.data.homeworks.some((item) => item.id === id);
    if (!exists) throw httpError(404, "Задание не найдено.");
    this.data.homeworks = this.data.homeworks.filter((item) => item.id !== id);
    this.data.submissions = this.data.submissions.filter((item) => item.homeworkId !== id);
    this.#save();
  }

  submitHomework(userId, homeworkId, answer) {
    const homework = this.data.homeworks.find((item) => item.id === homeworkId && item.active);
    if (!homework) throw httpError(404, "Активное задание не найдено.");
    const text = String(answer || "").trim().slice(0, 12000);
    if (text.length < 20) throw httpError(400, "Ответ должен содержать минимум 20 символов.");
    const existing = this.data.submissions.find((item) => item.homeworkId === homeworkId && item.userId === userId);
    if (existing) {
      Object.assign(existing, { answer: text, status: "submitted", score: null, feedback: "", submittedAt: new Date().toISOString(), reviewedAt: null });
      this.#save();
      return { ...existing };
    }
    const entry = {
      id: crypto.randomUUID(),
      homeworkId,
      userId,
      answer: text,
      status: "submitted",
      score: null,
      feedback: "",
      submittedAt: new Date().toISOString(),
      reviewedAt: null
    };
    this.data.submissions.push(entry);
    this.#save();
    return entry;
  }

  getAdminOverview() {
    return {
      users: this.data.users.filter((item) => !item.isDemo).map((item) => ({ ...publicUser(item), stats: calculateUserStats(item.id, this.data) })),
      homeworks: this.getHomeworks(null, true),
      submissions: this.data.submissions
        .map((submission) => ({
          ...submission,
          student: publicUser(this.data.users.find((item) => item.id === submission.userId)),
          homework: this.data.homeworks.find((item) => item.id === submission.homeworkId) || null
        }))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
      totals: {
        students: this.data.users.filter((item) => item.role === "student" && !item.isDemo).length,
        trainings: this.data.results.filter((item) => !this.data.users.find((user) => user.id === item.userId)?.isDemo).length,
        activeHomeworks: this.data.homeworks.filter((item) => item.active).length,
        waitingReview: this.data.submissions.filter((item) => item.status === "submitted").length
      }
    };
  }

  updateUser(id, payload, actingAdminId) {
    const user = this.data.users.find((item) => item.id === id);
    if (!user) throw httpError(404, "Пользователь не найден.");
    if (id === actingAdminId && payload.blocked === true) throw httpError(400, "Нельзя заблокировать собственный аккаунт.");
    if (payload.blocked !== undefined) user.blocked = Boolean(payload.blocked);
    if (payload.role && ["student", "admin"].includes(payload.role)) user.role = payload.role;
    this.#save();
    return publicUser(user);
  }

  reviewSubmission(id, payload) {
    const submission = this.data.submissions.find((item) => item.id === id);
    if (!submission) throw httpError(404, "Ответ ученика не найден.");
    submission.score = clampInt(payload.score, 0, 100);
    submission.feedback = String(payload.feedback || "").trim().slice(0, 3000);
    submission.status = "reviewed";
    submission.reviewedAt = new Date().toISOString();
    this.#save();
    return { ...submission };
  }
}
