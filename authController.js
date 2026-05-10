const axios = require("axios");
const qs = require("qs");   // 👈 ADD THIS
const config = require("./config");
const { saveToken } = require("./tokenManager");

// Step 1: Login redirect
function login(req, res) {
  const loginUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${config.API_KEY}&redirect_uri=${config.REDIRECT_URI}`;
  res.redirect(loginUrl);
}

// Step 2: Callback (IMPORTANT PART)
async function callback(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.send("❌ No code received");
  }

  try {
    // 🔥 THIS IS WHERE YOUR CODE GOES
    const response = await axios.post(
      "https://api.upstox.com/v2/login/authorization/token",
      qs.stringify({
        grant_type: "authorization_code",
        code: code,
        client_id: config.API_KEY,
        client_secret: config.API_SECRET,
        redirect_uri: config.REDIRECT_URI
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    // Save token
    saveToken({
      ...response.data,
      created_at: Math.floor(Date.now() / 1000)
    });

    console.log("✅ Token Generated & Saved");

    res.send("✅ Login Successful!");

  } catch (err) {
    console.error("❌ Token Error:", err.response?.data);
    res.send("❌ Token generation failed");
  }
}

module.exports = { login, callback };