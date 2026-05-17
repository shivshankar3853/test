const fs = require("fs");

const path = require("path");

const syncInstruments = require("./syncInstruments");

// ==============================
// PATHS
// ==============================

const DATA_DIR =
  path.join(__dirname, "data");

const FILE_PATH =
  path.join(
    DATA_DIR,
    "instruments.csv"
  );

// ==============================
// CACHE
// ==============================

let instrumentCache = null;

// ==============================
// NORMALIZE
// ==============================

function normalize(str) {

  if (!str) {
    return "";
  }

  return String(str)

    .replace(/"/g, "")

    .replace(/\s+/g, "")

    .replace(/\r/g, "")

    .trim()

    .toUpperCase();
}

// ==============================
// ENSURE CSV EXISTS
// ==============================

async function ensureLocalFile() {

  try {

    // ==========================
    // CREATE DATA DIR
    // ==========================

    if (!fs.existsSync(DATA_DIR)) {

      fs.mkdirSync(
        DATA_DIR,
        { recursive: true }
      );

      console.log(
        "📁 Created data directory"
      );
    }

    // ==========================
    // CHECK FILE
    // ==========================

    if (fs.existsSync(FILE_PATH)) {

      const stats =
        fs.statSync(FILE_PATH);

      const mtime =
        new Date(stats.mtime);

      const now =
        new Date();

      const diffDays =

        (
          now.getTime() -
          mtime.getTime()
        )

        /

        (1000 * 60 * 60 * 24);

      // ==========================
      // FILE STILL VALID
      // ==========================

      if (diffDays < 7) {

        console.log(

          "📁 Instrument CSV already exists (Updated < 7 days ago)"

        );

        return true;
      }

      console.log(

        `⚠️ Instrument CSV older than 7 days (${Math.floor(diffDays)} days old). Refreshing...`

      );

    } else {

      console.log(
        "⚠️ Instrument CSV not found. Syncing..."
      );
    }

    // ==========================
    // DOWNLOAD NEW CSV
    // ==========================

    const result =
      await syncInstruments();

    // ==========================
    // RESET CACHE
    // ==========================

    instrumentCache = null;

    return result &&
      result.success;

  } catch (err) {

    console.log(
      "❌ ensureLocalFile:",
      err.message
    );

    return false;
  }
}

// ==============================
// LOAD CACHE
// ==============================

function loadInstrumentCache() {

  // ==========================
  // RETURN EXISTING CACHE
  // ==========================

  if (instrumentCache) {

    return instrumentCache;
  }

  // ==========================
  // CREATE NEW CACHE
  // ==========================

  instrumentCache =
    new Map();

  try {

    // ==========================
    // CHECK FILE EXISTS
    // ==========================

    if (!fs.existsSync(FILE_PATH)) {

      console.log(
        "❌ instruments.csv missing"
      );

      return instrumentCache;
    }

    // ==========================
    // READ FILE
    // ==========================

    const data =
      fs.readFileSync(
        FILE_PATH,
        "utf-8"
      );

    const lines =
      data.split("\n");

    // ==========================
    // PROCESS LINES
    // ==========================

    for (
      let i = 0;
      i < lines.length;
      i++
    ) {

      const line =
        lines[i].trim();

      // ==========================
      // SKIP EMPTY
      // ==========================

      if (!line) {
        continue;
      }

      const cols =
        line.split(",");

      // ==========================
      // INVALID ROW
      // ==========================

      if (cols.length < 3) {
        continue;
      }

      // ==========================
      // SKIP HEADER
      // ==========================

      if (

        i === 0 &&

        cols[0]
          .toLowerCase()
          .includes("instrument")

      ) {

        continue;
      }

      // ==========================
      // CSV COLUMNS
      // ==========================

      // trading_symbol,name,instrument_key,...

      const trading_symbol =
        cols[0]?.trim();

      const instrument_key =
        cols[2]?.trim();

      const lot_size =
        Number(
          cols[6]?.trim()
        ) || 1;

      // ==========================
      // VALIDATE
      // ==========================

      if (
        !trading_symbol ||
        !instrument_key
      ) {

        continue;
      }

      // ==========================
      // NORMALIZE
      // ==========================

      const normalizedSymbol =

        normalize(
          trading_symbol
        );

      const normalizedKey =

        instrument_key

          .replace(/"/g, "")

          .trim();

      // ==========================
      // SAVE CACHE
      // ==========================

      instrumentCache.set(

        normalizedSymbol,

        {
          token: normalizedKey,
          lotSize: lot_size
        }
      );
    }

    console.log(

      "✅ Instrument cache loaded:",

      instrumentCache.size

    );

  } catch (err) {

    console.log(

      "❌ Cache load error:",

      err.message

    );
  }

  return instrumentCache;
}

// ==============================
// FIND INSTRUMENT
// ==============================

function findInstrument(symbol) {

  const cache =
    loadInstrumentCache();

  const normalizedInput =

    normalize(symbol);

  const result =

    cache.get(
      normalizedInput
    );

  // ==========================
  // NOT FOUND
  // ==========================

  if (!result) {

    console.log(

      "⚠️ NOT FOUND:",

      normalizedInput
    );

    return null;
  }

  // ==========================
  // FOUND
  // ==========================

  console.log(

    "🎯 FOUND:",

    normalizedInput,

    "→",

    result
  );

  return result;
}

// ==============================
// EXPORTS
// ==============================

module.exports = {

  ensureLocalFile,

  loadInstrumentCache,

  findInstrument
};