// Простой Vercel handler без сложных эмуляций
export default async function handler(req, res) {
  try {
    // Устанавливаем переменные окружения
    process.env.DB_BACKEND = "firebase";
    process.env.NODE_ENV = "production";

    // Динамический импорт server
    const { server } = await import("../server.js");

    // Простое перенаправление запроса
    server.emit("request", req, res);
  } catch (error) {
    console.error("Vercel handler error:", error);

    // Детальный вывод ошибки
    res.status(500).json({
      error: error.message,
      stack: error.stack,
      env: {
        hasFirebaseCredentials: !!process.env.FIREBASE_SERVICE_ACCOUNT,
        dbBackend: process.env.DB_BACKEND
      }
    });
  }
}
