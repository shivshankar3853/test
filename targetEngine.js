// targetEngine.js

const {
  getPosition,
  removePosition
} = require("./positionCache");

const { exitPosition } = require("./orderService");

// ============================================
// NORMALIZE SYMBOL
// ============================================

function normalizeSymbol(symbol) {
  return String(symbol)
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
}

// ============================================
// CHECK TARGET HIT
// ============================================

async function checkTarget(symbol, ltp) {

  try {

    // NORMALIZE
    symbol = normalizeSymbol(symbol);

    // GET POSITION
    const position = getPosition(symbol);

    // NO POSITION
    if (!position) {
      return;
    }

    // DEBUG
    console.log(
      `📈 TARGET CHECK | ${symbol} | LTP=${ltp} | TARGET=${position.targetPrice}`
    );

    // PREVENT MULTIPLE EXITS
    if (position.isExiting) {
      return;
    }

    // ============================================
    // BUY POSITION TARGET
    // ============================================

    if (
      position.side === "BUY" &&
      Number(ltp) >= Number(position.targetPrice)
    ) {

      console.log(`🎯 TARGET HIT BUY ${symbol}`);

      // LOCK POSITION
      position.isExiting = true;

      // REMOVE FIRST
      removePosition(symbol);

      console.log(`🗑 POSITION REMOVED ${symbol}`);

      // EXIT ORDER
      const result = await exitPosition(position);

      console.log("✅ EXIT RESULT:", result);

      return;
    }

    // ============================================
    // SELL POSITION TARGET
    // ============================================

    if (
      position.side === "SELL" &&
      Number(ltp) <= Number(position.targetPrice)
    ) {

      console.log(`🎯 TARGET HIT SELL ${symbol}`);

      // LOCK POSITION
      position.isExiting = true;

      // REMOVE FIRST
      removePosition(symbol);

      console.log(`🗑 POSITION REMOVED ${symbol}`);

      // EXIT ORDER
      const result = await exitPosition(position);

      console.log("✅ EXIT RESULT:", result);

      return;
    }

  } catch (err) {

    console.log("❌ Target Engine Error:");

    console.log(err);

  }
}

module.exports = {
  checkTarget
};