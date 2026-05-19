// positionCache.js

const positions = {};

// ======================================
// NORMALIZE SYMBOL
// ======================================

function normalizeSymbol(symbol) {
  return String(symbol)
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
}

// ======================================
// ADD POSITION
// ======================================

function addPosition(symbol, data) {

  const key = normalizeSymbol(symbol);

  positions[key] = data;

  console.log(`✅ Position Added: ${key}`);
}

// ======================================
// GET POSITION
// ======================================

function getPosition(symbol) {

  const key = normalizeSymbol(symbol);

  return positions[key];
}

// ======================================
// REMOVE POSITION
// ======================================

function removePosition(symbol) {

  const key = normalizeSymbol(symbol);

  console.log(`🗑 Removing Position: ${key}`);

  delete positions[key];

  console.log("📦 Remaining Positions:", positions);
}

// ======================================
// GET ALL POSITIONS
// ======================================

function getAllPositions() {
  return positions;
}

module.exports = {
  positions,
  addPosition,
  getPosition,
  removePosition,
  getAllPositions
};