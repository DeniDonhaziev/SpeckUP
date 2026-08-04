import path from "node:path";
import { Database } from "./database.js";
import { FirebaseDatabase, getFirebaseCredentialsFromEnv } from "./firebaseDatabase.js";

function wrapSyncDatabase(database) {
  return {
    backend: "file",
    register: (payload) => Promise.resolve(database.register(payload)),
    authenticate: (email, password) => Promise.resolve(database.authenticate(email, password)),
    createSession: (userId) => Promise.resolve(database.createSession(userId)),
    getUserBySession: (token) => Promise.resolve(database.getUserBySession(token)),
    deleteSession: (token) => Promise.resolve(database.deleteSession(token)),
    cleanupSessions: () => Promise.resolve(database.cleanupSessions()),
    saveResult: (userId, result) => Promise.resolve(database.saveResult(userId, result)),
    getDashboard: (userId) => Promise.resolve(database.getDashboard(userId)),
    getLeaderboard: () => Promise.resolve(database.getLeaderboard()),
    getHomeworks: (userId, includeInactive) => Promise.resolve(database.getHomeworks(userId, includeInactive)),
    createHomework: (adminId, payload) => Promise.resolve(database.createHomework(adminId, payload)),
    updateHomework: (id, payload) => Promise.resolve(database.updateHomework(id, payload)),
    deleteHomework: (id) => Promise.resolve(database.deleteHomework(id)),
    submitHomework: (userId, homeworkId, answer) => Promise.resolve(database.submitHomework(userId, homeworkId, answer)),
    getAdminOverview: () => Promise.resolve(database.getAdminOverview()),
    updateUser: (id, payload, actingAdminId) => Promise.resolve(database.updateUser(id, payload, actingAdminId)),
    reviewSubmission: (id, payload) => Promise.resolve(database.reviewSubmission(id, payload))
  };
}

function resolveBackend() {
  const configured = String(process.env.DB_BACKEND || "auto").toLowerCase();
  if (configured === "file") return "file";
  if (configured === "firebase") return "firebase";
  if (process.env.FUNCTION_TARGET || process.env.K_SERVICE || process.env.FIREBASE_CONFIG) return "firebase";
  if (process.env.RENDER && getFirebaseCredentialsFromEnv()) return "firebase";
  return getFirebaseCredentialsFromEnv() ? "firebase" : "file";
}

export async function createDatabase({ dataDir, adminEmail, adminPassword, adminName } = {}) {
  const backend = resolveBackend();
  const options = { adminEmail, adminPassword, adminName };

  if (backend === "firebase") {
    const database = new FirebaseDatabase(options);
    await database.ready;
    return {
      backend: "firebase",
      register: (payload) => database.register(payload),
      authenticate: (email, password) => database.authenticate(email, password),
      createSession: (userId) => database.createSession(userId),
      getUserBySession: (token) => database.getUserBySession(token),
      deleteSession: (token) => database.deleteSession(token),
      cleanupSessions: () => database.cleanupSessions(),
      saveResult: (userId, result) => database.saveResult(userId, result),
      getDashboard: (userId) => database.getDashboard(userId),
      getLeaderboard: () => database.getLeaderboard(),
      getHomeworks: (userId, includeInactive) => database.getHomeworks(userId, includeInactive),
      createHomework: (adminId, payload) => database.createHomework(adminId, payload),
      updateHomework: (id, payload) => database.updateHomework(id, payload),
      deleteHomework: (id) => database.deleteHomework(id),
      submitHomework: (userId, homeworkId, answer) => database.submitHomework(userId, homeworkId, answer),
      getAdminOverview: () => database.getAdminOverview(),
      updateUser: (id, payload, actingAdminId) => database.updateUser(id, payload, actingAdminId),
      reviewSubmission: (id, payload) => database.reviewSubmission(id, payload)
    };
  }

  const filePath = path.join(dataDir, "database.json");
  return wrapSyncDatabase(new Database(filePath, options));
}
