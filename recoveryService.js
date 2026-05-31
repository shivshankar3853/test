const Trade = require("./models/Trade");

const { addPosition } = require("./positionCache");
const { subscribeSymbol } = require("./wsService");

function resolveRecoveredTargetPrice(trade) {
  const entryPrice = Number(trade.price || 0);
  const savedTarget = Number(trade.targetPrice || 0);

  if (savedTarget > 0) {
    return savedTarget;
  }

  const defaultPoints = 10;

  if (trade.side === "BUY") {
    return entryPrice + defaultPoints;
  }

  return Math.max(entryPrice - defaultPoints, 0.05);
}

async function recoverPositions() {
  try {
    console.log("♻️ Recovering Positions...");

    const openTrades = await Trade.find({ status: "OPEN" });
    const subscribed = new Set();

    for (const trade of openTrades) {
      if (!trade.instrument) {
        console.log("⚠️ Skipping trade (no instrument):", trade?._id);
        continue;
      }

      const targetPrice = resolveRecoveredTargetPrice(trade);

      addPosition(trade.instrument, {
        symbol: trade.symbol || trade.instrument,
        ts: trade.symbol || trade.instrument,
        instrument: trade.instrument,
        quantity: trade.quantity,
        side: trade.side,
        entryPrice: trade.price,
        targetPrice,
        orderId: trade.orderId,
        tradeId: String(trade._id),
        isExiting: false,
        recovered: true,
        time: trade.time,
        lastLtp: Number(trade.price || 0),
        highestLtp: Number(trade.price || 0),
        lowestLtp: Number(trade.price || 0),
        tickCount: 0
      });

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