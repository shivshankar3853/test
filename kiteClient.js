const axios = require("axios");
const qs = require("qs");

const config = require("./config");
const { getAccessToken } = require("./tokenManager");

const BASE_URL = "https://api.kite.trade";

function authHeaders() {
  const token = getAccessToken();

  return {
    "X-Kite-Version": "3",
    Authorization: `token ${config.API_KEY}:${token}`,
  };
}

async function kiteGet(path, options = {}) {
  const response = await axios.get(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  return response.data?.data;
}

async function kitePost(path, data, options = {}) {
  const response = await axios.post(`${BASE_URL}${path}`, qs.stringify(data), {
    ...options,
    headers: {
      ...authHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
      ...(options.headers || {}),
    },
  });

  return response.data;
}

module.exports = {
  BASE_URL,
  authHeaders,
  kiteGet,
  kitePost,
};
