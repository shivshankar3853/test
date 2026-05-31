const axios = require("axios");
const crypto = require("crypto");
const qs = require("qs");

const config = require("./config");
const { saveToken } = require("./tokenManager");

function login(req, res) {
  if (!config.API_KEY) {
    return res.status(500).send("Zerodha API key missing");
  }

  const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(config.API_KEY)}`;
  res.redirect(loginUrl);
}

async function callback(req, res) {
  const requestToken = req.query.request_token;

  if (!requestToken) {
    return res.send("No Zerodha request token received");
  }

  try {
    if (!config.API_KEY || !config.API_SECRET) {
      throw new Error("Zerodha API key or secret missing");
    }

    const checksum = crypto
      .createHash("sha256")
      .update(`${config.API_KEY}${requestToken}${config.API_SECRET}`)
      .digest("hex");

    const response = await axios.post(
      "https://api.kite.trade/session/token",
      qs.stringify({
        api_key: config.API_KEY,
        request_token: requestToken,
        checksum,
      }),
      {
        headers: {
          "X-Kite-Version": "3",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const tokenData = response.data?.data;

    if (!tokenData?.access_token) {
      throw new Error("Access token missing");
    }

    saveToken({
      ...tokenData,
      created_at: Math.floor(Date.now() / 1000),
    });

    console.log("Zerodha token generated and saved");
    res.redirect("/dashboard.html");
  } catch (err) {
    console.error("Token Error:", err.response?.data || err.message);
    res.send("Zerodha token generation failed");
  }
}

module.exports = { login, callback };
