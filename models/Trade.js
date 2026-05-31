const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema({
  time: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  symbol: { type: String, required: true, index: true },
  instrument: { type: String, index: true },
  side: { type: String, enum: ["BUY", "SELL"], required: true },
  quantity: { type: Number, required: true },
  orderId: { type: String, index: true },
  price: { type: Number, required: true },
  targetPrice: { type: Number, default: 0 },
  exitPrice: { type: Number, default: 0 },
  status: { type: String, enum: ["OPEN", "CLOSED", "REJECTED"], default: "OPEN", index: true },
  pnl: { type: Number, default: 0 },
  source: { type: String, default: "tradingview" },
  mode: { type: String, default: "LIVE" },
  broker: { type: String, default: "ZERODHA" },
  closedAt: { type: Date }
});

tradeSchema.pre("save", async function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.model("Trade", tradeSchema);
