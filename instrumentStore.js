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

const MONTH_MAP = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

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

function parseTradingKey(symbol) {
  const normalized = normalize(symbol);

  const match = normalized.match(
    /^([A-Z]+)\s*(\d+(?:\.\d+)?)\s*(CE|PE)\s*(\d{1,2})\s*([A-Z]{3})\s*(\d{2})$/
  );

  if (!match) {
    return null;
  }

  const [, index, strike, type, day, month, year] = match;

  const monthIndex = MONTH_MAP[month];

  if (monthIndex === undefined) {
    return null;
  }

  return {
    index,
    strike,
    type,
    day: Number(day),
    month,
    year: Number(year),
    expiry: new Date(2000 + Number(year), monthIndex, Number(day)),
  };
}

function parseSignalSymbol(symbol) {
  const normalized = normalize(symbol);

  const patterns = [
    /^([A-Z]+)(\d{1,2})([A-Z]{3})(?:(\d{2}))?(\d+)(CE|PE)$/,
    /^([A-Z]+)(\d{1,2})(\d{1,2})(\d{2})(\d+)(CE|PE)$/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (!match) {
      continue;
    }

    const [, index, day, monthToken, yearToken, strike, type] = match;

    let month = monthToken;

    if (/^\d+$/.test(monthToken)) {
      const monthNumber = Number(monthToken);

      if (monthNumber < 1 || monthNumber > 12) {
        continue;
      }

      month = MONTH_NAMES[monthNumber - 1];
    }

    if (MONTH_MAP[month] === undefined) {
      continue;
    }

    return {
      index,
      strike,
      type,
      day: Number(day),
      month,
      year: yearToken ? Number(yearToken) : undefined,
    };
  }

  return null;
}

function resolveSignalInstrument(symbol) {
  const cache = loadInstrumentCache();
  const signal = parseSignalSymbol(symbol);

  if (!signal) {
    return null;
  }

  const candidates = [];

  for (const [key, data] of cache.entries()) {
    const parsedKey = parseTradingKey(key);

    if (!parsedKey) {
      continue;
    }

    if (
      parsedKey.index !== signal.index ||
      parsedKey.strike !== String(signal.strike) ||
      parsedKey.type !== signal.type
    ) {
      continue;
    }

    candidates.push({
      key,
      data,
      parsedKey,
    });
  }

  if (!candidates.length) {
    return null;
  }

  const exactMatch = candidates.find((candidate) => {
    return (
      candidate.parsedKey.day === signal.day &&
      candidate.parsedKey.month === signal.month
    );
  });

  if (exactMatch) {
    return exactMatch.data;
  }

  const now = new Date();
  const futureMatches = candidates
    .filter((candidate) => candidate.parsedKey.expiry >= now)
    .sort((a, b) => a.parsedKey.expiry - b.parsedKey.expiry);

  if (futureMatches.length) {
    return futureMatches[0].data;
  }

  const latest = candidates.sort(
    (a, b) => b.parsedKey.expiry - a.parsedKey.expiry
  );

  return latest[0].data;
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

      const header =
        fs.readFileSync(FILE_PATH, "utf-8").split("\n")[0] || "";

      const legacyBrokerFile =
        header.toLowerCase().includes("instrument_key");

      if (diffDays < 7 && !legacyBrokerFile) {

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

    const headers =
      lines[0]
        ?.split(",")
        .map((header) => header.replace(/"/g, "").trim().toLowerCase()) || [];

    const col = (name, fallback) => {
      const index = headers.indexOf(name);
      return index >= 0 ? index : fallback;
    };

    const tradingSymbolIndex =
      col("tradingsymbol", col("trading_symbol", 0));

    const instrumentTokenIndex =
      col("instrument_token", col("instrument_key", 2));

    const exchangeIndex =
      col("exchange", 11);

    const lotSizeIndex =
      col("lot_size", 8);

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
        cols[tradingSymbolIndex]
          ?.replace(/"/g, "")
          .trim();

      const instrument_key =
        cols[instrumentTokenIndex]
          ?.replace(/"/g, "")
          .trim();

      const exchange =
        cols[exchangeIndex]
          ?.replace(/"/g, "")
          .trim();

      const lot_size =
        Number(
          cols[lotSizeIndex]
            ?.replace(/"/g, "")
            .trim()
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

      const instrument = {
        token: normalizedKey,
        tradingSymbol: trading_symbol,
        exchange: exchange || "NFO",
        lotSize: lot_size
      };

      instrumentCache.set(

        normalizedSymbol,

        instrument
      );

      if (exchange) {
        instrumentCache.set(

          `${normalizedSymbol}:${normalize(exchange)}`,

          instrument
        );
      }
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

function findInstrument(symbol, exchange) {

  const cache =
    loadInstrumentCache();

  const normalizedInput =

    normalize(symbol);

  const normalizedExchange =

    normalize(exchange);

  const exchangeResult =

    normalizedExchange

      ? cache.get(
          `${normalizedInput}:${normalizedExchange}`
        )

      : null;

  const result =

    exchangeResult ||

    cache.get(
      normalizedInput
    );

  if (result) {
    console.log(

      "🎯 FOUND:",

      normalizedInput,

      "→",

      result
    );

    return result;
  }

  const fallback = resolveSignalInstrument(normalizedInput);

  if (!fallback) {
    console.log(

      "⚠️ NOT FOUND:",

      normalizedInput
    );

    return null;
  }

  console.log(

    "🎯 FALLBACK FOUND:",

    normalizedInput,

    "→",

    fallback
  );

  return fallback;
}

// ==============================
// EXPORTS
// ==============================

module.exports = {

  ensureLocalFile,

  loadInstrumentCache,

  findInstrument
};
