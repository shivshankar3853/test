const mongoose = require("mongoose");

const tickSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now, index: true },
  tradeId: { type: mongoose.Schema.Types.ObjectId, index: true },
  symbol: { type: String, index: true },
  instrument: { type: String, index: true },
  ltp: { type: Number, required: true },
  source: { type: String, default: "ws" },
  rawKey: { type: String },
  tickCount: { type: Number, default: 0 },
  highestLtp: { type: Number, default: 0 },
  lowestLtp: { type: Number, default: 0 },
  side: { type: String, enum: ["BUY", "SELL"] },
  session: { type: String, default: "LIVE" }
});

module.exports = mongoose.model("Tick", tickSchema);
