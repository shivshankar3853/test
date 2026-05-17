// targetEngine.js

const {
  getPosition,
  removePosition
} = require("./positionCache");

const { exitPosition } = require("./orderService");

// ============================================
// CHECK TARGET HIT
// ============================================

async function checkTarget(symbol, ltp) {
  try {
    const position = getPosition(symbol);

    if (!position) return;

    // BUY POSITION TARGET
    if (
      position.side === "BUY" &&
      ltp >= position.targetPrice
    ) {
      console.log(`🎯 TARGET HIT BUY ${symbol}`);

      await exitPosition(position);

      removePosition(symbol);
    }

    // SELL POSITION TARGET
    if (
      position.side === "SELL" &&
      ltp <= position.targetPrice
    ) {
      console.log(`🎯 TARGET HIT SELL ${symbol}`);

      await exitPosition(position);

      removePosition(symbol);
    }

  } catch (err) {
    console.log("❌ Target Engine Error:", err.message);
  }
}

module.exports = {
  checkTarget
};