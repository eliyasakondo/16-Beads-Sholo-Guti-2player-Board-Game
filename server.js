const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();
const disconnectTimers = new Map(); // Store disconnect timers
const DISCONNECT_GRACE_PERIOD = 60000; // 60 seconds

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
      guestColor: null,
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
    
    // Cancel any pending disconnect timer for this room
    if (disconnectTimers.has(room)) {
      clearTimeout(disconnectTimers.get(room));
      disconnectTimers.delete(room);
    }
    
    data.guest = socket.id;
    data.guestName = payload?.name || "Player 2";
    socket.join(room);
    socket.emit("room-joined", { room, color: null });
    socket.to(room).emit("peer-joined");
    socket.to(room).emit("room-joined", { room, color: null });
    const rand = Math.random() < 0.5 ? "red" : "blue";
    const other = rand === "red" ? "blue" : "red";
    data.hostColor = rand;
    data.guestColor = other;
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

  socket.on("rejoin-room", (payload) => {
    const room = payload?.room;
    const name = payload?.name;
    const data = rooms.get(room);
    
    if (!data) {
      socket.emit("rejoin-failed", "Room not found or expired");
      return;
    }
    
    // Cancel any pending disconnect timer
    if (disconnectTimers.has(room)) {
      clearTimeout(disconnectTimers.get(room));
      disconnectTimers.delete(room);
    }
    
    // Determine if this is the host or guest
    const isHost = data.hostName === name;
    const isGuest = data.guestName === name;
    
    if (!isHost && !isGuest) {
      socket.emit("rejoin-failed", "You were not in this room");
      return;
    }
    
    // Update socket ID
    if (isHost) {
      data.host = socket.id;
    } else {
      data.guest = socket.id;
    }
    
    socket.join(room);
    
    // Determine color (based on stored colors if available)
    let color = null;
    if (data.hostColor && data.guestColor) {
      color = isHost ? data.hostColor : data.guestColor;
    }
    
    socket.emit("rejoin-success", { 
      room, 
      color,
      names: { hostName: data.hostName, guestName: data.guestName }
    });
    
    // Send current state
    if (data.state) {
      socket.emit("state", data.state);
    }
    
    // Notify the other player
    socket.to(room).emit("peer-joined", { name });
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

  socket.on("rematch-request", ({ room, name }) => {
    const data = rooms.get(room);
    if (!data) return;
    const requesterName = name || (socket.id === data.host ? data.hostName : data.guestName) || "Opponent";
    socket.to(room).emit("rematch-request", { name: requesterName });
  });

  socket.on("rematch-response", ({ room, approved }) => {
    const data = rooms.get(room);
    if (!data) return;
    if (approved) {
      const firstTurn = Math.random() < 0.5 ? "red" : "blue";
      io.to(room).emit("rematch-approved", { turn: firstTurn });
    } else {
      socket.to(room).emit("rematch-rejected");
    }
  });

  socket.on("new-game-request", ({ room, name }) => {
    const data = rooms.get(room);
    if (!data) return;
    const requesterName = name || (socket.id === data.host ? data.hostName : data.guestName) || "Opponent";
    socket.to(room).emit("new-game-request", { name: requesterName });
  });

  socket.on("new-game-response", ({ room, approved }) => {
    const data = rooms.get(room);
    if (!data) return;
    if (approved) {
      const firstTurn = Math.random() < 0.5 ? "red" : "blue";
      io.to(room).emit("new-game-approved", { turn: firstTurn });
    } else {
      socket.to(room).emit("new-game-rejected");
    }
  });

  socket.on("disconnect", () => {
    for (const [room, data] of rooms.entries()) {
      if (data.host === socket.id || data.guest === socket.id) {
        // Don't delete immediately, give grace period for reconnection
        if (!disconnectTimers.has(room)) {
          const timer = setTimeout(() => {
            rooms.delete(room);
            disconnectTimers.delete(room);
            // Notify remaining player if any
            io.to(room).emit("room-error", "Player disconnected");
          }, DISCONNECT_GRACE_PERIOD);
          disconnectTimers.set(room, timer);
        }
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
