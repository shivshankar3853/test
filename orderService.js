const axios = require("axios");

const { getAccessToken } = require("./tokenManager");
const Trade = require("./models/Trade");

const { findInstrument } = require("./instrumentStore");
const { decodeSymbol } = require("./symbolDecoder");

const { addPosition, removePosition } = require("./positionCache");
const { isPaperTrading } = require("./utils/tradingMode");

// ==============================
// 🕒 MARKET TIME CHECK
// ==============================

function isMarketOpen() {
  const now = new Date();

  const istTime = new Date(
    now.toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    })
  );

  const day = istTime.getDay();
  const hours = istTime.getHours();
  const minutes = istTime.getMinutes();

  if (day === 0 || day === 6) return false;

  const currentMinutes = hours * 60 + minutes;

  const marketStart = 9 * 60 + 15;
  const marketEnd = 15 * 60 + 30;

  return (
    currentMinutes >= marketStart &&
    currentMinutes <= marketEnd
  );
}

// ==============================
// 💰 FETCH EXECUTED PRICE
// ==============================

async function fetchExecutedPrice(orderId, token) {
  try {
    await new Promise((r) => setTimeout(r, 1500));

    const response = await axios.get(
      `https://api.upstox.com/v2/order/details?order_id=${orderId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = response.data?.data;

    return Number(data?.average_price || data?.price || 0);
  } catch (err) {
    console.log("⚠️ Executed price fetch failed");
    return 0;
  }
}

// ==============================
// 🚀 PLACE ORDER
// ==============================

async function placeOrder(order) {
  try {
    const token = isPaperTrading()
  ? null
  : getAccessToken();

    // ======================
    // VALIDATION
    // ======================
    const action = String(order.transaction_type || "")
      .trim()
      .toUpperCase();

    const quantity = Number(order.quantity);

    const rawSymbol = String(order.TS || "")
      .trim()
      .toUpperCase();

    if (!["BUY", "SELL"].includes(action))
      throw new Error("Invalid Action");

    if (!rawSymbol) throw new Error("Symbol missing");

    if (!quantity || quantity <= 0)
      throw new Error("Invalid quantity");

    // ======================
    // DECODE
    // ======================
    const decoded = decodeSymbol(rawSymbol);

if (!decoded || !decoded.year) {
  throw new Error("Invalid symbol format");
}

    const shortYear = decoded.year.toString().slice(-2);

    const formats = [
      `${decoded.index} ${decoded.strike} ${decoded.type} ${decoded.day} ${decoded.month} ${shortYear}`,
      `${decoded.index} ${decoded.day} ${decoded.month} ${shortYear} ${decoded.type} ${decoded.strike}`,
    ];

    let instrumentKey = null;

    for (const f of formats) {
      const instrumentData = findInstrument(f);

      if (instrumentData) {
        instrumentKey = instrumentData.token;

        const lotSize = Number(instrumentData.lotSize || 1);

        if (quantity % lotSize !== 0) {
          throw new Error(`Invalid quantity. Lot size = ${lotSize}`);
        }

        break;
      }
    }

    if (!instrumentKey) {
      throw new Error("Instrument not found for: " + rawSymbol);
    }

    // ======================
    // ORDER PAYLOAD
    // ======================
    const orderPayload = {
      quantity,
      product: order.product === "NRML" ? "D" : "I",
      validity: order.validity || "DAY",
      price: 0,
      instrument_token: instrumentKey,
      order_type: order.order_type || "MARKET",
      transaction_type: action,
      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false,
    };
// ======================
// 📄 PAPER / LIVE ORDER
// ======================

let orderData;

if (isPaperTrading()) {

  console.log("📄 PAPER TRADE MODE");

  const simulatedPrice =
  Number(order.price) ||
  Number(order.LTP) ||
  Math.round(
    (Math.random() * 100 + 100) * 100
  ) / 100;

  orderData = {
    data: {
      order_id:
        "PAPER_" + Date.now(),

      average_price:
        simulatedPrice,

      price:
        simulatedPrice,
    },
  };

} else {

 
  // ======================
  // 🚀 LIVE ORDER
  // ======================
if (!isMarketOpen()) {
  throw new Error(
    "Market is closed"
  );
}

const response = await axios.post(
    "https://api.upstox.com/v2/order/place",
    orderPayload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type":
          "application/json",
      },
    }
  );

  orderData = response.data;
}

// ======================
// COMMON FLOW
// ======================

let tradePrice = Number(
  orderData?.data?.average_price ||
  orderData?.data?.price ||
  0
);

// fetch actual executed price only in LIVE
if (
  !tradePrice &&
  !isPaperTrading()
) {

  tradePrice =
    await fetchExecutedPrice(
      orderData.data?.order_id,
      token
    );
}
    const targetPoints = Number(order.TARGET || 10);

    // ======================
    // BUY
    // ======================
    if (action === "BUY") {
      await Trade.create({
        side: "BUY",
        quantity,
        instrument: instrumentKey,
        orderId: orderData.data?.order_id || "NA",
        price: tradePrice,
        status: "OPEN",
        mode: process.env.TRADING_MODE,
        time: new Date(),
      });

      let targetPrice = tradePrice + targetPoints;

      addPosition(instrumentKey, {
        symbol: rawSymbol, // ✅ FIXED548296
        instrument: instrumentKey,
        quantity,
        side: "BUY",
        entryPrice: tradePrice,
        targetPrice,
        orderId: orderData.data?.order_id,
        isExiting: false,
        time: new Date(),
      });

      const { subscribeSymbol } = require("./wsService");

      subscribeSymbol(instrumentKey); // ✅ FIXED (IMPORTANT)

      console.log("🎯 BUY Position Saved:", {
        symbol: rawSymbol,
        entryPrice: tradePrice,
        targetPrice,
      });
    }

    // ======================
    // SELL
    // ======================
    else if (action === "SELL") {
      await Trade.create({
        side: "SELL",
        quantity,
        instrument: instrumentKey,
        orderId: orderData.data?.order_id || "NA",
        price: tradePrice,
        status: "OPEN",
        mode: process.env.TRADING_MODE,
        time: new Date(),
      });

      let targetPrice = tradePrice - targetPoints;
      if (targetPrice <= 0) targetPrice = 0.05;

      addPosition(instrumentKey, {
        symbol: rawSymbol, // ✅ FIXED
        instrument: instrumentKey,
        quantity,
        side: "SELL",
        entryPrice: tradePrice,
        targetPrice,
        orderId: orderData.data?.order_id,
        isExiting: false,
        time: new Date(),
      });

      const { subscribeSymbol } = require("./wsService");

      subscribeSymbol(instrumentKey); // ✅ FIXED

      console.log("🎯 SELL Position Saved:", {
        symbol: rawSymbol,
        entryPrice: tradePrice,
        targetPrice,
      });
    }

    if (global.io) global.io.emit("order", orderData);

    return orderData;
  } catch (err) {
    console.log("❌ Order Error:", err.response?.data || err.message);
    throw err;
  }
}

// ==============================
// 🚪 EXIT POSITION
// ==============================

async function exitPosition(position) {

  try {

    if (position.isExiting) return;

    position.isExiting = true;

    // ======================
    // 📄 PAPER EXIT
    // ======================

    if (isPaperTrading()) {

      console.log(
        "📄 PAPER EXIT:",
        position.symbol
      );

      const { unsubscribeSymbol } =
        require("./wsService");

      unsubscribeSymbol(
        position.instrument
      );

      removePosition(
        position.instrument
      );

      return true;
    }

    // ======================
    // 🚀 LIVE EXIT
    // ======================

    const token = getAccessToken();

    const exitSide =
      position.side === "BUY"
        ? "SELL"
        : "BUY";

    const exitPayload = {
      quantity: position.quantity,
      product: "D",
      validity: "DAY",
      price: 0,
      instrument_token:
        position.instrument,

      order_type: "MARKET",

      transaction_type:
        exitSide,

      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false,
    };

    await axios.post(
      "https://api.upstox.com/v2/order/place",
      exitPayload,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,

          "Content-Type":
            "application/json",
        },
      }
    );

    const { unsubscribeSymbol } =
      require("./wsService");

    unsubscribeSymbol(
      position.instrument
    );

    removePosition(
      position.instrument
    );

    return true;

  } catch (err) {

    position.isExiting = false;

    console.log(
      "❌ Exit Error:",
      err.response?.data ||
      err.message
    );
  }
}
// ==============================

async function getTradeLog() {
  return await Trade.find().sort({ time: -1 });
}

module.exports = {
  placeOrder,
  exitPosition,
  getTradeLog,
};