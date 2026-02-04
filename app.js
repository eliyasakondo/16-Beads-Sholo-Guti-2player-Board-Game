const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const turnText = document.getElementById("turnText");
const resetBtn = document.getElementById("resetBtn");
const undoBtn = document.getElementById("undoBtn");
const darkToggle = document.getElementById("darkToggle");
const contrastToggle = document.getElementById("contrastToggle");
const shadowToggle = document.getElementById("shadowToggle");
const forcedToggle = document.getElementById("forcedToggle");
const soundToggle = document.getElementById("soundToggle");
const lowPowerToggle = document.getElementById("lowPowerToggle");
const largeUiToggle = document.getElementById("largeUiToggle");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const onlineStatus = document.getElementById("onlineStatus");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomInput = document.getElementById("roomInput");
const roomCode = document.getElementById("roomCode");
const colorStatus = document.getElementById("colorStatus");
const lobby = document.getElementById("lobby");
const gameContainer = document.getElementById("gameContainer");
const mainContent = document.getElementById("mainContent");
const lobbyCreateBtn = document.getElementById("lobbyCreateBtn");
const lobbyJoinBtn = document.getElementById("lobbyJoinBtn");
const hostName = document.getElementById("hostName");
const joinName = document.getElementById("joinName");
const lobbyRoomCode = document.getElementById("lobbyRoomCode");
const gameStatus = document.getElementById("gameStatus");
const turnOverlay = document.getElementById("turnOverlay");
const turnOverlayDesktop = document.getElementById("turnOverlayDesktop");
const mobileControlsBtn = document.getElementById("mobileControlsBtn");

let spacingX = 60;
let spacingY = 60;
let paddingX = 60;
let paddingY = 60;
let offsetX = 0;
let offsetY = 0;
let pieceRadius = 16;

const COLORS = {
  red: "#e53935",
  blue: "#1e5bd7",
  line: "#5d2f12",
  highlight: "#ffd166",
  shadow: "rgba(0,0,0,0.25)",
};

let nodes = [];
let edges = new Map();
let pieces = new Map();
let currentPlayer = "red";
let selectedId = null;
let legalMoves = [];
let showShadows = true;
let renderQueued = false;
let forcedCapture = false;
let soundEnabled = true;
let lowPower = false;
let largeUi = false;
let stateStack = [];
let socket = null;
let currentRoom = null;
let assignedColor = null;
let playerName = "";
let opponentName = "";
let lastTurn = null;
let gameStarted = false;
let awaitingState = false;

const STORAGE_KEY = "sholo-guti-state";

function setOnlineStatus(text) {
  if (onlineStatus) onlineStatus.textContent = `Status: ${text}`;
}

function ensureSocket() {
  if (socket) return;
  socket = io();

  socket.on("connect", () => setOnlineStatus("connected"));
  socket.on("disconnect", () => setOnlineStatus("disconnected"));
  socket.on("room-created", ({ room }) => {
    currentRoom = room;
    if (roomCode) roomCode.textContent = `Room: ${room}`;
    if (lobbyRoomCode) lobbyRoomCode.textContent = `Room: ${room}`;
    setOnlineStatus("room created");
    if (gameStatus) gameStatus.textContent = "Waiting for second player...";
    assignedColor = null;
    if (colorStatus) colorStatus.textContent = "Color will be assigned automatically.";
    if (lobby) lobby.hidden = true;
    if (mainContent) mainContent.hidden = false;
    document.body.classList.remove("in-lobby");
    gameStarted = true;
    awaitingState = false;
    resizeCanvas();
    resetGame();
  });
  socket.on("room-joined", ({ room, color }) => {
    currentRoom = room;
    assignedColor = color;
    if (roomCode) roomCode.textContent = `Room: ${room}`;
    setOnlineStatus("room joined");
    if (gameStatus) gameStatus.textContent = "Connected";
    if (colorStatus) colorStatus.textContent = color ? `You are ${color}` : "Choose your color";
    if (lobby) lobby.hidden = true;
    if (mainContent) mainContent.hidden = false;
    document.body.classList.remove("in-lobby");
    gameStarted = true;
    awaitingState = true;
    if (gameStatus) gameStatus.textContent = "Syncing board...";
    resizeCanvas();
    requestDraw();
  });
  socket.on("peer-joined", ({ name }) => {
    if (name) opponentName = name;
    setOnlineStatus("peer joined");
    updateTurn();
  });
  socket.on("room-error", (msg) => setOnlineStatus(msg));
  socket.on("state", (state) => {
    awaitingState = false;
    if (gameStatus) gameStatus.textContent = "Connected";
    restoreState(state);
  });
  socket.on("color-assigned", ({ color }) => {
    assignedColor = color;
    if (colorStatus) colorStatus.textContent = `You are ${color}`;
    updateTurn();
  });
  socket.on("start-turn", ({ turn }) => {
    if (turn === "red" || turn === "blue") {
      currentPlayer = turn;
      updateTurn();
      requestDraw();
    }
  });
  socket.on("names", ({ hostName: h, guestName: g }) => {
    if (playerName === h) opponentName = g || "";
    else if (playerName === g) opponentName = h || "";
    updateTurn();
  });
}

function sendState() {
  if (!socket || !currentRoom) return;
  socket.emit("state", { room: currentRoom, state: snapshotState() });
}

function addEdge(a, b) {
  if (!edges.has(a)) edges.set(a, new Set());
  if (!edges.has(b)) edges.set(b, new Set());
  edges.get(a).add(b);
  edges.get(b).add(a);
}

function removeEdge(a, b) {
  if (!a || !b) return;
  edges.get(a)?.delete(b);
  edges.get(b)?.delete(a);
}

function isSuppressedEdge(a, b) {
  const key = `${a}|${b}`;
  const keyRev = `${b}|${a}`;
  return (
    key === "0,0|1,-1" || keyRev === "0,0|1,-1" ||
    key === "1,-1|2,-2" || keyRev === "1,-1|2,-2" ||
    key === "4,0|3,-1" || keyRev === "4,0|3,-1" ||
    key === "3,-1|2,-2" || keyRev === "3,-1|2,-2" ||
    key === "1,0|2,-1" || keyRev === "1,0|2,-1" ||
    key === "2,-1|4,-2" || keyRev === "2,-1|4,-2" ||
    key === "3,0|2,-1" || keyRev === "3,0|2,-1" ||
    key === "2,-1|0,-2" || keyRev === "2,-1|0,-2" ||
    key === "0,4|1,5" || keyRev === "0,4|1,5" ||
    key === "1,5|2,6" || keyRev === "1,5|2,6" ||
    key === "4,4|3,5" || keyRev === "4,4|3,5" ||
    key === "3,5|2,6" || keyRev === "3,5|2,6" ||
    key === "1,4|2,5" || keyRev === "1,4|2,5" ||
    key === "2,5|3,6" || keyRev === "2,5|3,6" ||
    key === "3,4|2,5" || keyRev === "3,4|2,5" ||
    key === "2,5|1,6" || keyRev === "2,5|1,6"
  );
}

function buildBoard() {
  nodes = [];
  edges = new Map();

  const addNode = (x, y) => {
    const id = `${x},${y}`;
    nodes.push({ id, x, y });
    return id;
  };

  // Main 5x5 grid
  for (let y = 0; y <= 4; y += 1) {
    for (let x = 0; x <= 4; x += 1) {
      addNode(x, y);
    }
  }

  // Top triangle (3-3 points)
  [-2].forEach((y) => {
    [0, 2, 4].forEach((x) => addNode(x, y));
  });
  [-1].forEach((y) => {
    [1, 2, 3].forEach((x) => addNode(x, y));
  });

  // Bottom triangle (3-3 points)
  [5].forEach((y) => {
    [1, 2, 3].forEach((x) => addNode(x, y));
  });
  [6].forEach((y) => {
    [0, 2, 4].forEach((x) => addNode(x, y));
  });

  const nodeByCoord = (x, y) => nodes.find((n) => n.x === x && n.y === y)?.id;

  // Grid edges (horizontal, vertical)
  for (let y = 0; y <= 4; y += 1) {
    for (let x = 0; x <= 4; x += 1) {
      const id = nodeByCoord(x, y);
      const right = nodeByCoord(x + 1, y);
      const down = nodeByCoord(x, y + 1);

      if (right) addEdge(id, right);
      if (down) addEdge(id, down);
    }
  }

  // Grid main diagonals (X)
  addEdge(nodeByCoord(0, 0), nodeByCoord(1, 1));
  addEdge(nodeByCoord(1, 1), nodeByCoord(2, 2));
  addEdge(nodeByCoord(2, 2), nodeByCoord(3, 3));
  addEdge(nodeByCoord(3, 3), nodeByCoord(4, 4));

  addEdge(nodeByCoord(4, 0), nodeByCoord(3, 1));
  addEdge(nodeByCoord(3, 1), nodeByCoord(2, 2));
  addEdge(nodeByCoord(2, 2), nodeByCoord(1, 3));
  addEdge(nodeByCoord(1, 3), nodeByCoord(0, 4));

  // Remove specific diagonals (top)
  removeEdge(nodeByCoord(0, 0), nodeByCoord(1, -1));
  removeEdge(nodeByCoord(1, -1), nodeByCoord(2, -2));
  removeEdge(nodeByCoord(4, 0), nodeByCoord(3, -1));
  removeEdge(nodeByCoord(3, -1), nodeByCoord(2, -2));

  // Remove specific diagonals (bottom)
  removeEdge(nodeByCoord(0, 4), nodeByCoord(1, 5));
  removeEdge(nodeByCoord(1, 5), nodeByCoord(2, 6));
  removeEdge(nodeByCoord(4, 4), nodeByCoord(3, 5));
  removeEdge(nodeByCoord(3, 5), nodeByCoord(2, 6));

  // Custom diagonal lines
  addEdge(nodeByCoord(0, 2), nodeByCoord(1, 3));
  addEdge(nodeByCoord(1, 3), nodeByCoord(2, 4));
  addEdge(nodeByCoord(2, 4), nodeByCoord(3, 5));
  addEdge(nodeByCoord(3, 5), nodeByCoord(4, 6));

  addEdge(nodeByCoord(4, 2), nodeByCoord(3, 3));
  addEdge(nodeByCoord(3, 3), nodeByCoord(2, 4));
  addEdge(nodeByCoord(2, 4), nodeByCoord(1, 5));
  addEdge(nodeByCoord(1, 5), nodeByCoord(0, 6));

  addEdge(nodeByCoord(0, 2), nodeByCoord(1, 1));
  addEdge(nodeByCoord(1, 1), nodeByCoord(2, 0));
  addEdge(nodeByCoord(2, 0), nodeByCoord(3, -1));
  addEdge(nodeByCoord(3, -1), nodeByCoord(4, -2));

  addEdge(nodeByCoord(4, 2), nodeByCoord(3, 1));
  addEdge(nodeByCoord(3, 1), nodeByCoord(2, 0));
  addEdge(nodeByCoord(2, 0), nodeByCoord(1, -1));
  addEdge(nodeByCoord(1, -1), nodeByCoord(0, -2));

  // Straight diagonals to top points
  addEdge(nodeByCoord(4, 2), nodeByCoord(0, -2));
  addEdge(nodeByCoord(0, 2), nodeByCoord(4, -2));

  // Top triangle edges (custom for shifted columns)
  addEdge(nodeByCoord(0, -2), nodeByCoord(2, -2));
  addEdge(nodeByCoord(2, -2), nodeByCoord(4, -2));
  addEdge(nodeByCoord(1, -1), nodeByCoord(2, -1));
  addEdge(nodeByCoord(2, -1), nodeByCoord(3, -1));

  addEdge(nodeByCoord(0, -2), nodeByCoord(1, -1));
  addEdge(nodeByCoord(2, -2), nodeByCoord(1, -1));
  addEdge(nodeByCoord(2, -2), nodeByCoord(2, -1));
  addEdge(nodeByCoord(2, -2), nodeByCoord(3, -1));
  addEdge(nodeByCoord(4, -2), nodeByCoord(3, -1));

  // Connect top triangle to main grid
  for (let x = 1; x <= 3; x += 1) {
    addEdge(nodeByCoord(x, -1), nodeByCoord(x, 0));
    if (nodeByCoord(x - 1, 0)) addEdge(nodeByCoord(x, -1), nodeByCoord(x - 1, 0));
    if (nodeByCoord(x + 1, 0)) addEdge(nodeByCoord(x, -1), nodeByCoord(x + 1, 0));
  }

  // Remove specific verticals from top row
  removeEdge(nodeByCoord(1, -1), nodeByCoord(1, 0));
  removeEdge(nodeByCoord(3, -1), nodeByCoord(3, 0));

  // Bottom triangle edges (custom for shifted columns)
  addEdge(nodeByCoord(0, 6), nodeByCoord(2, 6));
  addEdge(nodeByCoord(2, 6), nodeByCoord(4, 6));
  addEdge(nodeByCoord(1, 5), nodeByCoord(2, 5));
  addEdge(nodeByCoord(2, 5), nodeByCoord(3, 5));

  addEdge(nodeByCoord(0, 6), nodeByCoord(1, 5));
  addEdge(nodeByCoord(2, 6), nodeByCoord(1, 5));
  addEdge(nodeByCoord(2, 6), nodeByCoord(2, 5));
  addEdge(nodeByCoord(2, 6), nodeByCoord(3, 5));
  addEdge(nodeByCoord(4, 6), nodeByCoord(3, 5));

  // Connect bottom triangle to main grid
  for (let x = 1; x <= 3; x += 1) {
    addEdge(nodeByCoord(x, 5), nodeByCoord(x, 4));
    if (nodeByCoord(x - 1, 4)) addEdge(nodeByCoord(x, 5), nodeByCoord(x - 1, 4));
    if (nodeByCoord(x + 1, 4)) addEdge(nodeByCoord(x, 5), nodeByCoord(x + 1, 4));
  }

  // Remove specific verticals from bottom row
  removeEdge(nodeByCoord(1, 5), nodeByCoord(1, 4));
  removeEdge(nodeByCoord(3, 5), nodeByCoord(3, 4));

}

function setupPieces() {
  pieces = new Map();
  const redCoords = [
    [0, -2], [2, -2], [4, -2],
    [1, -1], [2, -1], [3, -1],
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
    [0, 1], [1, 1], [2, 1], [3, 1], [4, 1],
  ];

  const blueCoords = [
    [0, 6], [2, 6], [4, 6],
    [1, 5], [2, 5], [3, 5],
    [0, 4], [1, 4], [2, 4], [3, 4], [4, 4],
    [0, 3], [1, 3], [2, 3], [3, 3], [4, 3],
  ];

  redCoords.forEach(([x, y]) => {
    const id = nodes.find((n) => n.x === x && n.y === y)?.id;
    if (id) pieces.set(id, "red");
  });

  blueCoords.forEach(([x, y]) => {
    const id = nodes.find((n) => n.x === x && n.y === y)?.id;
    if (id) pieces.set(id, "blue");
  });
}

function getPixel(node) {
  return {
    x: offsetX + node.x * spacingX,
    y: offsetY + node.y * spacingY,
  };
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sizeFactor = largeUi ? 1.2 : 1;
  const selectedRadius = pieceRadius * sizeFactor + 3;
  const highlightRadius = Math.max(10, Math.min(spacingX, spacingY) * 0.2);

  // Draw edges
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = lowPower ? 2 : 4;
  edges.forEach((neighbors, id) => {
    const node = nodes.find((n) => n.id === id);
    const p1 = getPixel(node);
    neighbors.forEach((nId) => {
      if (id > nId) return; // avoid double
      if (isSuppressedEdge(id, nId)) return;
      const n2 = nodes.find((n) => n.id === nId);
      const p2 = getPixel(n2);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });
  });

  // Draw nodes
  nodes.forEach((node) => {
    const p = getPixel(node);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  if (!lowPower) {
    // Draw coordinate labels
    ctx.fillStyle = "rgba(20,20,20,0.75)";
    ctx.font = `${Math.max(10, pieceRadius * 0.6)}px Segoe UI`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    nodes.forEach((node) => {
      const p = getPixel(node);
      ctx.fillText(`${node.x},${node.y}`, p.x, p.y - pieceRadius - 8);
    });
  }

  // Highlight legal moves
  legalMoves.forEach((move) => {
    const node = nodes.find((n) => n.id === move.to);
    const p = getPixel(node);
    ctx.fillStyle = COLORS.highlight;
    ctx.beginPath();
    ctx.arc(p.x, p.y, highlightRadius, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw pieces
  nodes.forEach((node) => {
    const owner = pieces.get(node.id);
    if (!owner) return;
    const p = getPixel(node);
    const isSelected = node.id === selectedId;

    ctx.fillStyle = owner === "red" ? COLORS.red : COLORS.blue;
    if (showShadows) {
      ctx.shadowColor = COLORS.shadow;
      ctx.shadowBlur = 6;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, isSelected ? selectedRadius : pieceRadius * sizeFactor, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (isSelected) {
      ctx.strokeStyle = "#ffe08a";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, selectedRadius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function requestDraw() {
  if (renderQueued) return;
  renderQueued = true;
  window.requestAnimationFrame(() => {
    renderQueued = false;
    draw();
  });
}

function resizeCanvas() {
  const parent = canvas.parentElement;
  const sizeW = Math.min(parent.clientWidth, 720);
  const isMobile = window.innerWidth <= 700;
  const viewportH = window.visualViewport?.height || window.innerHeight;
  const minH = sizeW * (isMobile ? 1.55 : 1);
  const maxH = isMobile ? viewportH * 0.95 : sizeW;
  const sizeH = isMobile ? Math.min(Math.max(minH, viewportH * 0.8), maxH) : sizeW;
  canvas.width = sizeW;
  canvas.height = sizeH;

  const minX = Math.min(...nodes.map((n) => n.x));
  const maxX = Math.max(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxY = Math.max(...nodes.map((n) => n.y));

  const boardWidth = maxX - minX;
  const boardHeight = maxY - minY;
  const computeLayout = (padX, padY) => {
    const usableW = sizeW - padX * 2;
    const usableH = sizeH - padY * 2;

    if (isMobile) {
      spacingX = usableW / boardWidth;
      spacingY = usableH / boardHeight;
    } else {
      const uniformSpacing = Math.min(usableW / boardWidth, usableH / boardHeight);
      spacingX = uniformSpacing;
      spacingY = uniformSpacing;
    }

    const boardPixelWidth = boardWidth * spacingX;
    const boardPixelHeight = boardHeight * spacingY;

    offsetX = (sizeW - boardPixelWidth) / 2 - minX * spacingX;
    offsetY = (sizeH - boardPixelHeight) / 2 - minY * spacingY;

    pieceRadius = Math.max(10, Math.min(spacingX, spacingY) * 0.22);
  };

  paddingX = Math.max(10, sizeW * (isMobile ? 0.02 : 0.06));
  paddingY = Math.max(10, sizeH * (isMobile ? 0.02 : 0.06));
  computeLayout(paddingX, paddingY);

  const safePadX = Math.max(paddingX, pieceRadius + 10);
  const safePadY = Math.max(paddingY, pieceRadius + 10);
  if (safePadX !== paddingX || safePadY !== paddingY) {
    paddingX = safePadX;
    paddingY = safePadY;
    computeLayout(paddingX, paddingY);
  }
  requestDraw();
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getNodeAt(x, y) {
  let found = null;
  const hitRadius = Math.max(14, pieceRadius * (largeUi ? 1.2 : 1) + 4);
  nodes.forEach((node) => {
    const p = getPixel(node);
    if (distance({ x, y }, p) <= hitRadius) {
      found = node;
    }
  });
  return found;
}

function getLegalMoves(fromId) {
  const owner = pieces.get(fromId);
  if (!owner) return [];

  const fromNode = nodes.find((n) => n.id === fromId);
  const moves = [];

  edges.get(fromId)?.forEach((toId) => {
    if (!pieces.has(toId)) {
      moves.push({ to: toId, capture: null });
    } else {
      const midOwner = pieces.get(toId);
      if (midOwner && midOwner !== owner) {
        const midNode = nodes.find((n) => n.id === toId);
        const jumpX = midNode.x + (midNode.x - fromNode.x);
        const jumpY = midNode.y + (midNode.y - fromNode.y);
        const landingId = nodes.find((n) => n.x === jumpX && n.y === jumpY)?.id;

        if (landingId && !pieces.has(landingId) && edges.get(toId)?.has(landingId)) {
          moves.push({ to: landingId, capture: toId });
        }
      }
    }
  });

  return moves;
}

function getCaptureMoves(fromId) {
  return getLegalMoves(fromId).filter((m) => m.capture);
}

function playerHasCapture(player) {
  for (const node of nodes) {
    if (pieces.get(node.id) !== player) continue;
    if (getCaptureMoves(node.id).length > 0) return true;
  }
  return false;
}

function playSound(type) {
  if (!soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = type === "capture" ? 520 : 360;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
    osc.onended = () => audioCtx.close();
  } catch (err) {
    // ignore audio errors
  }
}

function snapshotState() {
  return {
    pieces: Array.from(pieces.entries()),
    currentPlayer,
  };
}

function restoreState(state) {
  pieces = new Map(state.pieces || []);
  currentPlayer = state.currentPlayer || "red";
  stateStack = [];
  updateTurn();
  requestDraw();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotState()));
  } catch (err) {
    // ignore storage errors
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    restoreState(state);
    return true;
  } catch (err) {
    return false;
  }
}

function handleClick(evt) {
  const rect = canvas.getBoundingClientRect();
  const x = evt.clientX - rect.left;
  const y = evt.clientY - rect.top;
  const node = getNodeAt(x, y);

  if (!node) return;

  if (assignedColor && assignedColor !== currentPlayer) {
    return;
  }

  const owner = pieces.get(node.id);
  if (owner === currentPlayer) {
    if (forcedCapture && playerHasCapture(currentPlayer)) {
      const captures = getCaptureMoves(node.id);
      if (captures.length === 0) return;
      selectedId = node.id;
      legalMoves = captures;
      requestDraw();
      return;
    }
    selectedId = node.id;
    legalMoves = getLegalMoves(selectedId);
    requestDraw();
    return;
  }

  if (selectedId) {
    const move = legalMoves.find((m) => m.to === node.id);
    if (move) {
      const fromId = selectedId;
      stateStack.push(snapshotState());
      pieces.set(node.id, currentPlayer);
      pieces.delete(selectedId);
      if (move.capture) {
        pieces.delete(move.capture);
      }
      if (navigator.vibrate) navigator.vibrate(20);
      if (move.capture) {
        const nextCaptures = getCaptureMoves(node.id);
        if (nextCaptures.length > 0) {
          selectedId = node.id;
          legalMoves = nextCaptures;
          playSound("capture");
          saveState();
          sendState();
          requestDraw();
          return;
        }
      }

      selectedId = null;
      legalMoves = [];
      playSound(move.capture ? "capture" : "move");
      currentPlayer = currentPlayer === "red" ? "blue" : "red";
      updateTurn();
      saveState();
      sendState();
      requestDraw();
    }
  }
}

function updateTurn() {
  const who = currentPlayer === "red" ? "Red" : "Blue";
  const name = assignedColor === currentPlayer ? playerName : opponentName;
  turnText.textContent = name ? `Turn: ${who} (${name})` : `Turn: ${who}`;
  turnText.style.borderLeft = `6px solid ${currentPlayer === "red" ? COLORS.red : COLORS.blue}`;

  const isMine = assignedColor && assignedColor === currentPlayer;
  const overlayText = isMine ? "Your turn" : "Opponent's turn";
  if (turnOverlay) {
    turnOverlay.textContent = name ? `${overlayText} (${name || who})` : overlayText;
    turnOverlay.style.border = `2px solid ${currentPlayer === "red" ? COLORS.red : COLORS.blue}`;
  }
  if (turnOverlayDesktop) {
    turnOverlayDesktop.textContent = name ? `${overlayText} (${name || who})` : overlayText;
    turnOverlayDesktop.style.border = `2px solid ${currentPlayer === "red" ? COLORS.red : COLORS.blue}`;
  }

  if (lastTurn !== currentPlayer && assignedColor === currentPlayer && navigator.vibrate) {
    navigator.vibrate(30);
  }
  lastTurn = currentPlayer;
}

function resetGame() {
  selectedId = null;
  legalMoves = [];
  currentPlayer = "red";
  buildBoard();
  setupPieces();
  stateStack = [];
  updateTurn();
  resizeCanvas();
  saveState();
  sendState();
}

canvas.addEventListener("click", handleClick);
resetBtn.addEventListener("click", resetGame);
if (undoBtn) {
  undoBtn.addEventListener("click", () => {
    if (stateStack.length === 0) return;
    const prevState = stateStack.pop();
    restoreState(prevState);
    saveState();
  });
}
window.addEventListener("resize", resizeCanvas);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", resizeCanvas);
  window.visualViewport.addEventListener("scroll", resizeCanvas);
}

if (shadowToggle) {
  showShadows = shadowToggle.checked;
  shadowToggle.addEventListener("change", () => {
    showShadows = shadowToggle.checked && !lowPower;
    requestDraw();
  });
}

if (darkToggle) {
  darkToggle.addEventListener("change", () => {
    document.body.classList.toggle("dark", darkToggle.checked);
  });
}

if (contrastToggle) {
  contrastToggle.addEventListener("change", () => {
    document.body.classList.toggle("high-contrast", contrastToggle.checked);
    requestDraw();
  });
}

if (forcedToggle) {
  forcedCapture = forcedToggle.checked;
  forcedToggle.addEventListener("change", () => {
    forcedCapture = forcedToggle.checked;
  });
}

if (soundToggle) {
  soundEnabled = soundToggle.checked;
  soundToggle.addEventListener("change", () => {
    soundEnabled = soundToggle.checked;
  });
}

if (lowPowerToggle) {
  lowPower = lowPowerToggle.checked;
  lowPowerToggle.addEventListener("change", () => {
    lowPower = lowPowerToggle.checked;
    showShadows = shadowToggle?.checked && !lowPower;
    requestDraw();
  });
}

if (largeUiToggle) {
  largeUi = largeUiToggle.checked;
  largeUiToggle.addEventListener("change", () => {
    largeUi = largeUiToggle.checked;
    requestDraw();
  });
}

if (mobileControlsBtn) {
  mobileControlsBtn.addEventListener("click", () => {
    document.body.classList.toggle("show-controls");
  });
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });
}

if (lobbyCreateBtn) {
  lobbyCreateBtn.addEventListener("click", () => {
    playerName = hostName?.value.trim() || "Player 1";
    ensureSocket();
    socket.emit("create-room", { name: playerName });
  });
}

if (lobbyJoinBtn) {
  lobbyJoinBtn.addEventListener("click", () => {
    const room = roomInput?.value.trim().toUpperCase();
    if (!room) return;
    playerName = joinName?.value.trim() || "Player 2";
    ensureSocket();
    socket.emit("join-room", { room, name: playerName });
  });
}


buildBoard();
document.body.classList.add("in-lobby");
if (winnerModal) winnerModal.hidden = true;
if (!loadState()) {
  resetGame();
}
resizeCanvas();
