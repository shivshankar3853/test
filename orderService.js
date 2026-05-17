const axios = require("axios");

const { getAccessToken } = require("./tokenManager");

const Trade = require("./models/Trade");

const { findInstrument } = require("./instrumentStore");

const { decodeSymbol } = require("./symbolDecoder");

const { addPosition, removePosition } = require("./positionCache");

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

  // Weekend
  if (day === 0 || day === 6) {

    return false;
  }

  const currentMinutes =
    hours * 60 + minutes;

  // NSE Market Timing
  const marketStart =
    9 * 60 + 15;

  const marketEnd =
    15 * 60 + 30;

  return (

    currentMinutes >= marketStart &&

    currentMinutes <= marketEnd
  );
}

async function fetchExecutedPrice(orderId, token) {

  try {

    await new Promise(resolve =>
      setTimeout(resolve, 1500)
    );

    const response = await axios.get(

      `https://api.upstox.com/v2/order/details?order_id=${orderId}`,

      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = response.data?.data;

    return Number(

      data?.average_price ||

      data?.price ||

      0
    );

  } catch (err) {

    console.log(
      "⚠️ Executed price fetch failed"
    );

    return 0;
  }
}


// ==============================
// 🚀 PLACE ORDER
// ==============================

async function placeOrder(order) {

  try {

    const token = getAccessToken();

// ==============================
// ✅ STEP 1: VALIDATION
// ==============================

const action =
  (order.transaction_type || "")
    .trim()
    .toUpperCase();

const quantity =
  parseInt(order.quantity);

const rawSymbol =
  String(order.TS || "")
    .trim()
    .toUpperCase();

if (
  !action ||
  !["BUY", "SELL"].includes(action)
) {

  throw new Error(
    "Invalid Action: " + action
  );
}

if (!rawSymbol) {

  throw new Error(
    "Symbol missing"
  );
}

if (
  !quantity ||
  quantity <= 0
) {

  throw new Error(
    "Invalid quantity"
  );
}

// ==============================
// 🧠 STEP 2: DECODE SYMBOL
// ==============================

const decoded =
  decodeSymbol(rawSymbol);

const shortYear =
  decoded.year.toString().slice(-2);

console.log(
  "🧠 Decoded:",
  decoded
);

    // ==============================
    // 🔍 STEP 3: FIND INSTRUMENT
    // ==============================

    const formats = [

      `${decoded.index} ${decoded.strike} ${decoded.type} ${decoded.day} ${decoded.month} ${shortYear}`,

      `${decoded.index} ${decoded.day} ${decoded.month} ${shortYear} ${decoded.type} ${decoded.strike}`
    ];

    let instrumentKey = null;

    for (const f of formats) {

      console.log("🔍 Trying:", f);

      const instrumentData =
  findInstrument(f);


if (instrumentData) {

  instrumentKey =
    instrumentData.token;

  const lotSize =
    Number(
      instrumentData.lotSize || 1
    );

  if (quantity % lotSize !== 0) {

    throw new Error(
      `Invalid quantity.
       Lot size = ${lotSize}`
    );
  }

  console.log(
    "✅ Lot Size Validated:",
    lotSize
  );

  console.log(
    "🎯 Matched:",
    f
  );

  break;
}

    }

    if (!instrumentKey) {

      throw new Error(
        "Instrument not found for: " +
        rawSymbol
      );
    }

    console.log(
      "🎯 Final Mapping:",
      rawSymbol,
      "→",
      instrumentKey
    );

    // ==============================
    // 🚀 STEP 4: ORDER PAYLOAD
    // ==============================

    const orderPayload = {

      quantity: quantity,

      product:
        order.product === "NRML"
          ? "D"
          : "I",

      validity:
        order.validity || "DAY",

      price: 0,

      instrument_token:
        instrumentKey,

      order_type:
        order.order_type ||
        "MARKET",

      transaction_type:
        action,

      disclosed_quantity: 0,

      trigger_price: 0,

      // ✅ AUTO AMO
      is_amo: !isMarketOpen()
    };

    console.log(
      "📡 Sending Order:",
      orderPayload
    );

    // ==============================
    // 📤 STEP 5: PLACE ORDER
    // ==============================

    const response =
      await axios.post(

        "https://api.upstox.com/v2/order/place",

        orderPayload,

        {
          headers: {

            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json"
          }
        }
      );

    const orderData =
      response.data;

    console.log(
      "✅ Order Success:",
      orderData
    );

    // ==============================
    // 💰 TRADE PRICE
    // ==============================

    let tradePrice = Number(

  orderData?.data?.average_price ||

  orderData?.data?.price ||

  0
);

if (!tradePrice) {

  tradePrice =
    await fetchExecutedPrice(
      orderData.data?.order_id,
      token
    );
}

    if (!tradePrice) {

      console.log(
        "⚠️ Trade price missing from broker response"
      );
    }

    // ==============================
    // 🟢 BUY ENTRY LOGIC
    // ==============================

    if (action === "BUY") {

      const openSellTrade =
        await Trade.findOne({

          instrument: instrumentKey,

          side: "SELL",

          status: "OPEN"
        });

      if (openSellTrade) {

        const pnl =

          (openSellTrade.price -
            tradePrice)

          * quantity;

        openSellTrade.status =
          "CLOSED";

        openSellTrade.pnl = pnl;

        openSellTrade.exitPrice =
          tradePrice;

        openSellTrade.exitTime =
          new Date();

        await openSellTrade.save();

        removePosition(rawSymbol);

        await Trade.create({

          side: "BUY",

          quantity,

          instrument:
            instrumentKey,

          orderId:
            orderData.data?.order_id ||
            "NA",

          price: tradePrice,

          status: "CLOSED",

          pnl,

          time: new Date()
        });

        console.log(
          "💰 SELL Trade Closed | PnL:",
          pnl
        );
      }

      else {

        await Trade.create({

          side: "BUY",

          quantity,

          instrument:
            instrumentKey,

          orderId:
            orderData.data?.order_id ||
            "NA",

          price: tradePrice,

          status: "OPEN",

          time: new Date()
        });

        console.log(
          "🟢 BUY Trade Recorded"
        );

        const targetPoints =
          Number(
            order.TARGET || 10
          );

        const targetPrice =

          Number(tradePrice) +

          targetPoints;

        addPosition(rawSymbol, {

          symbol: rawSymbol,

          instrument:
            instrumentKey,

          quantity,

          side: "BUY",

          entryPrice:
            Number(tradePrice),

          targetPrice,

          orderId:
            orderData.data?.order_id,

          isExiting: false,

          time: new Date()
        });

        const {
          subscribeSymbol
        } = require("./wsService");

        subscribeSymbol(
          rawSymbol
        );

        console.log(
          "🎯 BUY Position Saved:",
          {

            symbol: rawSymbol,

            entryPrice:
              tradePrice,

            targetPrice
          }
        );
      }
    }

    // ==============================
    // 🔴 SELL LOGIC
    // ==============================

    else if (action === "SELL") {

      const openBuyTrade =
        await Trade.findOne({

          instrument: instrumentKey,

          side: "BUY",

          status: "OPEN"
        });

      if (openBuyTrade) {

        const pnl =

          (tradePrice -
            openBuyTrade.price)

          * quantity;

        openBuyTrade.status =
          "CLOSED";

        openBuyTrade.pnl = pnl;

        openBuyTrade.exitPrice =
          tradePrice;

        openBuyTrade.exitTime =
          new Date();

        await openBuyTrade.save();

        removePosition(rawSymbol);

        await Trade.create({

          side: "SELL",

          quantity,

          instrument:
            instrumentKey,

          orderId:
            orderData.data?.order_id ||
            "NA",

          price: tradePrice,

          status: "CLOSED",

          pnl,

          time: new Date()
        });

        console.log(
          "💰 BUY Trade Closed | PnL:",
          pnl
        );
      }

      else {

        console.log(
          "🔴 Fresh SELL Position"
        );

        await Trade.create({

          side: "SELL",

          quantity,

          instrument:
            instrumentKey,

          orderId:
            orderData.data?.order_id ||
            "NA",

          price: tradePrice,

          status: "OPEN",

          time: new Date()
        });

        const targetPoints =
          Number(
            order.TARGET || 10
          );

        const targetPrice =

          Number(tradePrice) -

          targetPoints;

        addPosition(rawSymbol, {

          symbol: rawSymbol,

          instrument:
            instrumentKey,

          quantity,

          side: "SELL",

          entryPrice:
            Number(tradePrice),

          targetPrice,

          orderId:
            orderData.data?.order_id,

          isExiting: false,

          time: new Date()
        });

        const {
          subscribeSymbol
        } = require("./wsService");

        subscribeSymbol(
          rawSymbol
        );

        console.log(
          "🎯 SELL Position Saved:",
          {

            symbol: rawSymbol,

            entryPrice:
              tradePrice,

            targetPrice
          }
        );
      }
    }

    if (global.io) {

      global.io.emit(
        "order",
        orderData
      );
    }

    return orderData;

  } catch (err) {

    console.error(

      "❌ Order Error:",

      err.response?.data ||

      err.message
    );

    throw err;
  }
}

// ==============================
// 🚪 EXIT POSITION
// ==============================

async function exitPosition(position) {

  try {

    if (position.isExiting) {
      return;
    }

    position.isExiting = true;

    console.log(
      `🚀 EXITING ${position.symbol}`
    );

    const token =
      getAccessToken();

    const exitSide =

      position.side === "BUY"
        ? "SELL"
        : "BUY";

    const exitPayload = {

      quantity:
        position.quantity,

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

      // ✅ AUTO AMO
      is_amo: !isMarketOpen()
    };

    console.log(
      "📡 Exit Payload:",
      exitPayload
    );

    const response =
      await axios.post(

        "https://api.upstox.com/v2/order/place",

        exitPayload,

        {
          headers: {

            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json"
          }
        }
      );

    console.log(
      "✅ EXIT SUCCESS"
    );

    const {
      unsubscribeSymbol
    } = require("./wsService");

    unsubscribeSymbol(
      position.symbol
    );

    removePosition(position.symbol);

    console.log(
      "📴 Unsubscribed:",
      position.symbol
    );

    return response.data;

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
// 📊 TRADE LOG
// ==============================

async function getTradeLog() {

  return await Trade.find()
    .sort({ time: -1 });
}

// ==============================

module.exports = {

  placeOrder,

  exitPosition,

  getTradeLog
};