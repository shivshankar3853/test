const axios = require("axios");
const { getAccessToken } = require("./tokenManager");

async function getPositions() {
  try {
    const token = getAccessToken();

    const res = await axios.get(
      "https://api.upstox.com/v2/portfolio/short-term-positions",
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    return res.data.data || [];

  } catch (err) {
    console.error("❌ Position Error:", err.response?.data);
    return [];
  }
}

module.exports = { getPositions };