const axios = require("axios");
const fs = require("fs");
const path = require("path");

const { authHeaders } = require("./kiteClient");

async function syncInstruments() {
  console.log("Starting Zerodha instrument sync");

  try {
    const response = await axios.get("https://api.kite.trade/instruments", {
      responseType: "text",
      timeout: 30000,
      headers: authHeaders(),
    });

    const dataDir = path.join(__dirname, "data");

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
    }

    const filePath = path.join(dataDir, "instruments.csv");
    fs.writeFileSync(filePath, response.data);

    const total = String(response.data || "").split("\n").filter(Boolean).length - 1;

    console.log("Zerodha CSV saved successfully");
    console.log(`Location: ${filePath}`);
    console.log(`Total rows: ${total}`);

    return { success: true, total, file: filePath };
  } catch (error) {
    console.error("Instrument sync failed:", error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

if (require.main === module) {
  syncInstruments().then(() => process.exit(0));
}

module.exports = syncInstruments;
