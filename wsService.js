const WebSocket = require("ws");
const { getAccessToken } = require("./tokenManager");
const { positions } = require("./positionCache");

// ⚠️ KEEP SAME (no architecture change)
const { placeOrder } = require("./orderService");

let ws;

function connectWS() {
  const token = getAccessToken();

  ws = new WebSocket("wss://mlhsm.kotaksecurities.com");

  ws.on("open", () => {
    console.log("📡 WS Connected");

    ws.send(JSON.stringify({
      type: "subscribe",
      token: token
    }));
  });

  ws.on("message", async (data) => {
    try {

      const parsed = JSON.parse(data);

      // ===============================
      // 1. DASHBOARD FEED (UNCHANGED)
      // ===============================
      if (global.io) {
        global.io.emit("tick", parsed);
      }

      // ===============================
      // 2. SAFE PARSING (IMPROVED)
      // ===============================
      const symbol = parsed.symbol;
      const ltp = parsed.ltp;

      if (!symbol || !ltp) return;

      const pos = positions[symbol];
      if (!pos) return;

      // ===============================
      // 3. TARGET CHECK (UNCHANGED LOGIC)
      // ===============================
      let hit = false;

      if (pos.side === "BUY" && ltp >= pos.target) {
        hit = true;
      }

      if (pos.side === "SELL" && ltp <= pos.target) {
        hit = true;
      }

      if (!hit) return;

      console.log("🎯 TARGET HIT (WS):", {
        symbol,
        ltp,
        target: pos.target,
        side: pos.side
      });

      // ===============================
      // 4. SQUARE-OFF LOGIC (FIXED + SAFE)
      // ===============================
      const exitSide = pos.side === "BUY" ? "SELL" : "BUY";

      await placeOrder({
        TS: symbol,              // FIX: match orderService format
        quantity: pos.qty,
        transaction_type: exitSide,
        order_type: "MARKET"
      });

      delete positions[symbol];

      console.log("✅ POSITION CLOSED:", symbol);

    } catch (err) {
      console.error("WS Parse/Error:", err.message);
    }
  });

  // ===============================
  // RECONNECT (UNCHANGED)
  // ===============================
  ws.on("close", () => {
    console.log("🔌 WS Disconnected → reconnecting...");
    setTimeout(connectWS, 3000);
  });

  ws.on("error", (err) => {
    console.error("WS Error:", err.message);
  });
}

module.exports = { connectWS };