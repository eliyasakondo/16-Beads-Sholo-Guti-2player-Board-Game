const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

const staticRoot = path.join(__dirname);
app.use(express.static(staticRoot));
app.get("/", (req, res) => {
  res.sendFile(path.join(staticRoot, "index.html"));
});

io.on("connection", (socket) => {
  socket.on("create-room", (payload) => {
    const room = generateRoomCode();
    rooms.set(room, {
      host: socket.id,
      guest: null,
      state: null,
      hostColor: null,
      hostName: payload?.name || "Player 1",
      guestName: null,
      colors: null,
    });
    socket.join(room);
    socket.emit("room-created", { room });
  });

  socket.on("join-room", (payload) => {
    const room = payload?.room;
    const data = rooms.get(room);
    if (!data) {
      socket.emit("room-error", "Room not found");
      return;
    }
    if (data.guest && data.guest !== socket.id) {
      socket.emit("room-error", "Room full");
      return;
    }
    data.guest = socket.id;
    data.guestName = payload?.name || "Player 2";
    socket.join(room);
    socket.emit("room-joined", { room, color: null });
    socket.to(room).emit("peer-joined");
    socket.to(room).emit("room-joined", { room, color: null });
    const rand = Math.random() < 0.5 ? "red" : "blue";
    const other = rand === "red" ? "blue" : "red";
    io.to(data.host).emit("color-assigned", { color: rand });
    io.to(data.guest).emit("color-assigned", { color: other });
    const firstTurn = Math.random() < 0.5 ? "red" : "blue";
    io.to(room).emit("start-turn", { turn: firstTurn });
    io.to(room).emit("names", { hostName: data.hostName, guestName: data.guestName });
    if (data.state) {
      socket.emit("state", data.state);
    }
  });

  socket.on("state", ({ room, state }) => {
    const data = rooms.get(room);
    if (!data) return;
    data.state = state;
    socket.to(room).emit("state", state);
  });

  socket.on("undo-request", ({ room, state, name }) => {
    const data = rooms.get(room);
    if (!data) return;
    const requesterName = name || (socket.id === data.host ? data.hostName : data.guestName) || "Opponent";
    socket.to(room).emit("undo-request", { name: requesterName, state });
  });

  socket.on("undo-response", ({ room, approved, state }) => {
    const data = rooms.get(room);
    if (!data) return;
    if (approved) {
      io.to(room).emit("undo-approved", { state });
    } else {
      socket.to(room).emit("undo-rejected");
    }
  });

  socket.on("disconnect", () => {
    for (const [room, data] of rooms.entries()) {
      if (data.host === socket.id || data.guest === socket.id) {
        rooms.delete(room);
        socket.to(room).emit("room-error", "Host left");
      }
    }
  });
});

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});
