const { kiteGet } = require("./kiteClient");

async function getProfile() {
  try {
    return await kiteGet("/user/profile");
  } catch (err) {
    console.error("Profile Error:", err.response?.data || err.message);
    return null;
  }
}

module.exports = { getProfile };
