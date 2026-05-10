const positions = {};

function addPosition(symbol, data) {
  positions[symbol] = data;
}

function removePosition(symbol) {
  delete positions[symbol];
}

module.exports = {
  positions,
  addPosition,
  removePosition
};