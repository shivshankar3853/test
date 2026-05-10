require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// ================= SERVICES =================
const { loadToken, isTokenExpired } = require("./tokenManager");
const { handleWebhook } = require("./webhookController");
const { login, callback } = require("./authController");

const { getPositions } = require("./positionService");
const { getTradeLog } = require("./orderService");

const { ensureLocalFile } = require("./instrumentStore");

const connectDB = require("./db");
const Trade = require("./models/Trade");

const { startTrading, stopTrading, isTradingEnabled } = require("./control");
const { getProfile } = require("./profileService");

// ================= APP INIT =================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

global.io = io;

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(express.static("public"));

// ================= INIT FUNCTION (IMPORTANT FIX) =================
async function init() {
  try {
    console.log("⬇️ Preparing system...");

    await connectDB();
    loadToken();

    await ensureLocalFile(); // ✅ FIXED: properly awaited here

    console.log("✅ System initialized successfully");
  } catch (err) {
    console.error("❌ Initialization failed:", err);
    process.exit(1);
  }
}

init();

// ================= ROUTES =================

// Auth
app.get("/login", login);
app.get("/callback", callback);

// Webhook
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    const symbol = data.symbol || data.TS; // adjust based on your payload

    // ⚡ Fast duplicate block
    if (isRecent(symbol)) {
      console.log("⚠️ Blocked fast duplicate:", symbol);
      return res.send("Blocked (fast duplicate)");
    }

    // 🚫 Broker-level duplicate block
    const duplicate = await isDuplicateTrade(symbol);

    if (duplicate) {
      return res.send("Blocked (already running position/order)");
    }

    // ✅ PASS to original webhook
    await handleWebhook(req, res);

  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("Error");
  }
});

// Home
app.get("/", (req, res) => {
  res.send("Algo Server Running 🚀");
});

// Status
app.get("/status", (req, res) => {
  res.json({
    server: "running",
    tokenExpired: isTokenExpired(),
    time: new Date()
  });
});

// Positions
app.get("/positions", async (req, res) => {
  const positions = await getPositions();
  res.json(positions);
});

// Trades
app.get("/trades", async (req, res) => {
  try {
    const trades = await getTradeLog();
    res.json(trades);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching trades");
  }
});

// PnL
app.get("/pnl", async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const trades = await Trade.find({
    time: { $gte: today },
    status: "CLOSED"
  });

  const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  res.json({
    totalTrades: trades.length,
    totalPnL
  });
});

// Start trading
app.get("/start", (req, res) => {
  startTrading();
  res.send("✅ Trading Started");
});

// Stop trading
app.get("/stop", (req, res) => {
  stopTrading();
  res.send("⛔ Trading Stopped");
});

// Control
app.get("/control", (req, res) => {
  res.json({ trading: isTradingEnabled() });
});

// Profile
app.get("/profile", async (req, res) => {
  const profile = await getProfile();

  if (!profile) {
    return res.json({ loggedIn: false });
  }

  res.json({
    loggedIn: true,
    name: profile.user_name,
    clientId: profile.user_id
  });
});

// ================= DUPLICATE TRADE PROTECTION =================
const { getAccessToken } = require("./tokenManager");

// 🔁 Recent cache (fast duplicate protection)
const recentTrades = new Map();

function isRecent(symbol) {
  const now = Date.now();

  if (recentTrades.has(symbol) && now - recentTrades.get(symbol) < 5000) {
    return true;
  }

  recentTrades.set(symbol, now);
  return false;
}

// 🚫 Broker duplicate check
async function isDuplicateTrade(symbol) {
  try {
    const accessToken = getAccessToken();

    // 🔹 Positions
    const posRes = await fetch("https://api.upstox.com/v2/portfolio/short-term-positions", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const positions = (await posRes.json()).data || [];

    // 🔹 Orders
    const ordRes = await fetch("https://api.upstox.com/v2/order/retrieve-all", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const orders = (await ordRes.json()).data || [];

    const positionExists = positions.some(p =>
      p.trading_symbol === symbol && p.quantity !== 0
    );

    const orderExists = orders.some(o =>
      o.trading_symbol === symbol &&
      ["open", "trigger pending", "pending"].includes(o.status.toLowerCase())
    );

    if (positionExists || orderExists) {
      console.log(`🚫 Duplicate found for ${symbol}`);
      return true;
    }

    return false;

  } catch (err) {
    console.error("❌ Duplicate check error:", err);
    return false;
  }
}

// Socket
io.on("connection", (socket) => {
  console.log("🟢 Dashboard connected:", socket.id);
});

// ================= START SERVER =================
server.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});