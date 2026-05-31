const WebSocket = require("ws");

const subscribedSymbols = new Set();

const Tick = require("./models/Tick");

const {
  getAccessToken
} = require("./tokenManager");

const {
  getAllPositions,
  getPosition
} = require("./positionCache");

const {
  exitPosition
} = require("./orderService");

let ws;

let reconnectTimer = null;

let heartbeatInterval = null;

function normalizeFeedKey(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
}

function resolvePosition(symbol) {
  const normalized = normalizeFeedKey(symbol);

  const direct = getPosition(normalized);

  if (direct) {
    return direct;
  }

  const allPositions = getAllPositions();

  for (const key in allPositions) {
    const candidate = allPositions[key];

    if (
      normalizeFeedKey(candidate?.symbol) === normalized ||
      normalizeFeedKey(candidate?.ts) === normalized
    ) {
      return candidate;
    }
  }

  return null;
}

async function persistTick(position, ltp, metadata = {}) {
  try {
    if (!position || !Number.isFinite(ltp) || ltp <= 0) {
      return;
    }

    const nextTickCount = Number(position.tickCount || 0) + 1;

    position.lastLtp = ltp;
    position.highestLtp = Math.max(Number(position.highestLtp || 0), ltp);
    position.lowestLtp = position.lowestLtp
      ? Math.min(Number(position.lowestLtp), ltp)
      : ltp;
    position.tickCount = nextTickCount;

    await Tick.create({
      tradeId: position.tradeId || null,
      symbol: position.symbol || position.ts || position.instrument,
      instrument: position.instrument,
      ltp,
      source: metadata.source || "ws",
      rawKey: metadata.rawKey || "",
      tickCount: nextTickCount,
      highestLtp: position.highestLtp,
      lowestLtp: position.lowestLtp,
      side: position.side,
      session: metadata.session || "LIVE",
    });
  } catch (err) {
    console.log("⚠️ Tick persistence failed:", err.message);
  }
}

async function handleTick(symbol, ltp, metadata = {}) {
  const normalizedSymbol = normalizeFeedKey(symbol);
  const position = resolvePosition(normalizedSymbol);

  if (!position) {
    return;
  }

  console.log("📊 TICK:", {
    symbol: normalizedSymbol,
    ltp,
  });

  await persistTick(position, ltp, {
    ...metadata,
    rawKey: metadata.rawKey || normalizedSymbol,
  });

  if (position.isExiting || !Number(position.targetPrice)) {
    return;
  }

  const targetPrice = Number(position.targetPrice);

  const hit =
    position.side === "BUY"
      ? ltp >= targetPrice
      : ltp <= targetPrice;

  if (!hit) {
    return;
  }

  position.isExiting = true;

  console.log("🎯 TARGET HIT:", {
    symbol: normalizedSymbol,
    ltp,
    target: targetPrice,
    side: position.side,
  });

  const result = await exitPosition(position);

  console.log(`✅ POSITION CLOSED: ${normalizedSymbol}`);
  console.log("📦 Exit Result:", result);
}

// ======================================
// CONNECT WS
// ======================================

function connectWS() {

  try {

    const token =
      getAccessToken();

    // ======================================
    // CLOSE OLD SOCKET
    // ======================================

    if (ws) {

      try {

        ws.removeAllListeners();

        ws.terminate();

      } catch (e) {}
    }

    // ======================================
    // CLEAR OLD HEARTBEAT
    // ======================================

    if (heartbeatInterval) {

      clearInterval(
        heartbeatInterval
      );
    }

    // ======================================
    // CREATE WS
    // ======================================

    ws = new WebSocket(
      "wss://mlhsm.kotaksecurities.com"
    );

    // ======================================
    // OPEN
    // ======================================

    ws.on("open", () => {

      console.log(
        "📡 WS Connected"
      );

      // ======================================
      // AUTH
      // ======================================

      ws.send(JSON.stringify({

        type: "subscribe",

        token: token
      }));

      console.log(
        "🔐 WS Auth Sent"
      );

      // ======================================
      // HEARTBEAT
      // ======================================

      heartbeatInterval =
        setInterval(() => {

          try {

            if (
              ws &&
              ws.readyState ===
                WebSocket.OPEN
            ) {

              ws.ping();

              console.log(
                "💓 WS Ping"
              );
            }

          } catch (err) {

            console.log(
              "❌ Ping Error:",
              err.message
            );
          }

        }, 15000);

      // ======================================
      // RESUBSCRIBE ALL
      // ======================================

      subscribedSymbols.forEach(
        (symbol) => {

          try {

            // ======================================
            // KOTAK SUBSCRIBE FORMAT
            // ======================================

            ws.send(JSON.stringify({

              type: "subscribe",

              scrips: symbol
            }));

            console.log(
              `📡 Re-Subscribed: ${symbol}`
            );

          } catch (err) {

            console.log(
              "❌ Re-Subscribe Error:",
              err.message
            );
          }
        }
      );
    });

    // ======================================
    // MESSAGE
    // ======================================

    ws.on("message", async (raw) => {

      try {

        const rawText =
          raw.toString();

        console.log(
          "📩 RAW WS:",
          rawText
        );

        let parsed;

        try {

          parsed =
            JSON.parse(rawText);

        } catch {

          console.log(
            "⚠️ Non JSON WS Message"
          );

          return;
        }

        // ======================================
        // DASHBOARD FEED
        // ======================================

        if (global.io) {

          global.io.emit(
            "tick",
            parsed
          );
        }

        // ======================================
        // KOTAK FEED FORMAT
        // ======================================

        if (parsed.feeds) {

          for (const key in parsed.feeds) {

            try {

              const feed = parsed.feeds[key];
              const ltp = Number(
                feed?.ltpc?.ltp ||
                feed?.ff?.ltpc?.ltp ||
                feed?.ltp ||
                0
              );

              if (!ltp) {
                continue;
              }

              await handleTick(key, ltp, {
                source: "ws",
                rawKey: key,
              });
            } catch (innerErr) {
              console.log("❌ Feed Parse Error:", innerErr.message);
            }
          }

          return;
        }

        // ======================================
        // DIRECT FORMAT FALLBACK
        // ======================================

        const symbol = String(
          parsed.symbol ||
          parsed.ts ||
          parsed.trading_symbol ||
          parsed.TS ||
          ""
        )
          .replace(/\s+/g, "")
          .toUpperCase()
          .trim();

        const ltp = Number(
          parsed.ltp ||
          parsed.lp ||
          parsed.LTP ||
          parsed.price ||
          0
        );

        if (!symbol || !ltp) {
          return;
        }

        await handleTick(symbol, ltp, {
          source: "direct",
          rawKey: symbol,
        });

      } catch (err) {

        console.log(
          "❌ Tick Parse Error:",
          err.message
        );
      }
    });

    // ======================================
    // CLOSE
    // ======================================

    ws.on("close", () => {

      console.log(
        "🔌 WS Disconnected"
      );

      // ======================================
      // CLEAR HEARTBEAT
      // ======================================

      if (heartbeatInterval) {

        clearInterval(
          heartbeatInterval
        );
      }

      // ======================================
      // CLEAR TIMER
      // ======================================

      if (reconnectTimer) {

        clearTimeout(
          reconnectTimer
        );
      }

      // ======================================
      // RECONNECT
      // ======================================

      reconnectTimer =
        setTimeout(() => {

          console.log(
            "🔄 Reconnecting WS..."
          );

          connectWS();

        }, 3000);
    });

    // ======================================
    // ERROR
    // ======================================

    ws.on("error", (err) => {

      console.log(
        "❌ WS Error:",
        err.message
      );
    });

  } catch (err) {

    console.log(
      "❌ WS Connect Error:",
      err.message
    );
  }
}

// ======================================
// SUBSCRIBE
// ======================================

function subscribeSymbol(symbol) {

  try {

    const cleanSymbol =
      String(symbol)
        .replace(/\s+/g, "")
        .toUpperCase()
        .trim();

    // ======================================
    // SAVE SUBSCRIPTION
    // ======================================

    subscribedSymbols.add(
      cleanSymbol
    );

    // ======================================
    // WS NOT READY
    // ======================================

    if (

      !ws ||

      ws.readyState !==
        WebSocket.OPEN

    ) {

      console.log(
        "⚠️ WS Not Connected Yet"
      );

      return;
    }

    // ======================================
    // KOTAK SUBSCRIBE FORMAT
    // ======================================

    ws.send(JSON.stringify({

      type: "subscribe",

      scrips: cleanSymbol
    }));

    console.log(
      `📡 Subscribed: ${cleanSymbol}`
    );

  } catch (err) {

    console.log(
      "❌ Subscribe Error:",
      err.message
    );
  }
}

// ======================================
// UNSUBSCRIBE
// ======================================

function unsubscribeSymbol(symbol) {

  try {

    const cleanSymbol =
      String(symbol)
        .replace(/\s+/g, "")
        .toUpperCase()
        .trim();

    // ======================================
    // REMOVE SUBSCRIPTION
    // ======================================

    subscribedSymbols.delete(
      cleanSymbol
    );

    // ======================================
    // WS NOT READY
    // ======================================

    if (

      !ws ||

      ws.readyState !==
        WebSocket.OPEN

    ) {

      return;
    }

    // ======================================
    // KOTAK UNSUBSCRIBE FORMAT
    // ======================================

    ws.send(JSON.stringify({

      type: "unsubscribe",

      scrips: cleanSymbol
    }));

    console.log(
      `📴 Unsubscribed: ${cleanSymbol}`
    );

  } catch (err) {

    console.log(
      "❌ Unsubscribe Error:",
      err.message
    );
  }
}

// ======================================
// EXPORTS
// ======================================

module.exports = {

  connectWS,

  subscribeSymbol,

  unsubscribeSymbol
};