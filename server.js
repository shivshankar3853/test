require("dotenv").config();

const express = require("express");

const http = require("http");

const path = require("path");

const { Server } = require("socket.io");

// ================= SERVICES =================

const {
  loadToken,
  isTokenExpired
} = require("./tokenManager");

const {
  handleWebhook
} = require("./webhookController");

const {
  login,
  callback
} = require("./authController");

const {
  getPositions
} = require("./positionService");

const {
  getTradeLog
} = require("./orderService");

const {
  ensureLocalFile
} = require("./instrumentStore");

const connectDB = require("./db");

const Trade = require("./models/Trade");
const Tick = require("./models/Tick");
const {
  fetchBrokerOrders,
  fetchBrokerPositions,
  reconcileBrokerOrder
} = require("./reconciliationService");

const {
  startTrading,
  stopTrading,
  isTradingEnabled
} = require("./control");

const {
  getProfile
} = require("./profileService");

const {
  recoverPositions
} = require("./recoveryService");

const {
  connectWS
} = require("./wsService");

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

// ================= INIT FUNCTION =================

async function init() {

  try {

    console.log(
      "⬇️ Preparing system..."
    );

    // =================================
    // DATABASE
    // =================================

    await connectDB();

    console.log(
      "✅ MongoDB Connected"
    );

    // =================================
    // TOKEN
    // =================================

    loadToken();

    console.log(
      "🔑 Token Loaded"
    );

    // =================================
    // INSTRUMENT FILE
    // =================================

    await ensureLocalFile();

    console.log(
      "📁 Instruments Ready"
    );

    // =================================
    // WEBSOCKET CONNECT
    // =================================

    connectWS();

    console.log(
      "📡 WebSocket Started"
    );

    // =================================
    // POSITION RECOVERY
    // =================================

    setTimeout(async () => {

      await recoverPositions();

    }, 3000);

    console.log(
      "♻️ Recovery Scheduled"
    );

    console.log(
      "✅ System initialized successfully"
    );

  } catch (err) {

    console.error(
      "❌ Initialization failed:",
      err
    );

    process.exit(1);
  }
}

// =================================
// START INIT
// =================================

init();

// ================= ROUTES =================

// =================================
// AUTH
// =================================

app.get("/login", login);

app.get("/callback", callback);

// =================================
// WEBHOOK
// =================================

app.post("/webhook", async (req, res) => {

  try {

    const data = req.body;

    const symbol =
      data.symbol || data.TS;

    // =================================
    // FAST DUPLICATE BLOCK
    // =================================

    if (isRecent(symbol)) {

      console.log(
        "⚠️ Blocked fast duplicate:",
        symbol
      );

      return res.send(
        "Blocked (fast duplicate)"
      );
    }

    // =================================
    // BROKER DUPLICATE CHECK
    // =================================

    const duplicate =
      await isDuplicateTrade(symbol);

    if (duplicate) {

      return res.send(
        "Blocked (already running)"
      );
    }

    // =================================
    // PROCESS WEBHOOK
    // =================================

    await handleWebhook(req, res);

  } catch (err) {

    console.error(
      "Webhook error:",
      err
    );

    res.status(500).send("Error");
  }
});

app.post("/test-signal", async (req, res) => {
  try {
    await handleWebhook(req, res);
  } catch (err) {
    console.error("Test signal error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/tick-dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "tick-dashboard.html"));
});

// =================================
// HOME
// =================================

app.get("/", (req, res) => {

  res.send(
    "Algo Server Running 🚀"
  );
});

// =================================
// STATUS
// =================================

app.get("/status", (req, res) => {

  res.json({

    server: "running",

    tokenExpired:
      isTokenExpired(),

    time: new Date()
  });
});

// =================================
// POSITIONS
// =================================

app.get("/positions", async (req, res) => {

  const positions =
    await getPositions();

  res.json(positions);
});

// =================================
// TRADES
// =================================

app.get("/trades", async (req, res) => {

  try {

    const trades =
      await getTradeLog();

    res.json(trades);

  } catch (err) {

    console.error(err);

    res.status(500)
      .send("Error fetching trades");
  }
});

app.get("/ticks", async (req, res) => {
  try {
    const ticks = await Tick.find()
      .sort({ timestamp: -1 })
      .limit(200);

    res.json(ticks);
  } catch (err) {
    console.error("Tick fetch error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/reconcile", async (req, res) => {
  try {
    const { orderId, instrument, side } = req.body || {};

    if (orderId) {
      const result = await reconcileBrokerOrder(orderId, instrument, side);
      return res.json(result);
    }

    const openTrades = await Trade.find({ status: "OPEN" }).sort({ time: -1 });
    const results = await Promise.all(
      openTrades.map(async (trade) => ({
        tradeId: String(trade._id),
        orderId: trade.orderId,
        symbol: trade.symbol,
        instrument: trade.instrument,
        side: trade.side,
        ...(await reconcileBrokerOrder(trade.orderId, trade.instrument, trade.side)),
      }))
    );

    res.json({
      ok: true,
      total: openTrades.length,
      results,
    });
  } catch (err) {
    console.error("Reconciliation error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =================================
// PNL
// =================================

app.get("/pnl", async (req, res) => {

  try {

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const trades =
      await Trade.find({

        time: { $gte: today },

        status: "CLOSED"
      });

    const closedPnL =
      trades.reduce(

        (sum, t) =>
          sum + (t.pnl || 0),

        0
      );

    const positions =
      await fetchBrokerPositions();

    const brokerPnL =
      positions.reduce(

        (sum, p) =>
          sum + Number(p.pnl || 0),

        0
      );

    res.json({

      totalTrades:
        trades.length,

      closedPnL,

      brokerPnL,

      totalPnL:
        brokerPnL || closedPnL
    });

  } catch (err) {

    console.error("PnL error:", err.message);

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =================================
// START TRADING
// =================================

app.get("/start", (req, res) => {

  startTrading();

  res.send(
    "✅ Trading Started"
  );
});

// =================================
// STOP TRADING
// =================================

app.get("/stop", (req, res) => {

  stopTrading();

  res.send(
    "⛔ Trading Stopped"
  );
});

// =================================
// CONTROL
// =================================

app.get("/control", (req, res) => {

  res.json({

    trading:
      isTradingEnabled()
  });
});

// =================================
// PROFILE
// =================================

app.get("/profile", async (req, res) => {

  const profile =
    await getProfile();

  if (!profile) {

    return res.json({
      loggedIn: false
    });
  }

  res.json({

    loggedIn: true,

    name:
      profile.user_name,

    clientId:
      profile.user_id
  });
});

// ==============================
// DUPLICATE TRADE PROTECTION
// ==============================

const recentTrades =
  new Map();

// =================================
// FAST CACHE
// =================================

function isRecent(symbol) {

  const now = Date.now();

  if (

    recentTrades.has(symbol)

    &&

    now -
    recentTrades.get(symbol)

    < 5000

  ) {

    return true;
  }

  recentTrades.set(symbol, now);

  return false;
}

// =================================
// BROKER DUPLICATE CHECK
// =================================

async function isDuplicateTrade(symbol) {

  try {

    const positions =
      await fetchBrokerPositions();

    const orders =
      await fetchBrokerOrders();

    // =================================
    // CHECK DUPLICATES
    // =================================

    const positionExists =
      positions.some((p) =>

        String(p.tradingsymbol || "")
          .toUpperCase() === String(symbol || "")
          .toUpperCase()

        &&

        Number(p.quantity) !== 0
      );

    const orderExists =
      orders.some((o) =>

        String(o.tradingsymbol || "")
          .toUpperCase() === String(symbol || "")
          .toUpperCase()

        &&

        [
          "open",
          "trigger pending",
          "pending"
        ].includes(
          String(o.status)
            .toLowerCase()
        )
      );

    if (
      positionExists ||
      orderExists
    ) {

      console.log(
        `🚫 Duplicate found for ${symbol}`
      );

      return true;
    }

    return false;

  } catch (err) {

    console.error(
      "❌ Duplicate check error:",
      err.message
    );

    return false;
  }
}

// =================================
// SOCKET
// =================================

io.on("connection", (socket) => {

  console.log(
    "🟢 Dashboard connected:",
    socket.id
  );
});

// =================================
// START SERVER
// =================================

server.listen(3000, () => {

  console.log(
    "🚀 Server running on port 3000"
  );
});
