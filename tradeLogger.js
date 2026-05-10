const fs = require("fs");

function logTrade(data) {
  const line = {
    time: new Date().toISOString(),
    ...data
  };

  fs.appendFileSync(
    "trade_logs.json",
    JSON.stringify(line) + "\n"
  );
}

module.exports = { logTrade };