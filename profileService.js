const axios = require("axios");
const { getAccessToken } = require("./tokenManager");

async function getProfile() {
  try {
    const token = getAccessToken();

    const res = await axios.get(
      "https://api.upstox.com/v2/user/profile",
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    return res.data.data;

  } catch (err) {
    console.error("❌ Profile Error:", err.response?.data);
    return null;
  }
}

module.exports = { getProfile };