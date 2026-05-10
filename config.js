require("dotenv").config();

module.exports = {
  API_KEY: process.env.UPSTOX_API_KEY,
  API_SECRET: process.env.UPSTOX_API_SECRET,
  REDIRECT_URI: process.env.REDIRECT_URI,
  TOKEN_FILE: "./token.json"
};