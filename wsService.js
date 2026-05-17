const WebSocket = require("ws");

const subscribedSymbols = new Set();

const { getAccessToken } = require("./tokenManager");

const {
  positions,
  removePosition
} = require("./positionCache");

// ⚠️ KEEP SAME
const { placeOrder } = require("./orderService");

let ws;

// ======================================
// CONNECT WS
// ======================================

function connectWS() {

  const token = getAccessToken();

  ws = new WebSocket(
    "wss://mlhsm.kotaksecurities.com"
  );

  // ======================================
  // WS OPEN
  // ======================================

  ws.on("open", () => {

    console.log("📡 WS Connected");

    ws.send(JSON.stringify({

      type: "subscribe",

      token: token
    }));

    // ======================================
    // RESUBSCRIBE ALL SYMBOLS
    // ======================================

    subscribedSymbols.forEach((symbol) => {

      ws.send(JSON.stringify({

        type: "subscribe",

        symbol: symbol
      }));

      console.log(
        "📡 Re-Subscribed:",
        symbol
      );
    });
  });

  // ======================================
  // WS MESSAGE
  // ======================================

  ws.on("message", async (data) => {

    try {

      const parsed = JSON.parse(data);

      // ======================================
      // 1. DASHBOARD FEED
      // ======================================

      if (global.io) {
        global.io.emit("tick", parsed);
      }

      // ======================================
      // 2. SAFE PARSING
      // ======================================

      const symbol = parsed.symbol;

      const ltp = Number(parsed.ltp);

      if (!symbol || !ltp) {
        return;
      }

      // ======================================
      // 3. POSITION CHECK
      // ======================================

      const pos = positions[symbol];

      if (!pos) {
        return;
      }

      // ======================================
      // 4. AVOID MULTIPLE EXITS
      // ======================================

      if (pos.isExiting) {
        return;
      }

      // ======================================
      // 5. TARGET CHECK
      // ======================================

      let hit = false;

      // BUY TARGET

      if (
        pos.side === "BUY" &&
        ltp >= pos.targetPrice
      ) {
        hit = true;
      }

      // SELL TARGET

      if (
        pos.side === "SELL" &&
        ltp <= pos.targetPrice
      ) {
        hit = true;
      }

      if (!hit) {
        return;
      }

      // ======================================
      // 6. LOCK EXIT
      // ======================================

      pos.isExiting = true;

      console.log("🎯 TARGET HIT:", {

        symbol,

        ltp,

        target: pos.targetPrice,

        side: pos.side
      });

      // ======================================
      // 7. REVERSE SIDE
      // ======================================

      const exitSide =

        pos.side === "BUY"
          ? "SELL"
          : "BUY";

      // ======================================
      // 8. EXIT ORDER
      // ======================================

      await placeOrder({

        TS: symbol,

        quantity: pos.quantity,

        transaction_type: exitSide,

        order_type: "MARKET",

        product: "NRML"
      });

      // ======================================
      // 9. REMOVE POSITION
      // ======================================

      removePosition(symbol);

      unsubscribeSymbol(symbol);

      console.log(
        "✅ POSITION CLOSED:",
        symbol
      );

    } catch (err) {

      console.error(
        "WS Parse/Error:",
        err.message
      );
    }
  });

  // ======================================
  // WS CLOSE
  // ======================================

  ws.on("close", () => {

    console.log(
      "🔌 WS Disconnected → reconnecting..."
    );

    setTimeout(connectWS, 3000);
  });

  // ======================================
  // WS ERROR
  // ======================================

  ws.on("error", (err) => {

    console.error(
      "WS Error:",
      err.message
    );
  });
}

// ======================================
// DYNAMIC SUBSCRIBE
// ======================================

function subscribeSymbol(symbol) {

  try {

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN
    ) {

      console.log("⚠️ WS Not Connected");

      return;
    }

    if (subscribedSymbols.has(symbol)) {

      console.log(
        "ℹ️ Already subscribed:",
        symbol
      );

      return;
    }

    ws.send(JSON.stringify({

      type: "subscribe",

      symbol: symbol

    }));

    subscribedSymbols.add(symbol);

    console.log(
      "📡 Subscribed:",
      symbol
    );

  } catch (err) {

    console.log(
      "❌ Subscribe Error:",
      err.message
    );
  }
}

// ======================================
// DYNAMIC UNSUBSCRIBE
// ======================================

function unsubscribeSymbol(symbol) {

  try {

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN
    ) {

      return;
    }

    ws.send(JSON.stringify({

      type: "unsubscribe",

      symbol: symbol

    }));

    subscribedSymbols.delete(symbol);

    console.log(
      "📴 Unsubscribed:",
      symbol
    );

  } catch (err) {

    console.log(
      "❌ Unsubscribe Error:",
      err.message
    );
  }
}

module.exports = {
  connectWS,
  subscribeSymbol,
  unsubscribeSymbol
};