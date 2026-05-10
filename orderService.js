const axios = require("axios");
const { getAccessToken } = require("./tokenManager");
const Trade = require("./models/Trade");

const { findInstrument } = require("./instrumentStore");
const { decodeSymbol } = require("./symbolDecoder");

// ==============================
// 🚀 PLACE ORDER (FINAL CLEAN)
// ==============================
async function placeOrder(order) {
  try {

    const token = getAccessToken();

    // ==============================
    // ✅ STEP 1: VALIDATION
    // ==============================
    const action = (order.transaction_type || "").trim().toUpperCase();
    const quantity = Number(order.quantity);
    const rawSymbol = order.TS;

    if (!action || !["BUY", "SELL"].includes(action)) {
      throw new Error("Invalid Action: " + action);
    }

    if (!rawSymbol) {
      throw new Error("Symbol missing");
    }

    // ==============================
    // 🧠 STEP 2: DECODE SYMBOL
    // ==============================
    const decoded = decodeSymbol(rawSymbol);
    const shortYear = decoded.year.toString().slice(-2);

    console.log("🧠 Decoded:", decoded);

    // ==============================
    // 🔍 STEP 3: MULTI-FORMAT MATCH
    // ==============================
    const formats = [
      `${decoded.index} ${decoded.strike} ${decoded.type} ${decoded.day} ${decoded.month} ${shortYear}`,
      `${decoded.index} ${decoded.day} ${decoded.month} ${shortYear} ${decoded.type} ${decoded.strike}`
    ];

    let instrumentKey = null;

    for (const f of formats) {
      console.log("🔍 Trying:", f);
      instrumentKey = findInstrument(f);

      if (instrumentKey) {
        console.log("🎯 Matched:", f);
        break;
      }
    }

    if (!instrumentKey) {
      throw new Error("Instrument not found for: " + rawSymbol);
    }

    console.log("🎯 Final Mapping:", rawSymbol, "→", instrumentKey);

    // ==============================
    // 🚀 STEP 4: BUILD PAYLOAD
    // ==============================
    const orderPayload = {
      quantity: quantity,
      product: order.product === "NRML" ? "D" : "I",
      validity: order.validity || "DAY",
      price: 0,

      instrument_token: instrumentKey,

      order_type: order.order_type || "MARKET",
      transaction_type: action,

      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false
    };

    console.log("📡 Sending Order:", orderPayload);

    // ==============================
    // 📤 STEP 5: API CALL
    // ==============================
    const response = await axios.post(
      "https://api.upstox.com/v2/order/place",
      orderPayload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    const orderData = response.data;

    console.log("✅ Order Success:", orderData);

    // ==============================
    // ⚠️ FIX: REAL ENTRY PRICE (IMPORTANT)
    // ==============================
    const tradePrice =
      orderData?.data?.average_price ||
      orderData?.data?.price ||
      0;

    // ==============================
    // 🟢 BUY LOGIC
    // ==============================
    if (action === "BUY") {

      await Trade.create({
        side: "BUY",
        quantity,
        instrument: instrumentKey,
        orderId: orderData.data?.order_id || "NA",
        price: tradePrice,
        status: "OPEN",
        time: new Date()
      });

      console.log("🟢 BUY Trade Recorded");
    }

    // ==============================
    // 🔴 SELL LOGIC
    // ==============================
    else if (action === "SELL") {

      const openTrade = await Trade.findOne({
        instrument: instrumentKey,
        status: "OPEN"
      });

      if (openTrade) {

        const pnl = (tradePrice - openTrade.price) * quantity;

        openTrade.status = "CLOSED";
        openTrade.pnl = pnl;
        openTrade.exitPrice = tradePrice;
        openTrade.exitTime = new Date();

        await openTrade.save();

        await Trade.create({
          side: "SELL",
          quantity,
          instrument: instrumentKey,
          orderId: orderData.data?.order_id || "NA",
          price: tradePrice,
          status: "CLOSED",
          pnl,
          time: new Date()
        });

        console.log("💰 Trade Closed | PnL:", pnl);

      } else {
        console.log("⚠️ No OPEN trade found");
      }
    }

    // ==============================
    // 📡 SOCKET UPDATE
    // ==============================
    if (global.io) {
      global.io.emit("order", orderData);
    }

    return orderData;

  } catch (err) {
    console.error("❌ Order Error:", err.response?.data || err.message);
    throw err;
  }
}

// ==============================
// 📊 TRADE LOG
// ==============================
async function getTradeLog() {
  return await Trade.find().sort({ time: -1 });
}

// ==============================
module.exports = {
  placeOrder,
  getTradeLog
};