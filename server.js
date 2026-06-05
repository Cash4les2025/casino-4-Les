const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Middleware
app.use(cors());
app.use(express.json());

// Game State
let multiplier = 1;
let running = false;
let crashPoint = 0;
let gameStartTime = 0;
let gameId = 0;
let activePlayers = {}; // Track player bets

// Routes
app.get("/", (req, res) => {
  res.send("Casino-4-les backend running");
});

app.get("/status", (req, res) => {
  res.json({
    running,
    currentMultiplier: multiplier,
    crashPoint,
    gameId,
    activePlayersCount: Object.keys(activePlayers).length
  });
});

app.get("/stats", (req, res) => {
  res.json({
    totalPlayers: Object.keys(activePlayers).length,
    gameStatus: running ? "running" : "waiting",
    multiplier: parseFloat(multiplier.toFixed(2)),
    crashPoint
  });
});

// Generate random crash point between 1.1x and 10x
function generateCrashPoint() {
  return parseFloat((Math.random() * 8.9 + 1.1).toFixed(2));
}

// Start game loop
function startGame() {
  gameId++;
  multiplier = 1;
  running = true;
  crashPoint = generateCrashPoint();
  gameStartTime = Date.now();
  activePlayers = {}; // Reset players for new game

  console.log(`Game #${gameId} started - Crash point: ${crashPoint}x`);
  io.emit("gameStart", {
    gameId,
    crashPoint,
    startTime: gameStartTime
  });

  const interval = setInterval(() => {
    multiplier += 0.1;
    multiplier = parseFloat(multiplier.toFixed(2));

    io.emit("multiplier", {
      multiplier,
      gameId,
      elapsed: Date.now() - gameStartTime
    });

    // Check if game crashed
    if (multiplier >= crashPoint) {
      clearInterval(interval);
      running = false;

      console.log(`Game #${gameId} crashed at ${multiplier}x`);
      io.emit("crash", {
        multiplier,
        gameId,
        crashPoint,
        losers: Object.keys(activePlayers).filter(
          id => !activePlayers[id].cashedOut
        )
      });

      // Start next game after delay
      setTimeout(startGame, 3000);
    }
  }, 200);
}

// Socket.io Events
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);
  activePlayers[socket.id] = {
    cashedOut: false,
    betAmount: 0,
    multiplier: 0,
    won: 0
  };

  // Send current game state to new player
  socket.emit("currentGame", {
    running,
    multiplier,
    gameId,
    crashPoint: running ? crashPoint : 0
  });

  // Player places bet
  socket.on("placeBet", (data, callback) => {
    if (!running) {
      callback({ success: false, error: "Game not running" });
      return;
    }

    if (multiplier > 1.05) {
      callback({
        success: false,
        error: "Bets only allowed at game start"
      });
      return;
    }

    const { amount } = data;
    if (!amount || amount <= 0) {
      callback({ success: false, error: "Invalid bet amount" });
      return;
    }

    activePlayers[socket.id] = {
      betAmount: amount,
      cashedOut: false,
      multiplier: 0,
      won: 0
    };

    callback({ success: true, message: "Bet placed" });
    console.log(`Player ${socket.id} bet ${amount}`);
  });

  // Player cashes out
  socket.on("cashout", (callback) => {
    if (!running) {
      callback({
        success: false,
        error: "Game not running"
      });
      return;
    }

    const player = activePlayers[socket.id];
    if (!player) {
      callback({ success: false, error: "No active bet" });
      return;
    }

    if (player.cashedOut) {
      callback({
        success: false,
        error: "Already cashed out"
      });
      return;
    }

    const winnings = parseFloat((player.betAmount * multiplier).toFixed(2));

    player.cashedOut = true;
    player.multiplier = multiplier;
    player.won = winnings;

    const result = {
      success: true,
      message: "Cashed out successfully",
      multiplier,
      betAmount: player.betAmount,
      winnings,
      profit: parseFloat((winnings - player.betAmount).toFixed(2))
    };

    socket.emit("cashedOut", result);
    io.emit("playerCashedOut", {
      playerId: socket.id,
      multiplier,
      gameId
    });

    callback(result);
    console.log(`Player ${socket.id} cashed out at ${multiplier}x, won ${winnings}`);
  });

  // Player disconnects
  socket.on("disconnect", () => {
    delete activePlayers[socket.id];
    console.log(`Player disconnected: ${socket.id}`);
    io.emit("playerDisconnected", { playerId: socket.id });
  });

  // Handle errors
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// Start the game on server start
startGame();

// Server startup
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 Casino-4-les Backend Running`);
  console.log(`📍 Server running on port ${PORT}`);
  console.log(`🔗 Connect at http://localhost:${PORT}`);
  console.log(`⚡ WebSocket: ws://localhost:${PORT}\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
  });
});
