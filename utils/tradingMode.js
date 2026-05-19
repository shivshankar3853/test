function isPaperTrading() {
  return process.env.TRADING_MODE === "PAPER";
}

function isLiveTrading() {
  return process.env.TRADING_MODE === "LIVE";
}

module.exports = {
  isPaperTrading,
  isLiveTrading,
};