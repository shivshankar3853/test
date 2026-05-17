const Trade = require("./models/Trade");

const {
  addPosition
} = require("./positionCache");

const {
  subscribeSymbol
} = require("./wsService");

// ======================================
// RECOVER OPEN POSITIONS
// ======================================

async function recoverPositions() {

  try {

    console.log(
      "♻️ Recovering Positions..."
    );

    const openTrades =
      await Trade.find({

        status: "OPEN"
      });

    for (const trade of openTrades) {

      const targetPoints = 10;

      let targetPrice;

      if (trade.side === "BUY") {

        targetPrice =
          Number(trade.price) +
          targetPoints;

      } else {

        targetPrice =
          Number(trade.price) -
          targetPoints;
      }

      addPosition(trade.instrument, {

        symbol: trade.instrument,

        instrument: trade.instrument,

        quantity: trade.quantity,

        side: trade.side,

        entryPrice: trade.price,

        targetPrice,

        orderId: trade.orderId,

        isExiting: false,

        time: trade.time
      });

      subscribeSymbol(
        trade.instrument
      );

      console.log(
        "♻️ Recovered:",
        trade.instrument
      );
    }

    console.log(
      "✅ Recovery Complete"
    );

  } catch (err) {

    console.log(
      "❌ Recovery Error:",
      err.message
    );
  }
}

module.exports = {
  recoverPositions
};