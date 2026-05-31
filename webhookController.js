const { placeOrder } = require("./orderService");
const { isTradingEnabled } = require("./control");

const recentSignals = new Map();

function isDuplicate(signal) {
  const key = `${signal.AT}_${signal.exchange}_${signal.TS}_${signal.TT}_${signal.Q}`;

  if (recentSignals.has(key)) return true;

  recentSignals.set(key, Date.now());

  setTimeout(() => recentSignals.delete(key), 10000);

  return false;
}

function normalizeSignalPayload(signal = {}) {
  const source = signal && typeof signal === "object" && signal.signal ? signal.signal : signal;

  return {
    TS: String(source.TS || source.tradingsymbol || source.symbol || source.trading_symbol || source.instrument || "").trim().toUpperCase(),
    exchange: String(source.E || source.exchange || source.EX || "").trim().toUpperCase(),
    Q: Number(source.Q ?? source.qty ?? source.quantity ?? 0),
    TT: String(source.TT || source.action || source.side || source.transaction_type || "").trim().toUpperCase(),
    OT: String(source.OT || source.order_type || "MARKET").trim().toUpperCase(),
    P: String(source.P || source.product || "NRML").trim().toUpperCase(),
    VL: String(source.VL || source.validity || "DAY").trim().toUpperCase(),
    price: Number(source.price ?? source.LTP ?? source.ltp ?? 0),
    trigger_price: Number(source.trigger_price ?? 0),
    disclosed_quantity: Number(source.disclosed_quantity ?? 0),
    variety: String(source.V || source.variety || "regular").trim().toLowerCase(),
    AT: String(source.AT || source.broker || "ZERODHA").trim().toUpperCase(),
    TARGET: Number(source.TARGET ?? source.target ?? source.targetPrice ?? NaN),
    target_points: Number(source.target_points ?? source.targetPoints ?? source.points ?? 10),
    source: String(source.source || "tradingview").trim(),
    strategy: String(source.strategy || source.strategy_name || "default").trim()
  };
}

function convertTV(signal) {
  try {
    const normalized = normalizeSignalPayload(signal);

    if (!normalized.TS || !normalized.TT) {
      return null;
    }

    if (!["BUY", "SELL"].includes(normalized.TT)) {
      return null;
    }

    if (!Number.isFinite(normalized.Q) || normalized.Q <= 0) {
      return null;
    }

    return {
      exchange: normalized.exchange,
      tradingsymbol: normalized.TS,
      transaction_type: normalized.TT,
      quantity: normalized.Q,
      product: normalized.P || "NRML",
      order_type: normalized.OT || "MARKET",
      validity: normalized.VL || "DAY",
      price: normalized.price || 0,
      trigger_price: normalized.trigger_price || 0,
      disclosed_quantity: normalized.disclosed_quantity || 0,
      variety: normalized.variety || "regular",
      AT: normalized.AT || "ZERODHA",
      broker: normalized.AT || "ZERODHA",
      targetPrice: Number.isFinite(normalized.TARGET) ? normalized.TARGET : undefined,
      targetPoints: Number.isFinite(normalized.target_points) ? normalized.target_points : 10,
      source: normalized.source || "tradingview",
      strategy: normalized.strategy || "default"
    };
  } catch (err) {
    console.log("❌ Conversion error:", err.message);
    return null;
  }
}

async function handleWebhook(req, res) {
  try {
    const body = req.body;

    console.log("📡 Signal Received:", JSON.stringify(body));

    if (global.io) {
      global.io.emit("signal", body);
    }

    if (!isTradingEnabled()) {
      return res.send("⛔ Trading Disabled");
    }

    const signals = Array.isArray(body) ? body : [body];

    for (const s of signals) {
      if (!s || !s.TS && !s.tradingsymbol && !s.symbol && !s.trading_symbol) {
        console.log("❌ Invalid signal skipped:", s);
        continue;
      }

      if (isDuplicate(normalizeSignalPayload(s))) {
        console.log("⚠️ Duplicate ignored:", normalizeSignalPayload(s).TS);
        continue;
      }

      const order = convertTV(s);

      if (!order) {
        console.log("❌ Invalid signal skipped:", s);
        continue;
      }

      console.log("📤 Final Order:", order);
      await placeOrder(order);
    }

    res.send("✅ Signal processed");
  } catch (err) {
    console.error("❌ Webhook Error:", err.message);
    res.status(500).send("Error");
  }
}

module.exports = { handleWebhook };
