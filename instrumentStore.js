const fs = require("fs");
const path = require("path");

const syncInstruments = require("./syncInstruments");

// ==============================
const DATA_DIR = path.join(__dirname, "data");
const FILE_PATH = path.join(DATA_DIR, "instruments.csv");

let instrumentCache = null;

// ==============================
function normalize(str) {
  if (!str) return "";
  return str
    .replace(/"/g, "")     // 🔥 strip double quotes
    .replace(/\s+/g, "")   // 🔥 remove ALL spaces (IMPORTANT)
    .replace(/\r/g, "")
    .trim()
    .toUpperCase();
}

// ==============================
async function ensureLocalFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log("📁 Created data directory");
    }

    if (fs.existsSync(FILE_PATH)) {
      const stats = fs.statSync(FILE_PATH);
      const mtime = new Date(stats.mtime);
      const now = new Date();
      const diffDays = (now.getTime() - mtime.getTime()) / (1000 * 60 * 60 * 24);

      if (diffDays < 7) {
        console.log("📁 Instrument CSV already exists (Updated < 7 days ago)");
        return true;
      }
      
      console.log(`⚠️ Instrument CSV is older than 7 days (${Math.floor(diffDays)} days old). Refreshing...`);
    } else {
      console.log("⚠️ Instrument CSV not found. Syncing...");
    }

    const result = await syncInstruments();
    return result && result.success;

  } catch (err) {
    console.log("❌ ensureLocalFile:", err.message);
    return false;
  }
}

// ==============================
function loadInstrumentCache() {
  if (instrumentCache) return instrumentCache;

  instrumentCache = new Map();

  try {
    const data = fs.readFileSync(FILE_PATH, "utf-8");
    const lines = data.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(",");

      // skip header
      if (i === 0 && cols[0].toLowerCase().includes("instrument")) continue;

      // 🔥 CORRECT COLUMN MAPPING (IMPORTANT)
      // columns: trading_symbol,name,instrument_key,exchange,instrument_type,expiry,lot_size,strike_price,segment
      const trading_symbol = cols[0]?.trim();
      const instrument_key = cols[2]?.trim();

      if (instrument_key && trading_symbol) {
        const normalizedSymbol = normalize(trading_symbol);
        const normalizedKey = instrument_key.replace(/"/g, ""); // strip quotes from key too

        instrumentCache.set(normalizedSymbol, normalizedKey);
      }
    }

    console.log("✅ Instrument cache loaded:", instrumentCache.size);

  } catch (err) {
    console.log("❌ Cache load error:", err.message);
  }

  return instrumentCache;
}

// ==============================
// 🔥 FINAL MATCH
// ==============================
function findInstrument(symbol) {
  const cache = loadInstrumentCache();

  const normalizedInput = normalize(symbol);

  const result = cache.get(normalizedInput);

  if (!result) {
    console.log("⚠️ NOT FOUND:", normalizedInput);
  } else {
    console.log("🎯 FOUND:", normalizedInput, "→", result);
  }

  return result || null;
}

// ==============================
module.exports = {
  ensureLocalFile,
  loadInstrumentCache,
  findInstrument
};