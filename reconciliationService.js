const { kiteGet } = require("./kiteClient");

function normalizeSide(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeOrderId(value) {
  return String(value || "")
    .trim();
}

function normalizeSymbol(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
}

function isAcceptedStatus(status) {
  const normalized = String(status || "").toUpperCase();

  return [
    "OPEN",
    "TRIGGER PENDING",
    "COMPLETE",
    "AMO REQ RECEIVED",
    "PUT ORDER REQ RECEIVED",
    "VALIDATION PENDING",
    "OPEN PENDING",
  ].includes(normalized);
}

function isRejectedStatus(status) {
  const normalized = String(status || "").toUpperCase();

  return ["REJECTED", "CANCELLED", "EXPIRED", "FAILED"].includes(normalized);
}

async function fetchBrokerOrders() {
  return (await kiteGet("/orders")) || [];
}

async function fetchBrokerPositions() {
  const data = await kiteGet("/portfolio/positions");

  return data?.net || [];
}

function findBrokerOrder(orders, orderId) {
  const normalizedOrderId = normalizeOrderId(orderId);

  return orders.find((order) => normalizeOrderId(order?.order_id || order?.orderId || order?.id) === normalizedOrderId);
}

async function reconcileBrokerOrder(orderId, expectedInstrument, expectedSide) {
  const orders = await fetchBrokerOrders();
  const brokerOrder = findBrokerOrder(orders, orderId);

  if (!brokerOrder) {
    return {
      ok: false,
      reason: "ORDER_NOT_FOUND",
      brokerOrder: null,
    };
  }

  const status = String(brokerOrder.status || "").toUpperCase();

  if (isRejectedStatus(status)) {
    return {
      ok: false,
      reason: "ORDER_REJECTED",
      brokerOrder,
    };
  }

  if (!isAcceptedStatus(status)) {
    return {
      ok: false,
      reason: `UNEXPECTED_STATUS:${status}`,
      brokerOrder,
    };
  }

  if (
    expectedInstrument &&
    brokerOrder.instrument_token &&
    String(brokerOrder.instrument_token) !== String(expectedInstrument)
  ) {
    return {
      ok: false,
      reason: "INSTRUMENT_MISMATCH",
      brokerOrder,
    };
  }

  if (expectedSide) {
    const brokerSide = normalizeSide(
      brokerOrder.transaction_type || brokerOrder.side || brokerOrder.tt
    );

    if (brokerSide && brokerSide !== normalizeSide(expectedSide)) {
      return {
        ok: false,
        reason: "SIDE_MISMATCH",
        brokerOrder,
      };
    }
  }

  return {
    ok: true,
    reason: "OK",
    brokerOrder,
  };
}

async function reconcileBrokerPosition(symbol, side) {
  const positions = await fetchBrokerPositions();
  const normalizedSymbol = normalizeSymbol(symbol);

  return positions.find((position) => {
    const positionSymbol = normalizeSymbol(position?.tradingsymbol || position?.trading_symbol);

    if (positionSymbol !== normalizedSymbol) {
      return false;
    }

    if (side) {
      const quantity = Number(position?.quantity || 0);
      const inferredSide = quantity >= 0 ? "BUY" : "SELL";

      if (inferredSide !== normalizeSide(side)) {
        return false;
      }
    }

    return Number(position?.quantity || 0) !== 0;
  });
}

module.exports = {
  fetchBrokerOrders,
  fetchBrokerPositions,
  reconcileBrokerOrder,
  reconcileBrokerPosition,
};
