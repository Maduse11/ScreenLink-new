import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { randomInt } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.CLIENT_ORIGIN || "*";

app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: allowedOrigin, methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e6
});

const sessions = new Map();
const CODE_TTL = 5 * 60 * 1000;
const ACTIVE_TTL = 60 * 60 * 1000;

function makeCode() {
  let code;
  do {
    code = String(randomInt(0, 1000000)).padStart(6, "0");
  } while (sessions.has(code));
  return code;
}

function cleanup() {
  const now = Date.now();
  for (const [code, session] of sessions) {
    const limit = session.pairedAt ? ACTIVE_TTL : CODE_TTL;
    const start = session.pairedAt || session.createdAt;
    if (now - start > limit) {
      io.to(code).emit("session-ended", { reason: "expired" });
      sessions.delete(code);
    }
  }
}
setInterval(cleanup, 30_000).unref();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ScreenLink signaling", activeSessions: sessions.size });
});

io.on("connection", (socket) => {
  socket.on("create-session", (ack) => {
    const code = makeCode();
    sessions.set(code, {
      senderId: socket.id,
      receiverId: null,
      createdAt: Date.now(),
      pairedAt: null
    });
    socket.join(code);
    ack?.({ ok: true, code, expiresInSeconds: CODE_TTL / 1000 });
  });

  socket.on("join-session", ({ code } = {}, ack) => {
    const cleanCode = String(code || "").replace(/\D/g, "").slice(0, 6);
    const session = sessions.get(cleanCode);
    if (!session || Date.now() - session.createdAt > CODE_TTL && !session.pairedAt) {
      ack?.({ ok: false, error: "Código inválido ou expirado." });
      return;
    }
    if (session.receiverId && session.receiverId !== socket.id) {
      ack?.({ ok: false, error: "Esta sessão já possui um dispositivo conectado." });
      return;
    }
    if (session.senderId === socket.id) {
      ack?.({ ok: false, error: "Use outro dispositivo para entrar nesta sessão." });
      return;
    }
    session.receiverId = socket.id;
    session.pairedAt = Date.now();
    socket.join(cleanCode);
    io.to(session.senderId).emit("peer-joined");
    ack?.({ ok: true });
  });

  socket.on("signal", ({ code, data } = {}) => {
    const session = sessions.get(String(code || ""));
    if (!session || ![session.senderId, session.receiverId].includes(socket.id)) return;
    const target = socket.id === session.senderId ? session.receiverId : session.senderId;
    if (target) io.to(target).emit("signal", data);
  });

  socket.on("end-session", ({ code } = {}) => {
    const session = sessions.get(String(code || ""));
    if (!session || ![session.senderId, session.receiverId].includes(socket.id)) return;
    io.to(code).emit("session-ended", { reason: "user" });
    sessions.delete(code);
  });

  socket.on("disconnect", () => {
    for (const [code, session] of sessions) {
      if (session.senderId === socket.id || session.receiverId === socket.id) {
        io.to(code).emit("session-ended", { reason: "disconnect" });
        sessions.delete(code);
      }
    }
  });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "../dist");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`ScreenLink server rodando na porta ${PORT}`));