const { kiteGet, kitePost } = require("./kiteClient");

const Trade = require("./models/Trade");
const { reconcileBrokerOrder } = require("./reconciliationService");
const { findInstrument } = require("./instrumentStore");
const { decodeSymbol } = require("./symbolDecoder");
const { addPosition, removePosition } = require("./positionCache");
const { isPaperTrading } = require("./utils/tradingMode");

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function inTimeRange(currentMinutes, startHour, startMinute, endHour, endMinute) {
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;

  return currentMinutes >= start && currentMinutes <= end;
}

function isMarketOpen(exchange, tradingSymbol) {
  const now = new Date();
  const istTime = new Date(
    now.toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    })
  );

  const day = istTime.getDay();
  const currentMinutes = minutesSinceMidnight(istTime);

  if (day === 0 || day === 6) return false;

  const normalizedExchange = String(exchange || "").toUpperCase();
  const normalizedSymbol = String(tradingSymbol || "").replace(/\s+/g, "").toUpperCase();

  if (normalizedExchange === "MCX") {
    if (
      normalizedSymbol.startsWith("COTTON") ||
      normalizedSymbol.startsWith("COTTONOIL") ||
      normalizedSymbol.startsWith("KAPAS")
    ) {
      return inTimeRange(currentMinutes, 9, 0, 21, 0);
    }

    return inTimeRange(currentMinutes, 9, 0, 23, 30);
  }

  return inTimeRange(currentMinutes, 9, 15, 15, 30);
}

async function fetchExecutedPrice(orderId) {
  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const history = await kiteGet(`/orders/${orderId}`);
    const rows = Array.isArray(history) ? history : [];
    const filled = rows.slice().reverse().find((row) => Number(row?.average_price || 0));
    const latest = filled || rows.at(-1);

    return Number(latest?.average_price || latest?.price || 0);
  } catch (err) {
    console.log("Executed price fetch failed:", err.response?.data || err.message);
    return 0;
  }
}

function normalizeSymbolValue(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
}

function normalizeAction(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeQuantity(value) {
  return Number(value ?? 0);
}

function normalizeProduct(value) {
  const product = String(value || "").trim().toUpperCase();

  if (["CNC", "NRML", "MIS", "MTF"].includes(product)) return product;
  if (product === "D") return "CNC";
  if (product === "I") return "MIS";

  return "MIS";
}

function normalizeVariety(value) {
  const variety = String(value || "regular").trim().toLowerCase();

  if (["regular", "amo", "co", "iceberg", "auction"].includes(variety)) {
    return variety;
  }

  return "regular";
}

function isAmoOrder(variety) {
  return normalizeVariety(variety) === "amo";
}

function needsMarketProtection(orderType) {
  const normalized = String(orderType || "").trim().toUpperCase();

  return normalized === "MARKET" || normalized === "SL-M";
}

function normalizeMarketProtection(value, orderType) {
  if (!needsMarketProtection(orderType)) {
    return undefined;
  }

  const protection = Number(value ?? -1);

  if (protection === -1) return -1;
  if (protection >= 0 && protection <= 100) return protection;

  return -1;
}

function resolveTargetPrice(entryPrice, action, order) {
  const absoluteTarget = Number(order?.targetPrice ?? order?.TARGET ?? NaN);

  if (Number.isFinite(absoluteTarget) && absoluteTarget > 0) {
    return absoluteTarget;
  }

  const targetPoints = Number(order?.targetPoints ?? order?.target_points ?? order?.target ?? 10);
  const points = Number.isFinite(targetPoints) && targetPoints > 0 ? targetPoints : 10;

  return action === "BUY" ? entryPrice + points : Math.max(entryPrice - points, 0.05);
}

function extractOrderId(responseData) {
  const data = responseData?.data;

  if (Array.isArray(data)) {
    const firstOrder = data.find((item) => item?.order_id);
    return String(firstOrder?.order_id || "").trim();
  }

  return String(
    data?.order_id ||
      responseData?.order_id ||
      data?.orderId ||
      responseData?.orderId ||
      ""
  ).trim();
}

function resolveInstrument(rawSymbol, exchange) {
  let instrumentData = null;

  try {
    const decoded = decodeSymbol(rawSymbol);

    if (decoded && decoded.year) {
      const shortYear = decoded.year.toString().slice(-2);
      const formats = [
        `${decoded.index} ${decoded.strike} ${decoded.type} ${decoded.day} ${decoded.month} ${shortYear}`,
        `${decoded.index} ${decoded.day} ${decoded.month} ${shortYear} ${decoded.type} ${decoded.strike}`,
      ];

      for (const format of formats) {
        instrumentData = findInstrument(format, exchange);

        if (instrumentData) break;
      }
    }
  } catch (err) {
    console.log("Using direct instrument lookup for symbol:", rawSymbol);
  }

  return instrumentData || findInstrument(rawSymbol, exchange);
}

async function placeOrder(order) {
  try {
    const action = normalizeAction(order.transaction_type || order.TT || order.action || order.side || order.tt);
    const quantity = normalizeQuantity(order.quantity ?? order.qty ?? order.Q);
    const rawSymbol = normalizeSymbolValue(
      order.tradingsymbol || order.trading_symbol || order.TS || order.symbol
    );
    const broker = "ZERODHA";

    if (!["BUY", "SELL"].includes(action)) throw new Error("Invalid Action");
    if (!rawSymbol) throw new Error("Symbol missing");
    if (!quantity || quantity <= 0) throw new Error("Invalid quantity");
    if (broker !== "ZERODHA") throw new Error(`Unsupported broker: ${broker}`);

    const requestedExchangeValue = order.E || order.exchange;
    const requestedExchange = requestedExchangeValue ? String(requestedExchangeValue).toUpperCase() : "";
    const instrumentData = resolveInstrument(rawSymbol, requestedExchange);

    if (!instrumentData) {
      throw new Error("Instrument not found for: " + rawSymbol);
    }

    const instrumentKey = instrumentData.token;
    const tradingSymbol = order.tradingsymbol || order.TS || instrumentData.tradingSymbol || rawSymbol;
    const exchange = String(order.E || order.exchange || instrumentData.exchange || "NFO").toUpperCase();
    const product = normalizeProduct(order.P || order.product);
    const variety = normalizeVariety(order.V || order.variety);
    const orderType = order.order_type || order.OT || "MARKET";
    const marketProtection = normalizeMarketProtection(
      order.MP ?? order.market_protection ?? order.marketProtection,
      orderType
    );
    const lotSize = Number(instrumentData.lotSize || 1);

    if (quantity % lotSize !== 0) {
      throw new Error(`Invalid quantity. Lot size = ${lotSize}`);
    }

    const orderPayload = {
      exchange,
      tradingsymbol: tradingSymbol,
      transaction_type: action,
      quantity,
      product,
      order_type: orderType,
      validity: order.VL || order.validity || "DAY",
      price: Number(order.price ?? order.LTP ?? 0),
      trigger_price: Number(order.trigger_price || 0),
      disclosed_quantity: Number(order.disclosed_quantity || 0),
      market_protection: marketProtection,
      variety,
    };

    const kiteOrderPayload = {
      exchange: orderPayload.exchange,
      tradingsymbol: orderPayload.tradingsymbol,
      transaction_type: orderPayload.transaction_type,
      quantity: orderPayload.quantity,
      product: orderPayload.product,
      order_type: orderPayload.order_type,
      validity: orderPayload.validity,
      price: orderPayload.price,
      trigger_price: orderPayload.trigger_price,
      disclosed_quantity: orderPayload.disclosed_quantity,
      market_protection: orderPayload.market_protection,
    };

    let orderData;

    if (isPaperTrading()) {
      console.log("PAPER TRADE MODE");

      const simulatedPrice =
        Number(order.price) ||
        Number(order.LTP) ||
        Math.round((Math.random() * 100 + 100) * 100) / 100;

      orderData = {
        data: {
          order_id: "PAPER_" + Date.now(),
          average_price: simulatedPrice,
          price: simulatedPrice,
        },
      };
    } else {
      if (!isAmoOrder(variety) && !isMarketOpen(exchange, tradingSymbol)) {
        throw new Error("Market is closed");
      }

      orderData = await kitePost(`/orders/${variety}`, kiteOrderPayload);
    }

    const liveOrderId = extractOrderId(orderData);

    if (!isPaperTrading() && !liveOrderId) {
      throw new Error("Broker order id missing after placement");
    }

    if (!isPaperTrading()) {
      const brokerCheck = await reconcileBrokerOrder(liveOrderId, instrumentKey, action);

      if (!brokerCheck.ok) {
        throw new Error(`Broker reconciliation failed: ${brokerCheck.reason}`);
      }
    }

    let tradePrice = Number(orderData?.data?.average_price || orderData?.data?.price || 0);

    if (!tradePrice && !isPaperTrading()) {
      tradePrice = await fetchExecutedPrice(liveOrderId);
    }

    if (!tradePrice) {
      tradePrice = Number(order.price || order.LTP || 0);
    }

    const targetPrice = resolveTargetPrice(tradePrice, action, order);
    const tradeDoc = await Trade.create({
      symbol: rawSymbol,
      side: action,
      quantity,
      instrument: instrumentKey,
      orderId: liveOrderId || "NA",
      price: tradePrice,
      targetPrice,
      status: "OPEN",
      mode: process.env.TRADING_MODE || "LIVE",
      source: order.source || "tradingview",
      broker,
      time: new Date(),
    });

    addPosition(instrumentKey, {
      symbol: rawSymbol,
      tradingSymbol,
      exchange,
      product,
      variety,
      broker,
      instrument: instrumentKey,
      quantity,
      side: action,
      entryPrice: tradePrice,
      targetPrice,
      orderId: liveOrderId,
      tradeId: String(tradeDoc._id),
      isExiting: false,
      time: new Date(),
      lastLtp: tradePrice,
      highestLtp: tradePrice,
      lowestLtp: tradePrice,
      tickCount: 0,
    });

    const { subscribeSymbol } = require("./wsService");
    subscribeSymbol(instrumentKey);

    console.log("Position Saved:", {
      symbol: rawSymbol,
      entryPrice: tradePrice,
      targetPrice,
      side: action,
    });

    if (global.io) {
      global.io.emit("order", {
        ...orderData,
        tradeId: String(tradeDoc._id),
        symbol: rawSymbol,
        instrument: instrumentKey,
      });
    }

    return orderData;
  } catch (err) {
    console.log("Order Error:", err.response?.data || err.message);
    throw err;
  }
}

async function exitPosition(position) {
  try {
    if (!position || position.isExiting) {
      return;
    }

    position.isExiting = true;

    const exitPrice = Number(position.lastLtp || position.entryPrice || 0);
    const entryPrice = Number(position.entryPrice || 0);
    const qty = Number(position.quantity || 0);
    const pnl =
      position.side === "BUY"
        ? (exitPrice - entryPrice) * qty
        : (entryPrice - exitPrice) * qty;

    if (isPaperTrading()) {
      console.log("PAPER EXIT:", position.symbol);
    } else {
      const exitSide = position.side === "BUY" ? "SELL" : "BUY";
      const exitPayload = {
        tradingsymbol: position.tradingSymbol || position.symbol,
        exchange: position.exchange || "NFO",
        transaction_type: exitSide,
        quantity: qty,
        product: normalizeProduct(position.product),
        order_type: "MARKET",
        validity: "DAY",
        price: 0,
        trigger_price: 0,
        disclosed_quantity: 0,
        market_protection: -1,
        variety: normalizeVariety(position.variety),
      };

      const { variety, ...kiteExitPayload } = exitPayload;
      const exitResponse = await kitePost(`/orders/${variety}`, kiteExitPayload);
      const exitOrderId = extractOrderId(exitResponse);
      const brokerCheck = await reconcileBrokerOrder(exitOrderId, position.instrument, exitSide);

      if (!brokerCheck.ok) {
        throw new Error(`Exit broker reconciliation failed: ${brokerCheck.reason}`);
      }
    }

    const updateFilter = position.tradeId
      ? { _id: position.tradeId }
      : { orderId: position.orderId || "NA", status: "OPEN" };

    await Trade.findOneAndUpdate(
      updateFilter,
      {
        $set: {
          status: "CLOSED",
          exitPrice,
          pnl,
          closedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    const { unsubscribeSymbol } = require("./wsService");
    unsubscribeSymbol(position.instrument);
    removePosition(position.instrument);

    if (global.io) {
      global.io.emit("trade_closed", {
        symbol: position.symbol,
        instrument: position.instrument,
        exitPrice,
        pnl,
        side: position.side,
      });
    }

    return true;
  } catch (err) {
    position.isExiting = false;
    console.log("Exit Error:", err.response?.data || err.message);
    return false;
  }
}

async function getTradeLog() {
  return await Trade.find().sort({ time: -1 });
}

module.exports = {
  placeOrder,
  exitPosition,
  getTradeLog,
};
