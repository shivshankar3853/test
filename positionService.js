const { kiteGet } = require("./kiteClient");

async function getPositions() {
  try {
    const data = await kiteGet("/portfolio/positions");

    return data?.net || [];
  } catch (err) {
    console.error("Position Error:", err.response?.data || err.message);
    return [];
  }
}

module.exports = { getPositions };
