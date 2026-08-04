import crypto from "node:crypto";
import fs from "node:fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
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

const COLLECTIONS = {
  users: "users",
  sessions: "sessions",
  results: "results",
  homeworks: "homeworks",
  submissions: "submissions",
  meta: "meta"
};

export function getFirebaseCredentialsFromEnv() {
  const credentialsFile = process.env.FIREBASE_CREDENTIALS_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsFile && fs.existsSync(credentialsFile)) {
    return JSON.parse(fs.readFileSync(credentialsFile, "utf8"));
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT содержит некорректный JSON.");
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
  }

  return null;
}

function isCloudRuntime() {
  return Boolean(
    process.env.FUNCTION_TARGET
    || process.env.K_SERVICE
    || process.env.FIREBASE_CONFIG
    || process.env.GCLOUD_PROJECT
  );
}

function initFirebaseApp(credentials) {
  if (getApps().length) return getApps()[0];
  if (credentials) return initializeApp({ credential: cert(credentials) });
  if (isCloudRuntime()) return initializeApp();
  throw new Error("Firebase credentials are not configured.");
}

export class FirebaseDatabase {
  constructor(options = {}) {
    this.options = options;
    const credentials = getFirebaseCredentialsFromEnv();
    if (!credentials && !isCloudRuntime()) {
      throw new Error("Firebase credentials are not configured.");
    }
    initFirebaseApp(credentials);
    this.db = getFirestore();
    this.ready = this.#seed();
  }

  async #ensureReady() {
    await this.ready;
  }

  async #loadAll() {
    const [users, sessions, results, homeworks, submissions] = await Promise.all([
      this.#listCollection(COLLECTIONS.users),
      this.#listCollection(COLLECTIONS.sessions),
      this.#listCollection(COLLECTIONS.results),
      this.#listCollection(COLLECTIONS.homeworks),
      this.#listCollection(COLLECTIONS.submissions)
    ]);
    return { users, sessions, results, homeworks, submissions };
  }

  async #listCollection(name) {
    const snapshot = await this.db.collection(name).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async #getDoc(collection, id) {
    const snapshot = await this.db.collection(collection).doc(id).get();
    if (!snapshot.exists) return null;
    return { id: snapshot.id, ...snapshot.data() };
  }

  async #setDoc(collection, id, data) {
    await this.db.collection(collection).doc(id).set(data, { merge: true });
  }

  async #deleteDoc(collection, id) {
    await this.db.collection(collection).doc(id).delete();
  }

  async #seed() {
    const adminEmail = normalizeEmail(this.options.adminEmail || "admin@minute.local");
    const existing = await this.db.collection(COLLECTIONS.users).where("email", "==", adminEmail).limit(1).get();
    if (existing.empty) {
      const user = createUserRecord({
        name: this.options.adminName || "Администратор",
        email: adminEmail,
        password: this.options.adminPassword || "Admin123!",
        role: "admin",
        isDemo: false
      });
      await this.#setDoc(COLLECTIONS.users, user.id, user);
    }

    const demoUsers = await this.db.collection(COLLECTIONS.users).where("isDemo", "==", true).get();
    if (!demoUsers.empty) {
      const batch = this.db.batch();
      for (const doc of demoUsers.docs) batch.delete(doc.ref);
      await batch.commit();
    }

    const homeworks = await this.db.collection(COLLECTIONS.homeworks).limit(1).get();
    if (homeworks.empty) {
      const adminSnapshot = await this.db.collection(COLLECTIONS.users).where("role", "==", "admin").limit(1).get();
      const admin = adminSnapshot.empty ? null : { id: adminSnapshot.docs[0].id, ...adminSnapshot.docs[0].data() };
      const homework = {
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
      };
      await this.#setDoc(COLLECTIONS.homeworks, homework.id, homework);
    }

    await this.cleanupSessions();
  }

  async register({ name, email, password }) {
    await this.#ensureReady();
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) throw httpError(400, "Введите корректный email.");
    const existing = await this.db.collection(COLLECTIONS.users).where("email", "==", normalizedEmail).limit(1).get();
    if (!existing.empty) throw httpError(409, "Пользователь с таким email уже зарегистрирован.");
    if (sanitizeName(name).length < 2) throw httpError(400, "Имя должно содержать минимум 2 символа.");
    validatePassword(password);
    const user = createUserRecord({ name, email: normalizedEmail, password, role: "student" });
    await this.#setDoc(COLLECTIONS.users, user.id, user);
    return publicUser(user);
  }

  async authenticate(email, password) {
    await this.#ensureReady();
    const normalizedEmail = normalizeEmail(email);
    const snapshot = await this.db.collection(COLLECTIONS.users).where("email", "==", normalizedEmail).limit(1).get();
    const user = snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) throw httpError(401, "Неверный email или пароль.");
    if (user.blocked) throw httpError(403, "Аккаунт заблокирован администратором.");
    return publicUser(user);
  }

  async createSession(userId) {
    await this.#ensureReady();
    await this.cleanupSessions();
    const token = crypto.randomBytes(32).toString("hex");
    const session = {
      id: crypto.randomUUID(),
      userId,
      tokenHash: sha256(token),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString()
    };
    await this.#setDoc(COLLECTIONS.sessions, session.id, session);
    return token;
  }

  async getUserBySession(token) {
    await this.#ensureReady();
    if (!token) return null;
    const tokenHash = sha256(token);
    const now = new Date().toISOString();
    const snapshot = await this.db.collection(COLLECTIONS.sessions).where("tokenHash", "==", tokenHash).limit(5).get();
    const session = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .find((item) => safeEqual(item.tokenHash, tokenHash) && item.expiresAt > now);
    if (!session) return null;
    const user = await this.#getDoc(COLLECTIONS.users, session.userId);
    if (!user || user.blocked) return null;
    return publicUser(user);
  }

  async deleteSession(token) {
    await this.#ensureReady();
    if (!token) return;
    const tokenHash = sha256(token);
    const snapshot = await this.db.collection(COLLECTIONS.sessions).where("tokenHash", "==", tokenHash).get();
    const batch = this.db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    if (!snapshot.empty) await batch.commit();
  }

  async cleanupSessions() {
    await this.#ensureReady();
    const now = new Date().toISOString();
    const snapshot = await this.db.collection(COLLECTIONS.sessions).where("expiresAt", "<=", now).get();
    if (snapshot.empty) return;
    const batch = this.db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  async saveResult(userId, result) {
    await this.#ensureReady();
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
    await this.#setDoc(COLLECTIONS.results, entry.id, entry);
    return entry;
  }

  async getDashboard(userId) {
    await this.#ensureReady();
    const data = await this.#loadAll();
    const results = data.results
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const submissions = data.submissions.filter((item) => item.userId === userId);
    const stats = calculateUserStats(userId, data);
    const activeHomeworks = (await this.getHomeworks(userId)).filter((item) => item.active).slice(0, 4);
    return {
      stats,
      recentResults: results.slice(0, 6),
      activeHomeworks,
      completedHomeworks: submissions.filter((item) => ["submitted", "reviewed"].includes(item.status)).length
    };
  }

  async getLeaderboard() {
    await this.#ensureReady();
    const data = await this.#loadAll();
    return data.users
      .filter((user) => user.role === "student" && !user.blocked && !user.isDemo)
      .map((user) => ({ user: publicUser(user), ...calculateUserStats(user.id, data) }))
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

  async getHomeworks(userId = null, includeInactive = false) {
    await this.#ensureReady();
    const [homeworks, submissions] = await Promise.all([
      this.#listCollection(COLLECTIONS.homeworks),
      userId ? this.db.collection(COLLECTIONS.submissions).where("userId", "==", userId).get() : Promise.resolve(null)
    ]);
    const userSubmissions = submissions
      ? submissions.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      : [];
    return homeworks
      .filter((item) => includeInactive || item.active)
      .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")))
      .map((item) => {
        const submission = userId ? userSubmissions.find((entry) => entry.homeworkId === item.id) : null;
        return { ...item, submission: submission ? { ...submission } : null };
      });
  }

  async createHomework(adminId, payload) {
    await this.#ensureReady();
    const homework = normalizeHomework(payload);
    const now = new Date().toISOString();
    const entry = {
      id: crypto.randomUUID(),
      ...homework,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now
    };
    await this.#setDoc(COLLECTIONS.homeworks, entry.id, entry);
    return entry;
  }

  async updateHomework(id, payload) {
    await this.#ensureReady();
    const current = await this.#getDoc(COLLECTIONS.homeworks, id);
    if (!current) throw httpError(404, "Задание не найдено.");
    const updated = { ...current, ...normalizeHomework({ ...current, ...payload }), updatedAt: new Date().toISOString() };
    await this.#setDoc(COLLECTIONS.homeworks, id, updated);
    return updated;
  }

  async deleteHomework(id) {
    await this.#ensureReady();
    const current = await this.#getDoc(COLLECTIONS.homeworks, id);
    if (!current) throw httpError(404, "Задание не найдено.");
    await this.#deleteDoc(COLLECTIONS.homeworks, id);
    const submissions = await this.db.collection(COLLECTIONS.submissions).where("homeworkId", "==", id).get();
    const batch = this.db.batch();
    submissions.docs.forEach((doc) => batch.delete(doc.ref));
    if (!submissions.empty) await batch.commit();
  }

  async submitHomework(userId, homeworkId, answer) {
    await this.#ensureReady();
    const homework = await this.#getDoc(COLLECTIONS.homeworks, homeworkId);
    if (!homework || !homework.active) throw httpError(404, "Активное задание не найдено.");
    const text = String(answer || "").trim().slice(0, 12000);
    if (text.length < 20) throw httpError(400, "Ответ должен содержать минимум 20 символов.");
    const existingSnapshot = await this.db.collection(COLLECTIONS.submissions)
      .where("homeworkId", "==", homeworkId)
      .where("userId", "==", userId)
      .limit(1)
      .get();
    if (!existingSnapshot.empty) {
      const existing = { id: existingSnapshot.docs[0].id, ...existingSnapshot.docs[0].data() };
      const updated = {
        ...existing,
        answer: text,
        status: "submitted",
        score: null,
        feedback: "",
        submittedAt: new Date().toISOString(),
        reviewedAt: null
      };
      await this.#setDoc(COLLECTIONS.submissions, existing.id, updated);
      return { ...updated };
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
    await this.#setDoc(COLLECTIONS.submissions, entry.id, entry);
    return entry;
  }

  async getAdminOverview() {
    await this.#ensureReady();
    const data = await this.#loadAll();
    const usersById = new Map(data.users.map((user) => [user.id, user]));
    const homeworksById = new Map(data.homeworks.map((homework) => [homework.id, homework]));
    return {
      users: data.users.filter((item) => !item.isDemo).map((item) => ({ ...publicUser(item), stats: calculateUserStats(item.id, data) })),
      homeworks: await this.getHomeworks(null, true),
      submissions: data.submissions
        .map((submission) => ({
          ...submission,
          student: publicUser(usersById.get(submission.userId)),
          homework: homeworksById.get(submission.homeworkId) || null
        }))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
      totals: {
        students: data.users.filter((item) => item.role === "student" && !item.isDemo).length,
        trainings: data.results.filter((item) => !usersById.get(item.userId)?.isDemo).length,
        activeHomeworks: data.homeworks.filter((item) => item.active).length,
        waitingReview: data.submissions.filter((item) => item.status === "submitted").length
      }
    };
  }

  async updateUser(id, payload, actingAdminId) {
    await this.#ensureReady();
    const user = await this.#getDoc(COLLECTIONS.users, id);
    if (!user) throw httpError(404, "Пользователь не найден.");
    if (id === actingAdminId && payload.blocked === true) throw httpError(400, "Нельзя заблокировать собственный аккаунт.");
    if (payload.blocked !== undefined) user.blocked = Boolean(payload.blocked);
    if (payload.role && ["student", "admin"].includes(payload.role)) user.role = payload.role;
    await this.#setDoc(COLLECTIONS.users, id, user);
    return publicUser(user);
  }

  async reviewSubmission(id, payload) {
    await this.#ensureReady();
    const submission = await this.#getDoc(COLLECTIONS.submissions, id);
    if (!submission) throw httpError(404, "Ответ ученика не найден.");
    submission.score = clampInt(payload.score, 0, 100);
    submission.feedback = String(payload.feedback || "").trim().slice(0, 3000);
    submission.status = "reviewed";
    submission.reviewedAt = new Date().toISOString();
    await this.#setDoc(COLLECTIONS.submissions, id, submission);
    return { ...submission };
  }
}
