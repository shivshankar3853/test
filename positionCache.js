// positionCache.js

const positions = {};

// ============================
// ADD POSITION
// ============================

function addPosition(symbol, data) {
  positions[symbol] = data;
}

// ============================
// GET POSITION
// ============================

function getPosition(symbol) {
  return positions[symbol];
}

// ============================
// REMOVE POSITION
// ============================

function removePosition(symbol) {
  delete positions[symbol];
}

// ============================
// GET ALL POSITIONS
// ============================

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