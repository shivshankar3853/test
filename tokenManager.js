const fs = require("fs");

const config = require("./config");

let tokenData = null;

function loadToken() {
  try {
    if (fs.existsSync(config.TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(config.TOKEN_FILE));
      tokenData = data;
      console.log("Token loaded");
      return data;
    }
  } catch (err) {
    console.error("Error loading token:", err.message);
  }

  return null;
}

function saveToken(data) {
  try {
    fs.writeFileSync(config.TOKEN_FILE, JSON.stringify(data, null, 2));
    tokenData = data;
    console.log("Token saved");
  } catch (err) {
    console.error("Error saving token:", err.message);
  }
}

function getAccessToken() {
  if (!tokenData) {
    loadToken();
  }

  if (!tokenData?.access_token) {
    throw new Error("Access token missing. Please login again.");
  }

  return tokenData.access_token;
}

function isTokenExpired() {
  if (!tokenData) {
    loadToken();
  }

  if (!tokenData?.access_token) {
    return true;
  }

  if (!tokenData.created_at) {
    return false;
  }

  const createdAt = new Date(Number(tokenData.created_at) * 1000);
  const expiry = new Date(createdAt);
  expiry.setDate(expiry.getDate() + 1);
  expiry.setHours(6, 0, 0, 0);

  return new Date() >= expiry;
}

async function getValidAccessToken() {
  return getAccessToken();
}

module.exports = {
  loadToken,
  saveToken,
  getAccessToken,
  getValidAccessToken,
  isTokenExpired,
};
