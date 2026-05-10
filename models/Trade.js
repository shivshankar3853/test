const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema({
  time: { type: Date, default: Date.now },
  side: String,
  quantity: Number,
  instrument: String,
  orderId: String,
  price: Number,

  status: { type: String, default: "OPEN" }, // OPEN / CLOSED
  pnl: { type: Number, default: 0 }
});

module.exports = mongoose.model("Trade", tradeSchema);