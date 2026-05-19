const WebSocket = require("ws");

const subscribedSymbols = new Set();

const { getAccessToken } =
  require("./tokenManager");

const {
  positions,
  removePosition
} = require("./positionCache");

const {
  exitPosition
} = require("./orderService");

let ws;

let reconnectTimer = null;

let heartbeatInterval = null;

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

    // CLEAR OLD HEARTBEAT

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

      // AUTH

      ws.send(JSON.stringify({

        type: "subscribe",

        token: token
      }));

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

            ws.send(JSON.stringify({

              type: "subscribe",

              symbol: symbol
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

        const parsed =
          JSON.parse(raw);

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
        // SAFE EXTRACTION
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

        // ======================================
        // INVALID TICK
        // ======================================

        if (!symbol || !ltp) {

          return;
        }

        // ======================================
        // DEBUG TICK
        // ======================================

        console.log(
          "📊 TICK:",
          {
            symbol,
            ltp
          }
        );

        // ======================================
        // FIND POSITION
        // ======================================

        const pos =
          positions[symbol];

        if (!pos) {

          return;
        }

        // ======================================
        // AVOID DUPLICATE EXIT
        // ======================================

        if (pos.isExiting) {

          return;
        }

        // ======================================
        // TARGET CHECK
        // ======================================

        let hit = false;

        // BUY TARGET

        if (

          pos.side === "BUY" &&

          ltp >=
            Number(
              pos.targetPrice
            )

        ) {

          hit = true;
        }

        // SELL TARGET

        if (

          pos.side === "SELL" &&

          ltp <=
            Number(
              pos.targetPrice
            )

        ) {

          hit = true;
        }

        if (!hit) {

          return;
        }

        // ======================================
        // LOCK POSITION
        // ======================================

        pos.isExiting = true;

        console.log(
          "🎯 TARGET HIT:",
          {

            symbol,

            ltp,

            target:
              pos.targetPrice,

            side:
              pos.side
          }
        );

        // ======================================
        // EXIT POSITION
        // ======================================

        const result =
          await exitPosition(pos);

        // ======================================
        // REMOVE POSITION
        // ======================================

        removePosition(symbol);

        unsubscribeSymbol(
          symbol
        );

        console.log(
          `✅ POSITION CLOSED: ${symbol}`
        );

        console.log(
          "📦 Exit Result:",
          result
        );

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

      // CLEAR HEARTBEAT

      if (heartbeatInterval) {

        clearInterval(
          heartbeatInterval
        );
      }

      // CLEAR OLD TIMER

      if (reconnectTimer) {

        clearTimeout(
          reconnectTimer
        );
      }

      // RECONNECT

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
    // SUBSCRIBE
    // ======================================

    ws.send(JSON.stringify({

      type: "subscribe",

      symbol: cleanSymbol
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
    // UNSUBSCRIBE
    // ======================================

    ws.send(JSON.stringify({

      type: "unsubscribe",

      symbol: cleanSymbol
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