const axios = require("axios");

const { getAccessToken } =
  require("./tokenManager");

const Trade =
  require("./models/Trade");

const {
  findInstrument
} = require("./instrumentStore");

const {
  decodeSymbol
} = require("./symbolDecoder");

const {
  addPosition,
  removePosition
} = require("./positionCache");

// ==============================
// 🕒 MARKET TIME CHECK
// ==============================

function isMarketOpen() {

  const now = new Date();

  const istTime = new Date(
    now.toLocaleString(
      "en-US",
      {
        timeZone:
          "Asia/Kolkata"
      }
    )
  );

  const day =
    istTime.getDay();

  const hours =
    istTime.getHours();

  const minutes =
    istTime.getMinutes();

  // WEEKEND

  if (
    day === 0 ||
    day === 6
  ) {

    return false;
  }

  const currentMinutes =
    hours * 60 + minutes;

  const marketStart =
    9 * 60 + 15;

  const marketEnd =
    15 * 60 + 30;

  return (

    currentMinutes >=
      marketStart &&

    currentMinutes <=
      marketEnd
  );
}

// ==============================
// 💰 FETCH EXECUTED PRICE
// ==============================

async function fetchExecutedPrice(
  orderId,
  token
) {

  try {

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1500
        )
    );

    const response =
      await axios.get(

        `https://api.upstox.com/v2/order/details?order_id=${orderId}`,

        {
          headers: {

            Authorization:
              `Bearer ${token}`
          }
        }
      );

    const data =
      response.data?.data;

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

    const token =
      getAccessToken();

    // ==============================
    // VALIDATION
    // ==============================

    const action =
      String(
        order.transaction_type || ""
      )
        .trim()
        .toUpperCase();

    const quantity =
      parseInt(
        order.quantity
      );

    const rawSymbol =
      String(
        order.TS || ""
      )
        .trim()
        .toUpperCase();

    if (
      !["BUY", "SELL"]
        .includes(action)
    ) {

      throw new Error(
        "Invalid Action"
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
    // DECODE SYMBOL
    // ==============================

    const decoded =
      decodeSymbol(
        rawSymbol
      );

    console.log(
      "🧠 Decoded:",
      decoded
    );

    const shortYear =
      decoded.year
        .toString()
        .slice(-2);

    // ==============================
    // FIND INSTRUMENT
    // ==============================

    const formats = [

      `${decoded.index} ${decoded.strike} ${decoded.type} ${decoded.day} ${decoded.month} ${shortYear}`,

      `${decoded.index} ${decoded.day} ${decoded.month} ${shortYear} ${decoded.type} ${decoded.strike}`
    ];

    let instrumentKey =
      null;

    for (const f of formats) {

      console.log(
        "🔍 Trying:",
        f
      );

      const instrumentData =
        findInstrument(f);

      if (instrumentData) {

        instrumentKey =
          instrumentData.token;

        const lotSize =
          Number(
            instrumentData.lotSize || 1
          );

        if (
          quantity % lotSize !== 0
        ) {

          throw new Error(
            `Invalid quantity. Lot size = ${lotSize}`
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
    // ORDER PAYLOAD
    // ==============================

    const orderPayload = {

      quantity,

      product:
        order.product === "NRML"
          ? "D"
          : "I",

      validity:
        order.validity ||
        "DAY",

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

      is_amo: false
    };

    console.log(
      "📡 Sending Order:",
      orderPayload
    );

    // ==============================
    // PLACE ORDER
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
    // FETCH EXECUTED PRICE
    // ==============================

    let tradePrice =
      Number(

        orderData?.data
          ?.average_price ||

        orderData?.data
          ?.price ||

        0
      );

    if (!tradePrice) {

      tradePrice =
        await fetchExecutedPrice(

          orderData.data
            ?.order_id,

          token
        );
    }

    console.log(
      "💰 Executed Price:",
      tradePrice
    );

    // ==============================
    // BUY LOGIC
    // ==============================

    if (action === "BUY") {

      await Trade.create({

        side: "BUY",

        quantity,

        instrument:
          instrumentKey,

        orderId:
          orderData.data
            ?.order_id || "NA",

        price:
          tradePrice,

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

      let targetPrice =
        Number(
          tradePrice
        ) + targetPoints;

      if (targetPrice <= 0) {

        targetPrice =
          Number(
            tradePrice
          );
      }

      // ==============================
      // SAVE POSITION USING TOKEN
      // ==============================

      addPosition(
        instrumentKey,
        {

          symbol:
            instrumentKey,

          tradingSymbol:
            rawSymbol,

          instrument:
            instrumentKey,

          quantity,

          side: "BUY",

          entryPrice:
            Number(
              tradePrice
            ),

          targetPrice,

          orderId:
            orderData.data
              ?.order_id,

          isExiting: false,

          time: new Date()
        }
      );

      const {
        subscribeSymbol
      } = require(
        "./wsService"
      );

      // ==============================
      // SUBSCRIBE TOKEN
      // ==============================

      subscribeSymbol(
        instrumentKey
      );

      console.log(
        "🎯 BUY Position Saved:",
        {

          symbol:
            instrumentKey,

          tradingSymbol:
            rawSymbol,

          entryPrice:
            tradePrice,

          targetPrice
        }
      );
    }

    // ==============================
    // SELL LOGIC
    // ==============================

    else if (
      action === "SELL"
    ) {

      await Trade.create({

        side: "SELL",

        quantity,

        instrument:
          instrumentKey,

        orderId:
          orderData.data
            ?.order_id || "NA",

        price:
          tradePrice,

        status: "OPEN",

        time: new Date()
      });

      console.log(
        "🔴 SELL Trade Recorded"
      );

      const targetPoints =
        Number(
          order.TARGET || 10
        );

      let targetPrice =
        Number(
          tradePrice
        ) - targetPoints;

      // NEVER NEGATIVE

      if (
        targetPrice <= 0
      ) {

        targetPrice = 0.05;
      }

      // ==============================
      // SAVE POSITION USING TOKEN
      // ==============================

      addPosition(
        instrumentKey,
        {

          symbol:
            instrumentKey,

          tradingSymbol:
            rawSymbol,

          instrument:
            instrumentKey,

          quantity,

          side: "SELL",

          entryPrice:
            Number(
              tradePrice
            ),

          targetPrice,

          orderId:
            orderData.data
              ?.order_id,

          isExiting: false,

          time: new Date()
        }
      );

      const {
        subscribeSymbol
      } = require(
        "./wsService"
      );

      // ==============================
      // SUBSCRIBE TOKEN
      // ==============================

      subscribeSymbol(
        instrumentKey
      );

      console.log(
        "🎯 SELL Position Saved:",
        {

          symbol:
            instrumentKey,

          tradingSymbol:
            rawSymbol,

          entryPrice:
            tradePrice,

          targetPrice
        }
      );
    }

    // ==============================
    // SOCKET EVENT
    // ==============================

    if (global.io) {

      global.io.emit(
        "order",
        orderData
      );
    }

    return orderData;

  } catch (err) {

    console.log(

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

async function exitPosition(
  position
) {

  try {

    if (
      position.isExiting
    ) {

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

      order_type:
        "MARKET",

      transaction_type:
        exitSide,

      disclosed_quantity: 0,

      trigger_price: 0,

      is_amo: false
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
    } = require(
      "./wsService"
    );

    unsubscribeSymbol(
      position.instrument
    );

    removePosition(
      position.instrument
    );

    console.log(
      "📴 Unsubscribed:",
      position.instrument
    );

    return response.data;

  } catch (err) {

    position.isExiting =
      false;

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
    .sort({
      time: -1
    });
}

// ==============================

module.exports = {

  placeOrder,

  exitPosition,

  getTradeLog
};