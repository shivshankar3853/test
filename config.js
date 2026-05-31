require("dotenv").config();

module.exports = {
  API_KEY: process.env.ZERODHA_API_KEY || process.env.KITE_API_KEY,
  API_SECRET: process.env.ZERODHA_API_SECRET || process.env.KITE_API_SECRET,
  REDIRECT_URI: process.env.REDIRECT_URI,
  TOKEN_FILE: "./token.json",
};
