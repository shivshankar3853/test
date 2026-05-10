const { placeOrder } = require("./orderService");
const { isTradingEnabled } = require("./control");

// ==============================
// 🚫 DUPLICATE SIGNAL PROTECTION
// ==============================
const recentSignals = new Map();

function isDuplicate(signal) {
  const key = `${signal.TS}_${signal.TT}_${signal.Q}`;

  if (recentSignals.has(key)) return true;

  recentSignals.set(key, Date.now());

  setTimeout(() => recentSignals.delete(key), 10000);

  return false;
}

// ==============================
// 🔁 CONVERT TRADINGVIEW → INTERNAL FORMAT
// ==============================
function convertTV(signal) {
  try {
    return {
      TS: signal.TS, // ✅ REQUIRED (internal only)

      quantity: Number(signal.Q),
      product: signal.P || "NRML",
      validity: signal.VL || "DAY",
      price: 0,

      order_type: signal.OT || "MARKET",
      transaction_type: (signal.TT || "").toUpperCase(),

      disclosed_quantity: 0
    };
  } catch (err) {
    console.log("❌ Conversion error:", err.message);
    return null;
  }
}
// ==============================
// 📡 WEBHOOK HANDLER
// ==============================
async function handleWebhook(req, res) {
  try {
    const body = req.body;

    console.log("📡 Signal Received:", JSON.stringify(body));

    if (global.io) {
      global.io.emit("signal", body);
    }

    // 🚫 trading OFF check
    if (!isTradingEnabled()) {
      return res.send("⛔ Trading Disabled");
    }

    const signals = Array.isArray(body) ? body : [body];

    for (const s of signals) {
      // ❌ validation
      if (!s || !s.TS || !s.Q || !s.TT) {
        console.log("❌ Invalid signal skipped:", s);
        continue;
      }

      // 🚫 duplicate filter
      if (isDuplicate(s)) {
        console.log("⚠️ Duplicate ignored:", s.TS);
        continue;
      }

      const order = convertTV(s);
      if (!order) continue;

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