const Trade = require("./models/Trade");

const { addPosition } = require("./positionCache");
const { subscribeSymbol } = require("./wsService");

// ======================================
// RECOVER OPEN POSITIONS (FIXED)
// ======================================

async function recoverPositions() {
  try {
    console.log("♻️ Recovering Positions...");

    const openTrades = await Trade.find({ status: "OPEN" });

    const subscribed = new Set();

    for (const trade of openTrades) {
      if (!trade.instrument) {
        console.log("⚠️ Skipping trade (no instrument):", trade);
        continue;
      }

      const targetPoints = 10;

      let targetPrice =
        trade.side === "BUY"
          ? Number(trade.price) + targetPoints
          : Number(trade.price) - targetPoints;

      if (targetPrice <= 0) targetPrice = 0.05;

      // ==============================
      // STORE POSITION USING instrumentKey
      // ==============================
      addPosition(trade.instrument, {
        ts: trade.symbol || trade.instrument,   // fallback safety
        symbol: trade.symbol || trade.instrument,
        instrument: trade.instrument,
        quantity: trade.quantity,
        side: trade.side,
        entryPrice: trade.price,
        targetPrice,
        orderId: trade.orderId,
        isExiting: false,
        recovered: true,
        time: trade.time,
      });

      // ==============================
      // SUBSCRIBE ONLY ONCE PER TOKEN
      // ==============================
      if (!subscribed.has(trade.instrument)) {
        subscribeSymbol(trade.instrument);
        subscribed.add(trade.instrument);

        console.log("♻️ Re-Subscribed:", trade.instrument);
      }
    }

    console.log("✅ Recovery Complete");
  } catch (err) {
    console.log("❌ Recovery Error:", err.message);
  }
}

module.exports = {
  recoverPositions,
};