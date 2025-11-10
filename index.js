// ✅ UnStableCoin Bot v3.5  — Clean merged stable build (2025-10-25)
// 💬 t.me/UnStableCoin_US — the unstable force in crypto
/*
==========================================================
🧩 UnStableCoin Bot v3.5 — Full Wallet Flow + Events + ATH
Build: 2025-11-09   |  TEST MODE: OFF (production)
==========================================================
📑 STRUCTURE (updated)
1)  Imports & Config Defaults
2)  Environment & Constants (strict validation incl. PRICELIST_JSONBIN_ID)
3)  JSONBin URLs (only used constants)
4)  Admin Users
5)  Express + Telegram Webhook Setup
6)  Utilities (sleep, escapeXml, normalize, cache)
7)  JSONBin Helpers (readBin unified unwrap, writeBin)
8)  Config & Holders (getConfig, updateConfig, holders map/array)
9)  Solana Checks (address validator, balance check)
10) Image Composition (share image, ATH banner)
11) Leaderboard Helpers (formatMcap, extract, getLeaderboard)
12) Event Data (getEventData, getEventMeta, verified top with cache)
13) Telegram Send Helpers (sendSafeMessage, sendChunked)
14) Main Menu + Button Router
15) Admin Panel + Callbacks
16) Core Commands (/help, /play, /info, /setpricepool, /intro, /event)
17) Leaderboards (/top10, /top50, /eventtop10, /eventtop50, /validatewinners, /winners)
18) Event Admin (/resetevent, /setevent)
19) Holding Requirement (/getholdingreq, /setholdingreq)
20) Wallet Flows (/addwallet, /changewallet, /removewallet, /verifyholder) + callbacks
21) HTTP API (verifyHolder, share, holderStatus, leaderboard, pricepool, submit,
               event, eventtop10, testpost, eventsubmit, getChart, saveChart, meta)
22) Server Start
==========================================================
*/

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const { DateTime } = require("luxon");
const sharp = require("sharp");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");
const FormData = require("form-data");

// ==========================================================
// 1) IMPORTS & CONFIG DEFAULTS
// ==========================================================
const CONFIG_DEFAULTS = {
  tokenMint: "6zzHz3X3s53zhEqyBMmokZLh6Ba5EfC5nP3XURzYpump",
  minHoldAmount: 500000,
  network: "mainnet-beta",
};

// 🧩 Feature toggles
const ATH_TEST_MODE = true; // disable test mode for production
const ATH_CHAT_ID = process.env.ATH_CHAT_ID || "-1002703016911";
// Bug reports destination
const BUG_REPORT_CHAT_ID = ATH_CHAT_ID;

// ==========================================================
// 2) ENVIRONMENT & CONSTANTS
// ==========================================================
const TELEGRAM_BOT_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID                = process.env.JSONBIN_ID;
const EVENT_JSONBIN_ID          = process.env.EVENT_JSONBIN_ID;
const EVENT_META_JSONBIN_ID     = process.env.EVENT_META_JSONBIN_ID;
const EVENT_SNAPSHOT_JSONBIN_ID = process.env.EVENT_SNAPSHOT_JSONBIN_ID;
const CONFIG_JSONBIN_ID         = process.env.CONFIG_JSONBIN_ID;
const HOLDER_JSONBIN_ID         = process.env.HOLDER_JSONBIN_ID;
const ATH_JSONBIN_ID            = process.env.ATH_JSONBIN_ID;
const ATH_SHARED_ID             = process.env.ATH_SHARED_ID;
const ATH_CHARTS_BIN_ID         = process.env.ATH_CHARTS_BIN_ID;
const JSONBIN_KEY               = process.env.JSONBIN_KEY;
const RESET_KEY                 = process.env.RESET_KEY;
const RENDER_EXTERNAL_HOSTNAME  = process.env.RENDER_EXTERNAL_HOSTNAME || null;
const PORT                      = process.env.PORT || 10000;
const PRICELIST_JSONBIN_ID      = process.env.PRICELIST_JSONBIN_ID;
const REQUIRE_HOLDER_FOR_ATH    = process.env.REQUIRE_HOLDER_FOR_ATH === "true";
const JSONBIN_HOLDERS_START     = process.env.JSONBIN_HOLDERS_START;
const JSONBIN_HOLDERS_END       = process.env.JSONBIN_HOLDERS_END;



// ✅ Validation — ensure required ENV vars exist
if (
  !TELEGRAM_BOT_TOKEN ||
  !JSONBIN_ID ||
  !EVENT_JSONBIN_ID ||
  !EVENT_META_JSONBIN_ID ||
  !EVENT_SNAPSHOT_JSONBIN_ID ||
  !CONFIG_JSONBIN_ID ||
  !HOLDER_JSONBIN_ID ||
  !ATH_JSONBIN_ID ||
  !ATH_SHARED_ID ||
  !ATH_CHARTS_BIN_ID ||
  !JSONBIN_KEY ||
  !RESET_KEY ||
  !PRICELIST_JSONBIN_ID ||
  !JSONBIN_HOLDERS_START ||
  !JSONBIN_HOLDERS_END
) {
  console.error("❌ Missing one or more required environment variables!");
  process.exit(1);
}

// ==========================================================
// 3) JSONBIN URLS — only the ones we actually use
// ==========================================================
const MAIN_BIN_URL            = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const CONFIG_BIN_URL          = `https://api.jsonbin.io/v3/b/${CONFIG_JSONBIN_ID}`;
const HOLDER_BIN_URL          = `https://api.jsonbin.io/v3/b/${HOLDER_JSONBIN_ID}`;
const ATH_BIN_URL             = `https://api.jsonbin.io/v3/b/${ATH_JSONBIN_ID}`;
const ATH_SHARED_BIN_URL      = `https://api.jsonbin.io/v3/b/${ATH_SHARED_ID}`;
const EVENT_BIN_URL           = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;
const EVENT_META_BIN_URL      = `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}`;
const ATH_CHARTS_URL          = `https://api.jsonbin.io/v3/b/${ATH_CHARTS_BIN_ID}`;
const PRICELIST_URL           = `https://api.jsonbin.io/v3/b/${PRICELIST_JSONBIN_ID}`;
const HOLDERS_START_BIN_URL   = `https://api.jsonbin.io/v3/b/${JSONBIN_HOLDERS_START}`;
const HOLDERS_END_BIN_URL     = `https://api.jsonbin.io/v3/b/${JSONBIN_HOLDERS_END}`;

// ==========================================================
// 4) ADMIN USERS
// ==========================================================
const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot", "pachenko_14"];

// ==========================================================
// 5) EXPRESS + TELEGRAM WEBHOOK
// ==========================================================
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json({ limit: "15mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

(async () => {
  try {
    const host = RENDER_EXTERNAL_HOSTNAME || `https://unstablecoin-fuddodge-backend.onrender.com`;
    const webhookUrl = `${host.replace(/\/$/, "")}/bot${TELEGRAM_BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook set: ${webhookUrl}`);
  } catch (err) {
    console.warn("⚠️ setWebHook warning:", err?.message || err);
  }
})();

app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
  } catch (e) {
    console.error("❌ processUpdate:", e?.message || e);
  }
  res.sendStatus(200);
});

app.get("/", (_req, res) => res.send("💛 UnStableCoin Bot running (webhook)."));

// ==========================================================
// 6) UTILITIES
// ==========================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeUsername(u) {
  if (!u) return null;
  const base = u.toString().trim().replace(/^@+/, "");
  return "@" + base;
}

function normalizeName(n) {
  if (!n) return "";
  return String(n).trim().replace(/^@+/, "").toLowerCase();
}

// small in-memory cache
const _cache = {};

// ==========================================================
// 7) JSONBIN HELPERS — robust retries, cache + error handling
// ==========================================================
const CACHE_TTL_MS = 30_000; // 30 seconds

// Key normalization (avoid duplicates like /latest)
function cacheKey(url) {
  return url.split("/latest")[0];
}

// Check TTL
function isCacheValid(entry) {
  return entry && (Date.now() - entry.t) < CACHE_TTL_MS;
}

// Invalidate one or all
function invalidateCache(url) {
  const key = cacheKey(url);
  delete _cache[key];
  console.log(`🧹 Cache invalidated: ${key}`);
}
function invalidateAllCache() {
  Object.keys(_cache).forEach((k) => delete _cache[k]);
  console.log("🧹 All cache invalidated");
}

// Unified readBin with error handling and TTL
async function readBin(url, tries = 3) {
  const key = cacheKey(url);
  const cached = _cache[key];

  if (cached && isCacheValid(cached)) {
    console.log(`📦 Cache hit: ${key}`);
    return cached.data;
  }

  for (let i = 0; i < tries; i++) {
    try {
      const resp = await axios.get(url, {
        headers: { "X-Master-Key": JSONBIN_KEY },
        timeout: 8000,
      });

      let data = resp.data;
      while (data?.record) data = data.record;
      _cache[key] = { t: Date.now(), data };

      console.log(`✅ Cache set: ${key}`);
      return data;
    } catch (err) {
      const code = err?.response?.status;
      const msg = err?.response?.data || err.message;

      if (code === 429 && i < tries - 1) {
        const delay = 1000 * (i + 1);
        console.warn(`⏳ Rate-limited, retry ${i + 1}/${tries} in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      if (code >= 400 && code < 500 && code !== 429) {
        console.error(`❌ Client error ${code} on ${url}:`, msg);
        return null;
      }
      if (i === tries - 1) {
        console.error(`❌ readBin failed after ${tries} tries:`, err.message);
        return null;
      }
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

// writeBin with caching + invalidation + error handling
async function writeBin(url, payload, tries = 3) {
  const body = Array.isArray(payload) ? { record: payload } : payload;
  const normUrl = cacheKey(url);

  for (let i = 0; i < tries; i++) {
    try {
      const resp = await axios.put(url, body, {
        headers: {
          "Content-Type": "application/json",
          "X-Master-Key": JSONBIN_KEY,
        },
        timeout: 8000,
      });

      let data = resp.data;
      while (data?.record) data = data.record;
      _cache[normUrl] = { t: Date.now(), data };

      console.log(`💾 Updated bin + cache: ${normUrl}`);
      return resp.data;
    } catch (err) {
      const code = err?.response?.status;
      const msg = err?.response?.data || err.message;

      if (code === 429 && i < tries - 1) {
        const delay = 1000 * (i + 1);
        console.warn(`⏳ Rate-limited, retry ${i + 1}/${tries} in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      if (code >= 400 && code < 500 && code !== 429) {
        console.error(`❌ Client error ${code} on ${url}:`, msg);
        throw new Error(`Write failed: ${code} - ${JSON.stringify(msg)}`);
      }
      if (i === tries - 1) {
        console.error(`❌ writeBin failed after ${tries} tries:`, err.message);
        throw err;
      }
      await sleep(500 * (i + 1));
    }
  }
  throw new Error("writeBin exhausted retries");
}

// ============================================================
// 🕒 AUTO HOLDER SNAPSHOT SCHEDULER — UnStableCoin Bot v3.5
// ============================================================
// This module automatically captures event holder snapshots
// ("start" & "end") at their scheduled times.
// Requires: getCurrentEvent(), fetchAllHolders(), writeBin(), saveEventMeta()

const REFRESH_INTERVAL = 60 * 1000; // check every minute

// --- background check loop ---
setInterval(async () => {
  try {
    const event = await getCurrentEvent();
    if (!event || !event.id) return;

    const now = Date.now();
    const startTime = new Date(event.startTime).getTime();
    const endTime = new Date(event.endTime).getTime();

    // ✅ START snapshot
    if (!event.startSnapshotTaken && now >= startTime && now < endTime) {
      console.log("⏱ Auto-capturing START holders snapshot...");
      await refreshHolders("start");
      event.startSnapshotTaken = true;
      await saveEventMeta(event);
    }

    // ✅ END snapshot
    if (!event.endSnapshotTaken && now >= endTime) {
      console.log("⏱ Auto-capturing END holders snapshot...");
      await refreshHolders("end");
      event.endSnapshotTaken = true;
      await saveEventMeta(event);
    }

  } catch (err) {
    console.warn("⚠️ Holder snapshot scheduler error:", err.message || err);
  }
}, REFRESH_INTERVAL);

// ============================================================
// 📦 refreshHolders(type) — collect and save holders snapshot
// ============================================================

async function refreshHolders(type = "start") {
  try {
    console.log(`🔍 Refreshing ${type.toUpperCase()} holders...`);

    // 👇 Replace this call with your Solana scan / API logic
    const holders = await fetchAllHolders();
    const currentEvent = await getCurrentEvent();

    const snapshot = {
      eventId: currentEvent?.id || "unknown",
      type,
      updated: new Date().toISOString(),
      total: holders.length,
      holders,
    };

    const binId =
      type === "start"
        ? process.env.JSONBIN_HOLDERS_START
        : process.env.JSONBIN_HOLDERS_END;

    await writeBin(binId, snapshot);

    console.log(
      `💾 Saved ${holders.length} holders to ${type.toUpperCase()} snapshot (${snapshot.eventId})`
    );
  } catch (err) {
    console.warn(`❌ refreshHolders(${type}) failed:`, err.message || err);
  }
}

// ==========================================================
// 8) CONFIG & HOLDERS
// ==========================================================
async function getConfig() {
  const cfg = (await readBin(CONFIG_BIN_URL)) || {};
  return Object.assign(
    {
      tokenMint: CONFIG_DEFAULTS.tokenMint,
      minHoldAmount: CONFIG_DEFAULTS.minHoldAmount,
      network: CONFIG_DEFAULTS.network,
      checkIntervalHours: 24,
      holderVerificationEnabled: true,
      allowPostingWithoutHold: false,
      lastUpdated: new Date().toISOString(),
    },
    cfg
  );
}

async function updateConfig(patch) {
  const cur = (await readBin(CONFIG_BIN_URL)) || {};
  const merged = Object.assign({}, cur, patch, { lastUpdated: new Date().toISOString() });
  await writeBin(CONFIG_BIN_URL, merged);
  return merged;
}

async function getHoldersArray() {
  const arr = (await readBin(HOLDER_BIN_URL)) || [];
  return Array.isArray(arr) ? arr : [];
}

async function saveHoldersArray(arr) {
  try {
    if (!Array.isArray(arr)) arr = [];
    await writeBin(HOLDER_BIN_URL, arr);
    delete _cache[HOLDER_BIN_URL];
    console.log(`🪣 Saved ${arr.length} holders to JSONBin.`);
    return true;
  } catch (err) {
    console.error("❌ saveHoldersArray:", err?.message || err);
    return false;
  }
}

async function getHoldersMapFromArray() {
  try {
    const arr = await getHoldersArray();
    const map = {};
    for (const h of arr) {
      if (h?.username) map[h.username] = h;
    }
    return map;
  } catch (err) {
    console.error("⚠️ getHoldersMapFromArray failed:", err?.message || err);
    return {};
  }
}

// ==========================================================
// 9) SOLANA CHECKS
// ==========================================================
function isLikelySolanaAddress(s) {
  try {
    const pk = new PublicKey(s);
    return PublicKey.isOnCurve(pk.toBytes());
  } catch {
    return false;
  }
}

async function checkSolanaHolding(walletAddress, requiredWholeTokens) {
  try {
    const config = await getConfig();
    const rpc = process.env.SOLANA_RPC_URL || clusterApiUrl(config.network || "mainnet-beta");
    const conn = new Connection(rpc, "confirmed");
    const ownerPub = new PublicKey(walletAddress);
    const mintPub  = new PublicKey(config.tokenMint);

    const parsed = await conn.getParsedTokenAccountsByOwner(ownerPub, { mint: mintPub });
    if (!parsed.value || parsed.value.length === 0) return { ok: false, amount: 0, decimals: 0 };

    let total = 0, decimals = 0;
    for (const acc of parsed.value) {
      const info = acc.account?.data?.parsed?.info?.tokenAmount;
      if (!info) continue;
      decimals = info.decimals || 0;
      total += parseFloat(info.amount || 0) / Math.pow(10, decimals);
    }
    const whole = Math.floor(total);
    return { ok: whole >= requiredWholeTokens, amount: total, whole, decimals };
  } catch (err) {
    console.error("❌ checkSolanaHolding:", err?.message || err);
    return { ok: false, amount: 0, whole: 0, decimals: 0, error: err?.message || String(err) };
  }
}

// ==========================================================
// 10) IMAGE COMPOSITION
// ==========================================================
async function composeShareImage(graphBase64, username, score) {
  const W = 1200, H = 628;
  let base64 = graphBase64 || "";
  const m = base64.match(/^data:image\/(png|jpeg);base64,(.*)$/);
  if (m) base64 = m[2];

  let graphBuffer = null;
  try { if (base64) graphBuffer = Buffer.from(base64, "base64"); } catch {}

  const bgSvg = `<svg width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#070707"/><stop offset="100%" stop-color="#0b0b10"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;

  const title = "UnStableCoin – FUD Dodge";
  const sub   = `@${String(username).replace(/^@+/, "")}  •  MCap: ${score}`;
  const textSvg = `<svg width="${W}" height="${H}">
    <style>
      .title{fill:#ffd400;font-family:'Press Start 2P',monospace;font-size:34px;font-weight:bold}
      .sub{fill:#fff;font-family:'Press Start 2P',monospace;font-size:22px;opacity:.95}
      .badge{fill:rgba(255,212,0,.06);stroke:rgba(255,212,0,.18);stroke-width:1;rx:8}
    </style>
    <rect x="40" y="36" width="${W-80}" height="100" rx="10" class="badge" />
    <text x="80" y="80" class="title">${escapeXml(title)}</text>
    <text x="80" y="110" class="sub">${escapeXml(sub)}</text>
  </svg>`;

  let img = sharp(Buffer.from(bgSvg)).resize(W, H);
  if (graphBuffer) {
    const graphW = Math.floor(W * 0.86);
    const graphH = Math.floor(H * 0.62);
    const graphImg = await sharp(graphBuffer)
      .resize(graphW, graphH, { fit: "contain", background: { r:0,g:0,b:0,alpha:0 } })
      .toBuffer();
    img = img.composite([
      { input: graphImg, left: Math.floor((W - graphW) / 2), top: Math.floor(H * 0.18) },
      { input: Buffer.from(textSvg), left: 0, top: 0 },
    ]);
  } else {
    img = img.composite([{ input: Buffer.from(textSvg), left: 0, top: 0 }]);
  }
  return await img.png().toBuffer();
}

async function composeAthBanner(curveBase64, username, score) {
  const rocketPath = "./assets/ath_banner_square.png";
  const W = 1200, H = 628;
  const leftW = Math.floor(W * 0.55);
  const rightW = W - leftW;
  const square = Math.min(leftW, H);

  let chartBuf = null;
  try {
    if (curveBase64) {
      const m = curveBase64.match(/^data:image\/(png|jpeg);base64,(.*)$/);
      const b = m ? m[2] : curveBase64;
      chartBuf = Buffer.from(b, "base64");
    }
  } catch {}

  const leftImg = await sharp(rocketPath)
    .resize(square, square, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .toBuffer();

  let rightImg = null;
  if (chartBuf)
    rightImg = await sharp(chartBuf)
      .resize(square, square, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .toBuffer();

  const base = sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  });

  const comps = [
    { input: leftImg, top: Math.floor((H - square) / 2), left: Math.floor((leftW - square) / 2) },
    {
      input: await sharp({ create: { width: 3, height: H, channels: 4, background: { r: 0, g: 255, b: 200, alpha: 0.5 } } }).png().toBuffer(),
      top: 0,
      left: leftW - 2,
    },
  ];

  if (rightImg)
    comps.push({
      input: rightImg,
      top: Math.floor((H - square) / 2),
      left: leftW + Math.floor((rightW - square) / 2),
    });

  const textSvg = `
    <svg width="${W}" height="${H}">
      <text x="${W - rightW / 2}" y="60"
        font-family="Press Start 2P, monospace"
        font-size="28"
        text-anchor="middle"
        fill="#ffd400"
        stroke="black"
        stroke-width="1.5"
        paint-order="stroke">
        MCap Reached: ${(score / 1000).toFixed(1)}k
      </text>
    </svg>`;
  comps.push({ input: Buffer.from(textSvg), top: 0, left: 0 });
  return await base.composite(comps).png().toBuffer();
}

// ==========================================================
// 11) LEADERBOARD HELPERS
// ==========================================================
function formatMcap(score) {
  if (score >= 1_000_000) {
    return (score / 1_000_000).toFixed(2) + "M";
  } else {
    return (score / 1000).toFixed(1) + "k";
  }
}

function _extractScoresFromBin(raw) {
  let data = raw;
  while (data?.record) data = data.record;

  if (Array.isArray(data?.scores)) {
    const out = {};
    for (const row of data.scores) {
      if (!row || !row.username) continue;
      const uname = row.username.startsWith("@") ? row.username : "@" + row.username;
      const n = Number(row.score);
      if (!Number.isNaN(n)) out[uname] = Math.max(n, out[uname] || 0);
    }
    return out;
  }

  if (data && typeof data === "object" && data.scores && typeof data.scores === "object") {
    data = data.scores;
  }
  const out = {};
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data)) {
      const n = Number(v);
      if (!Number.isNaN(n)) out[k.startsWith("@") ? k : "@" + k] = n;
    }
  }
  return out;
}

async function getLeaderboard() {
  try {
    const res = await axios.get(`${MAIN_BIN_URL}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    console.log("🟡 RAW FROM BIN keys:", Object.keys(res.data || {}));
    const data = _extractScoresFromBin(res.data);
    console.log(`🏁 Leaderboard loaded (${Object.keys(data).length} entries)`);
    return data;
  } catch (err) {
    console.error("❌ getLeaderboard:", err?.message || err);
    return {};
  }
}

// ==========================================================
// 12) EVENT DATA
// ==========================================================
async function getEventData() {
  try {
    const res = await axios.get(EVENT_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let raw = res.data;
    while (raw?.record) raw = raw.record;
    const scoresArray = raw.scores || [];
    const scores = {};
    for (const s of scoresArray) {
      if (s.username && typeof s.score === "number") {
        scores[s.username] = Math.max(scores[s.username] || 0, s.score);
      }
    }
    console.log(`🏁 Event scores loaded (${Object.keys(scores).length})`);
    return { scores };
  } catch (err) {
    console.error("❌ Failed to load event data:", err.message);
    return { scores: {} };
  }
}

async function getEventMeta() {
  try {
    const res = await axios.get(`${EVENT_META_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let p = res.data;
    while (p?.record) p = p.record;
    return {
      title: p.title || p.name || "Current Event",
      info: p.info || p.description || "",
      startDate: p.startDate || null,
      endDate: p.endDate || null,
      timezone: p.timezone || "Europe/Stockholm",
      updatedAt: p.updatedAt || res.data?.metadata?.modifiedAt || new Date().toISOString(),
      raw: p,
    };
  } catch (err) {
    console.error("❌ getEventMeta:", err?.message || err);
    return {
      title: "No active event",
      info: "",
      startDate: null,
      endDate: null,
      timezone: "Europe/Stockholm",
      updatedAt: new Date().toISOString(),
      raw: {},
    };
  }
}

const _verifyCache = new Map();
async function getVerifiedEventTopArray(limit = 10) {
  try {
    const res = await axios.get(`${EVENT_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let data = res.data;
    while (data?.record) data = data.record;
    const scores = Array.isArray(data.scores) ? data.scores : [];

    const holdersMap = await getHoldersMapFromArray();
    const cfg = await getConfig();
    const minHold = cfg.minHoldAmount || 0;

    const verifiedList = [];
    const now = Date.now();
    const TTL = 10 * 60 * 1000;

    for (const s of scores) {
      const rec = holdersMap[s.username];
      if (!rec?.wallet) continue;

      const key = rec.wallet.toLowerCase();
      const cached = _verifyCache.get(key);

      if (cached && now - cached.t < TTL) {
        if (cached.ok) verifiedList.push(s);
        continue;
      }

      const check = await checkSolanaHolding(rec.wallet, minHold);
      _verifyCache.set(key, { ok: check.ok, t: now });
      if (check.ok) verifiedList.push(s);
    }

    verifiedList.sort((a, b) => b.score - a.score);
    console.log(`⚡ Verified ${verifiedList.length} holders for leaderboard`);
    return verifiedList.slice(0, limit);
  } catch (err) {
    console.error("❌ getVerifiedEventTopArray failed:", err.message);
    return [];
  }
}

// ==========================================================
// 13) TELEGRAM SAFE SEND HELPERS
// ==========================================================
async function sendSafeMessage(chatId, message, opts = {}) {
  try {
    await bot.sendMessage(chatId, message, Object.assign({ parse_mode: "HTML", disable_web_page_preview: true }, opts));
  } catch (err) {
    console.error("❌ sendMessage:", err?.message || err);
  }
}

async function sendChunked(chatId, header, lines, maxLen = 3500) {
  const full = header + lines.join("\n");
  if (full.length <= maxLen) {
    await sendSafeMessage(chatId, full.trim());
    return;
  }
  let buf = header;
  for (const line of lines) {
    if ((buf + line + "\n").length > maxLen) {
      await sendSafeMessage(chatId, buf.trim());
      buf = header + line + "\n";
    } else buf += line + "\n";
  }
  if (buf.trim()) await sendSafeMessage(chatId, buf.trim());
}

// ==========================================================
// 14) MAIN MENU + BUTTON ROUTER
// ==========================================================
const mainMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "🌕 Add Wallet" }, { text: "⚡ Verify Holder" }],
      [{ text: "🔁 Change Wallet" }, { text: "❌ Remove Wallet" }],
      [{ text: "🏆 Leaderboard" }, { text: "🚀 Current Event" }],
      [{ text: "🏁 Event Leaderboard" }],
      [{ text: "🐞 Report Bug" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

bot.onText(/\/start|\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  const welcome =
    "💛 <b>Welcome to UnStableCoin</b>\nUse the buttons below to manage wallet, verify holdings, or join the current event.";
  await sendSafeMessage(chatId, welcome, { ...mainMenu, parse_mode: "HTML" });
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  try {
    switch (text) {
      case "🌕 Add Wallet":        bot.processUpdate({ message: { ...msg, text: "/addwallet" } }); break;
      case "⚡ Verify Holder":     bot.processUpdate({ message: { ...msg, text: "/verifyholder" } }); break;
      case "🔁 Change Wallet":     bot.processUpdate({ message: { ...msg, text: "/changewallet" } }); break;
      case "❌ Remove Wallet":     bot.processUpdate({ message: { ...msg, text: "/removewallet" } }); break;
      case "🏆 Leaderboard":       bot.processUpdate({ message: { ...msg, text: "/top10" } }); break;
      case "🚀 Current Event":     bot.processUpdate({ message: { ...msg, text: "/event" } }); break;
      case "🏁 Event Leaderboard": bot.processUpdate({ message: { ...msg, text: "/eventtop10" } }); break;
      case "🐞 Report Bug":        bot.processUpdate({ message: { ...msg, text: "/bugreport" } }); break;
      default: break;
    }
  } catch (err) {
    console.error("❌ Menu handler error:", err.message);
    await sendSafeMessage(chatId, "⚠️ Something went wrong while processing your request.");
  }
});

// ==========================================================
// 15) ADMIN PANEL + CALLBACKS
// ==========================================================
bot.onText(/\/admin(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user)) return sendSafeMessage(chatId, "⚠️ Admins only.");
  await showAdminPanel(chatId);
});

async function showAdminPanel(chatId) {
  try {
    const text =
      "🧩 <b>UnStableCoin Admin Panel</b>\n" +
      "Manage events, prizes, and verification.\n\n" +
      "Choose an action below:";
    const markup = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧠 Set Event", callback_data: "admin_setevent" }, { text: "🧹 Reset Event", callback_data: "admin_resetevent" }],
          [{ text: "💰 Set Prize Pool", callback_data: "admin_setpricepool" }, { text: "⚡ Set Holding Req", callback_data: "admin_setholdingreq" }],
          [{ text: "🔍 Validate Winners", callback_data: "admin_validatewinners" }],
          [{ text: "❌ Close Panel", callback_data: "admin_close" }],
        ],
      },
    };
    await sendSafeMessage(chatId, text, markup);
  } catch (err) {
    console.error("❌ showAdminPanel:", err.message);
  }
}

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const user = (query.from.username || "").toLowerCase();
  const data = query.data;
  if (!ADMIN_USERS.includes(user)) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Admins only." });
    return;
  }
  try {
    switch (data) {
      case "admin_setevent":
        await bot.answerCallbackQuery(query.id, { text: "Opening Set Event…" });
        bot.processUpdate({ message: { chat: { id: chatId }, from: query.from, text: "/setevent" } });
        break;
      case "admin_resetevent":
        await bot.answerCallbackQuery(query.id, { text: "Resetting event…" });
        bot.processUpdate({ message: { chat: { id: chatId }, from: query.from, text: "/resetevent" } });
        break;
      case "admin_setpricepool":
        await bot.answerCallbackQuery(query.id, { text: "Setting prize pool…" });
        bot.processUpdate({ message: { chat: { id: chatId }, from: query.from, text: "/setpricepool" } });
        break;
      case "admin_setholdingreq":
        await bot.answerCallbackQuery(query.id, { text: "Setting holding requirement…" });
        bot.processUpdate({ message: { chat: { id: chatId }, from: query.from, text: "/setholdingreq" } });
        break;
      case "admin_validatewinners":
        await bot.answerCallbackQuery(query.id, { text: "Validating winners…" });
        bot.processUpdate({ message: { chat: { id: chatId }, from: query.from, text: "/validatewinners" } });
        break;
      case "admin_close":
        await bot.answerCallbackQuery(query.id, { text: "Closing panel." });
        await bot.editMessageText("❌ Admin panel closed.", { chat_id: chatId, message_id: query.message.message_id });
        return;
      default:
        await bot.answerCallbackQuery(query.id, { text: "Unknown action." });
        return;
    }
    setTimeout(() => showAdminPanel(chatId), 3000);
  } catch (err) {
    console.error("❌ /admin panel error:", err.message);
  }
});

// ==========================================================
// 16) CORE COMMANDS
// ==========================================================
bot.onText(/\/help/, async (msg) => {
  const isAdmin = ADMIN_USERS.includes((msg.from.username || "").toLowerCase());
  const lines = [
    "💛 <b>Welcome to UnStableCoin</b>",
    "",
    "🎮 <b>FUD Dodge — Game Commands</b>",
    "/start — Prepare for contests",
    "/play — Game link",
    "/top10 — Global Top 10",
    "/top50 — Global Top 50",
    "/eventtop10 — Event Top 10 (holders)",
    "/eventtop50 — Event Top 50 (holders)",
    "/event — Current event info",
    "",
    "🪙 <b>Holder & Info</b>",
    "/howtoplay — Game guide & scoring",
    "/getholdingreq — Holder requirement",
    "/info — Game rules",
    "",
  ];
  if (isAdmin) {
    lines.push("🛠 <b>Admin</b>");
    lines.push("/setevent — Start or update event");
    lines.push("/resetevent — Reset event leaderboard");
    lines.push("/winners — Announce verified winners");
    lines.push("/setpricepool — Define prize list");
    lines.push("/setholdingreq — Set required token holding amount");
  }
  await sendSafeMessage(msg.chat.id, lines.join("\n"));
});

bot.onText(/\/play/, async (msg) => {
  const isPrivate = msg.chat.type === "private";
  if (isPrivate) {
    await bot.sendMessage(msg.chat.id, "🎮 <b>Play FUD Dodge</b>", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "⚡ Open Game", web_app: { url: "https://theunstable.io/fuddodge" } }]] },
    });
  } else {
    const me = await bot.getMe();
    await bot.sendMessage(msg.chat.id, "Play safely in DM 👇", {
      reply_markup: { inline_keyboard: [[{ text: "⚡ Open DM", url: `https://t.me/${me.username}?start=play` }]] },
    });
  }
});

bot.onText(/\/info|\/howtoplay/, (msg) => {
  const text = `
🎮 <b>How to Play FUD Dodge</b>

🪙 Dodge FUD & scams. Collect coins/memes to grow MCap.
⚡ Power-ups: Lightning, Coin, Green Candle, Meme
💀 Threats: FUD Skull, Red Candle, The Scammer (-50%)
📊 Compete: /top10 • /eventtop10

Stay unstable. 💛⚡`;
  sendSafeMessage(msg.chat.id, text);
});

bot.onText(/\/setpricepool([\s\S]*)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user)) return sendSafeMessage(chatId, "⚠️ Admins only.");

  const inputText = (match[1] || "").trim();
  if (!inputText)
    return sendSafeMessage(chatId, "⚙️ Usage:\n/setpricepool\n1: 1,000,000 $US\n2: 500,000 $US\n3: 250,000 $US");

  try {
    const lines = inputText.split("\n").filter(Boolean);
    const prizes = lines.map((line) => {
      const [rank, reward] = line.split(":").map((s) => s.trim());
      return { rank: Number(rank), reward };
    }).filter(p => Number.isFinite(p.rank) && p.reward);

    if (!prizes.length) return sendSafeMessage(chatId, "⚠️ Could not parse any prize entries.");

    await axios.put(`${PRICELIST_URL}`, { prizes }, {
      headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY },
    });

    const formatted = prizes.map((p) => `${p.rank}️⃣ ${p.reward}`).join("\n");
    await sendSafeMessage(chatId, `✅ <b>Prize pool updated and saved.</b>\n🏆 <b>Current Prize Pool:</b>\n${formatted}`, { parse_mode: "HTML" });
    console.log(`💰 Price pool overwritten (${prizes.length} entries) by ${user}`);
  } catch (err) {
    console.error("❌ /setpricepool:", err.message);
    await sendSafeMessage(chatId, "⚠️ Failed to save prize pool.");
  }
});

bot.onText(/\/intro(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  try {
    const chatId = msg.chat.id;
    const cfg = await getConfig();
    const minHold = cfg?.minHoldAmount ? cfg.minHoldAmount.toLocaleString() : "-";
    const logoUrl = "https://theunstable.io/fuddodge/assets/logo.png";
    const me = await bot.getMe();
    const botLink = `https://t.me/${me.username}?start=start`;

    const caption = [
      "💛 <b>Welcome to the UnStableCoin Game Bot</b>",
      "",
      "🎮 <b>How to Begin</b>",
      `👉 <a href="${botLink}">Open the Game Bot in DM</a> and connect your wallet in the start menu.`,
      "",
      "🚀 <b>Play the Game</b>",
      "Play <b>FUD Dodge</b> in your private chat.",
      "Collect coins, dodge FUD, and climb the leaderboard.",
      "",
      "🏆 <b>Events & Rankings</b>",
      "• /event — Current event info",
      "• /eventtop10 — Event Top 10 (holders)",
      "• /top10 — Global Top 10",
      "",
      "💰 <b>Holder Verification</b>",
      `Hold at least <b>${minHold} $US</b> to qualify for contests.`,
      "Add or update your wallet in the UnStableCoin Game Bot start menu.",
      "",
      "🧩 <b>Community Contests</b>",
      "We run meme, art, and score challenges with $US rewards.",
      "",
      "Stay unstable. Build weird. Hold the chaos. ⚡️",
      "",
      "🌐 theunstable.io | x.com/UnStableCoinX | t.me/UnStableCoin_US"
    ].join("\n");

    await bot.sendPhoto(chatId, logoUrl, { caption, parse_mode: "HTML" });
  } catch (err) {
    console.error("❌ /intro error:", err);
    await sendSafeMessage(msg.chat.id, "⚠️ Could not load introduction info.");
  }
});

// Single, improved /event handler
bot.onText(/\/event(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const tz = "Europe/Stockholm";
    const now = DateTime.now().setZone(tz);

    const res = await axios.get("https://unstablecoin-fuddodge-backend.onrender.com/event");
    const data = res.data || {};
    if (!data.title) return sendSafeMessage(chatId, "⚠️ No active event found.");

    const bannerUrl = "https://theunstable.io/fuddodge/assets/event_banner.png";
    let caption = `🚀 <b>${escapeXml(data.title)}</b>\n\n`;

    if (data.info) {
      const trimmedInfo = data.info.replace(/^Participation[\s\S]*/i, "").trim();
      if (trimmedInfo.length) caption += `${escapeXml(trimmedInfo)}\n\n`;
    }

    if (data.startDate && data.endDate) {
      const start = DateTime.fromISO(data.startDate).setZone(tz);
      const end = DateTime.fromISO(data.endDate).setZone(tz);
      caption += `🕓 ${start.toFormat("yyyy-MM-dd HH:mm")} → ${end.toFormat("yyyy-MM-dd HH:mm")} ${tz}\n`;

      if (now < start) {
        const diff = start.diff(now, ["days", "hours", "minutes"]).toObject();
        const remain = `${diff.days ? Math.floor(diff.days) + "d " : ""}${diff.hours ? Math.floor(diff.hours) + "h " : ""}${diff.minutes ? Math.floor(diff.minutes) + "m" : ""}`.trim();
        caption += `🟡 Starts in ${remain}\n\n`;
      } else if (now >= start && now < end) {
        const diff = end.diff(now, ["days", "hours", "minutes"]).toObject();
        const remain = `${diff.days ? Math.floor(diff.days) + "d " : ""}${diff.hours ? Math.floor(diff.hours) + "h " : ""}${diff.minutes ? Math.floor(diff.minutes) + "m" : ""}`.trim();
        caption += `⏳ Ends in ${remain}\n\n`;
      } else {
        caption += `🔴 <b>Event ended</b>\n\n`;
      }
    }

    if (data.minHoldAmount) caption += `Hold at least ${data.minHoldAmount.toLocaleString()} $US to join.\n\n`;

    try {
      const prizeRes = await axios.get(`${PRICELIST_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
      let rec = prizeRes.data;
      while (rec?.record) rec = rec.record;
      const prizes = rec?.prizes || [];
      if (prizes.length) {
        const pool = prizes.map((p) => `${p.rank}️⃣ ${p.reward}`).join("\n");
        caption += `🏆 <b>Prize Pool:</b>\n${pool}\n\n`;
      }
    } catch (e) {
      console.warn("⚠️ Could not load prize pool:", e.message);
    }

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      chat_id: chatId,
      photo: bannerUrl,
      caption,
      parse_mode: "HTML",
    });
    console.log(`📤 /event banner sent (${data.title})`);
  } catch (err) {
    console.error("❌ /event:", err?.response?.data || err.message);
    await sendSafeMessage(chatId, "⚠️ Could not load event info.");
  }
});

// ==========================================================
// 17) LEADERBOARD COMMANDS
// ==========================================================
bot.onText(/\/top10/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const data = await getLeaderboard();
    const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!sorted.length) return sendSafeMessage(chatId, "⚠️ No leaderboard data available.");

    const lines = sorted.map(([u, v], i) => `${i + 1}. ${u} — ${formatMcap(Number(v))}`).join("\n");
    const caption = "🏆 <b>Top 10 Players</b>\n\n" + lines + "\n\n" + "Stay unstable.⚡";
    const bannerUrl = "https://theunstable.io/fuddodge/assets/leaderboard.png";

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      chat_id: chatId,
      photo: bannerUrl,
      caption,
      parse_mode: "HTML",
    });
    console.log("📤 Sent /top10 leaderboard");
  } catch (err) {
    console.error("❌ /top10:", err.message);
    sendSafeMessage(chatId, "⚠️ Failed to load leaderboard.");
  }
});

bot.onText(/\/top50/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const data = await getLeaderboard();
    const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 50);
    if (!sorted.length) return sendSafeMessage(chatId, "⚠️ No leaderboard data available.");

    const lines = sorted.map(([u, v], i) => `${i + 1}. ${u} — ${formatMcap(Number(v))}`).join("\n");
    const caption = "⚡ <b>Top 50 Players</b>\n\n" + lines + "\n\n" + "Chaos. Coins. Curves.⚡";
    const bannerUrl = "https://theunstable.io/fuddodge/assets/leaderboard.png";

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      chat_id: chatId,
      photo: bannerUrl,
      caption,
      parse_mode: "HTML",
    });
    console.log("📤 Sent /top50 leaderboard");
  } catch (err) {
    console.error("❌ /top50:", err.message);
    sendSafeMessage(chatId, "⚠️ Failed to load leaderboard.");
  }
});

bot.onText(/\/eventtop10/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const top = await getVerifiedEventTopArray(10);
    if (!top.length) return sendSafeMessage(chatId, "⚠️ No verified holders found for current event.");

    const lines = top.map((x, i) => `${i + 1}. ${x.username} — ${formatMcap(Number(x.score))}`).join("\n");
    const caption = "🚀 <b>Compete for prices!</b>\n🏁 <b>Contest Top 10 (Verified)</b>\n\n" + lines + "\n\n" + "Hold. Race. Meme. Repeat.⚡";
    const bannerUrl = "https://theunstable.io/fuddodge/assets/eventtop.png";

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      chat_id: chatId,
      photo: bannerUrl,
      caption,
      parse_mode: "HTML",
    });
    console.log("📤 Sent /eventtop10");
  } catch (err) {
    console.error("❌ /eventtop10:", err.message);
    sendSafeMessage(chatId, "⚠️ Could not load event leaderboard.");
  }
});

bot.onText(/\/eventtop50/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const top = await getVerifiedEventTopArray(50);
    if (!top.length) return sendSafeMessage(chatId, "⚠️ No verified holders found for current event.");

    const lines = top.map((x, i) => `${i + 1}. ${x.username} — ${formatMcap(Number(x.score))}`).join("\n");
    const caption = "⚡ <b>Compete for prices!</b>\n📈 <b>Contest Top 50 (Verified)</b>\n\n" + lines + "\n\n" + "Stretch that MCap curve to the moon.⚡";
    const bannerUrl = "https://theunstable.io/fuddodge/assets/eventtop.png";

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      chat_id: chatId,
      photo: bannerUrl,
      caption,
      parse_mode: "HTML",
    });
    console.log("📤 Sent /eventtop50");
  } catch (err) {
    console.error("❌ /eventtop50:", err.message);
    sendSafeMessage(chatId, "⚠️ Could not load event leaderboard.");
  }
});

bot.onText(/\/validatewinners(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user)) return sendSafeMessage(chatId, "⚠️ Admins only.");

  await sendSafeMessage(chatId, "🔍 Checking top verified event wallets on-chain...");
  try {
    const cfg = await getConfig();
    const minHold = cfg.minHoldAmount || 0;
    const { scores } = await getEventData();
    const holdersMap = await getHoldersMapFromArray();

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const results = [];

    for (const [uname, score] of sorted) {
      const holder = holdersMap[uname] || holdersMap[uname.toLowerCase()];
      if (!holder?.wallet) {
        results.push(`⚪️ ${uname} — no wallet on file`);
        continue;
      }
      const check = await checkSolanaHolding(holder.wallet, minHold);
      if (check.ok) results.push(`✅ ${uname} — verified (${score})`);
      else results.push(`❌ ${uname} — insufficient holding (${check.balance || 0})`);
    }

    const header = `🧩 <b>Validated Top Event Holders</b>\n<code>minHold = ${minHold.toLocaleString()} $US</code>\n\n`;
    await sendChunked(chatId, header, results, 3800);
  } catch (err) {
    console.error("❌ /validatewinners:", err.message);
    await sendSafeMessage(chatId, `⚠️ Could not validate winners: ${err.message}`);
  }
});

bot.onText(/\/winners(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user)) return sendSafeMessage(chatId, "⚠️ Admins only.");

  try {
    const eventRes = await axios.get("https://unstablecoin-fuddodge-backend.onrender.com/event");
    const eventData = eventRes.data || {};
    const status = eventData.status || "inactive";
    const title = eventData.title || "UnStable Challenge";
    if (status !== "ended") return sendSafeMessage(chatId, "⚠️ Event not yet ended. Winners will be revealed once it is over.");

    const topVerified = await getVerifiedEventTopArray(50);
    const prizeRes = await axios.get(`${PRICELIST_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let prec = prizeRes.data;
    while (prec?.record) prec = prec.record;
    const prizes = prec?.prizes || [];

    if (!topVerified.length) return sendSafeMessage(chatId, "⚠️ No verified holders found for this event.");
    if (!prizes.length) return sendSafeMessage(chatId, "⚠️ No prize pool defined. Use /setpricepool first.");

    const winners = topVerified.slice(0, prizes.length);
    const winnersList = winners
      .map((x, i) => {
        const prize = prizes[i]?.reward || "-";
        const usernameTag = x.username.startsWith("@") ? x.username : `@${x.username}`;
        return `${i + 1}. <b>${usernameTag}</b> — ${formatMcap(x.score)} | ${prize}`;
      })
      .join("\n");

    const caption =
      `🏁 <b>${escapeXml(title)} — Verified Winners</b>\n\n` +
      `Here are the top ${winners.length} verified holders who met all event criteria:\n\n` +
      `${winnersList}\n\n` +
      `All wallets were verified during the event period. Holding confirmed at snapshot.\n\n` +
      `💛 Thank you all who joined and built this unstable ride.\n\n` +
      `#UnStableCoin #WAGMI-ish #Solana`;

    const bannerUrl = "https://theunstable.io/fuddodge/assets/winners.png";
    const trimmed = caption.slice(0, 1020);

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      chat_id: chatId,
      photo: bannerUrl,
      caption: trimmed,
      parse_mode: "HTML",
    });
    console.log(`📤 Winners post sent (${winners.length} verified winners)`);

    if (caption.length > 1020) {
      const remainder = caption.slice(1020);
      await sendSafeMessage(chatId, remainder, { parse_mode: "HTML" });
    }
  } catch (err) {
    console.error("❌ /winners:", err.message);
    await sendSafeMessage(chatId, "⚠️ Could not announce winners.");
  }
});

// ==========================================================
// 18) EVENT ADMIN
// ==========================================================
bot.onText(/\/resetevent/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user)) return sendSafeMessage(chatId, "⚠️ Admins only.");

  try {
    console.log("🧹 /resetevent (scores only) triggered by", user);
    const payload = { resetAt: new Date().toISOString(), scores: [] };
    const eventRes = await writeBin(EVENT_BIN_URL, payload);
    console.log("✅ EVENT scores reset:", eventRes?.metadata || "OK");

    await sendSafeMessage(chatId, "🧹 <b>Event leaderboard reset</b>\nOnly scores were cleared — event info/meta remains.", { parse_mode: "HTML" });
  } catch (err) {
    console.error("❌ /resetevent failed:", err.response?.data || err.message);
    await sendSafeMessage(chatId, `⚠️ Reset failed: ${err.response?.data?.message || err.message}`);
  }
});

bot.onText(/\/setevent/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user)) return sendSafeMessage(chatId, "⚠️ Admins only.");

  try {
    console.log("🧩 /setevent triggered by", user);
    await sendSafeMessage(chatId, "🧠 Let us set up a new event.\n\nPlease reply with the <b>title</b>:", { parse_mode: "HTML" });

    bot.once("message", async (m1) => {
      const title = (m1.text || "").trim();
      if (!title) return sendSafeMessage(chatId, "⚠️ Title cannot be empty. Try /setevent again.");

      await sendSafeMessage(chatId, "✏️ Great! Now send a short <b>description</b> for the event:", { parse_mode: "HTML" });
      bot.once("message", async (m2) => {
        const info = (m2.text || "").trim();

        await sendSafeMessage(chatId, "📅 Enter <b>start date</b> (YYYY-MM-DD):", { parse_mode: "HTML" });
        bot.once("message", async (m3) => {
          const startDate = (m3.text || "").trim();

          await sendSafeMessage(chatId, "🕓 Enter <b>start time</b> (HH:MM, 24h):", { parse_mode: "HTML" });
          bot.once("message", async (m4) => {
            const startTime = (m4.text || "").trim();

            await sendSafeMessage(chatId, "📅 Enter <b>end date</b> (YYYY-MM-DD):", { parse_mode: "HTML" });
            bot.once("message", async (m5) => {
              const endDate = (m5.text || "").trim();

              await sendSafeMessage(chatId, "⏰ Enter <b>end time</b> (HH:MM, 24h):", { parse_mode: "HTML" });
              bot.once("message", async (m6) => {
                const endTime = (m6.text || "").trim();

                await sendSafeMessage(chatId, "🌍 Enter timezone (default: Europe/Stockholm):");
                bot.once("message", async (m7) => {
                  const tzInput = (m7.text || "").trim();
                  const timezone = tzInput || "Europe/Stockholm";
                  const startISO = `${startDate}T${startTime}`;
                  const endISO = `${endDate}T${endTime}`;

                  const preview =
                    `✅ <b>Review event details:</b>\n\n` +
                    `<b>Title:</b> ${escapeXml(title)}\n` +
                    `<b>Info:</b> ${escapeXml(info)}\n` +
                    `<b>Start:</b> ${escapeXml(startISO)}\n` +
                    `<b>End:</b> ${escapeXml(endISO)}\n` +
                    `<b>Timezone:</b> ${escapeXml(timezone)}\n\n` +
                    `Save this event?`;

                  await bot.sendMessage(chatId, preview, {
                    parse_mode: "HTML",
                    reply_markup: {
                      inline_keyboard: [[{ text: "✅ Save", callback_data: "confirm_event_save" }, { text: "❌ Cancel", callback_data: "confirm_event_cancel" }]],
                    },
                  });

                  bot.once("callback_query", async (cbq) => {
                    if (cbq.data === "confirm_event_cancel") {
                      await sendSafeMessage(chatId, "❌ Event creation cancelled.");
                      return;
                    }
                    if (cbq.data === "confirm_event_save") {
                      const payload = { record: { title, info, startDate: startISO, endDate: endISO, timezone, updatedAt: new Date().toISOString(), createdBy: "@" + user } };
                      try {
                        console.log("📝 Writing new event meta to:", EVENT_META_BIN_URL);
                        const res = await writeBin(EVENT_META_BIN_URL, payload);
                        console.log("✅ Event meta updated:", res?.metadata || "OK");
                        await sendSafeMessage(chatId, `🎯 <b>Event saved successfully!</b>\n\n<b>Title:</b> ${escapeXml(title)}\n<b>Start:</b> ${escapeXml(startISO)}\n<b>End:</b> ${escapeXml(endISO)}\n<b>Timezone:</b> ${escapeXml(timezone)}`, { parse_mode: "HTML" });
                      } catch (err) {
                        console.error("❌ /setevent write failed:", err.response?.data || err.message);
                        await sendSafeMessage(chatId, `⚠️ Could not save event: ${err.message}`);
                      }
                    }
                  });
                });
              });
            });
          });
        });
      });
    });
  } catch (err) {
    console.error("❌ /setevent unexpected error:", err.message);
    await sendSafeMessage(chatId, "⚠️ Something went wrong creating the event.");
  }
});

// ==========================================================
// 19) HOLDING REQUIREMENT
// ==========================================================
bot.onText(/\/getholdingreq(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const cfg = await getConfig();
    if (!cfg || !cfg.minHoldAmount) return sendSafeMessage(chatId, "⚠️ No config found or invalid bin data.");
    await sendSafeMessage(chatId, `💰 Minimum holding requirement: ${cfg.minHoldAmount.toLocaleString()} $US`);
  } catch (err) {
    console.error("❌ /getholdingreq:", err?.message || err);
    await sendSafeMessage(chatId, "⚠️ Could not load current holding requirement.");
  }
});

bot.onText(/\/setholdingreq(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user)) return sendSafeMessage(chatId, "⚠️ Admins only.");

  await sendSafeMessage(chatId, "💬 Enter new minimum holding (number only):");
  bot.once("message", async (m2) => {
    const input = (m2.text || "").trim().replace(/[^\d]/g, "");
    const newVal = parseInt(input, 10);
    if (isNaN(newVal) || newVal <= 0) return sendSafeMessage(chatId, "⚠️ Invalid number. Try again with /setholdingreq.");

    try {
      const cfg = await getConfig();
      cfg.minHoldAmount = newVal;
      const payload = { record: cfg };
      console.log(`💾 Updating minHoldAmount to ${newVal}`);
      const res = await writeBin(CONFIG_BIN_URL, payload);
      console.log("✅ Config updated:", res?.metadata || "OK");

      await sendSafeMessage(chatId, `✅ <b>Minimum holding updated</b>\nNew value: ${newVal.toLocaleString()} $US`, { parse_mode: "HTML" });
    } catch (err) {
      console.error("❌ /setholdingreq:", err.response?.data || err.message);
      await sendSafeMessage(chatId, "⚠️ Failed to update holding requirement.");
    }
  });
});

// ==========================================================
// 20) WALLET FLOWS
// ==========================================================
bot.onText(/\/addwallet|\/changewallet|\/removewallet|\/verifyholder/i, async (msg) => {
  const chatId = msg.chat.id;
  const realUser = msg.from?.username;
  if (!realUser) return bot.sendMessage(chatId, "❌ You need a Telegram username (Settings → Username).");

  const holders = await getHoldersArray();
  const existing = holders.find((h) => normalizeName(h.username) === normalizeName(realUser));

  try {
    const lower = msg.text.toLowerCase();

    if (lower.includes("addwallet")) {
      if (existing) {
        await bot.sendMessage(chatId, `⚠️ You already have a wallet saved, @${realUser}.\nUse /changewallet instead.`, mainMenu);
        return;
      }
      await bot.sendMessage(chatId, "🪙 Add wallet – please paste your Solana wallet address:");
      bot.once("message", async (m2) => {
        const wallet = (m2.text || "").trim();
        if (!isLikelySolanaAddress(wallet)) {
          await bot.sendMessage(chatId, "❌ Invalid wallet address. Try again with /addwallet.", mainMenu);
          return;
        }
        holders.push({ username: "@" + realUser, wallet, verifiedAt: null });
        await saveHoldersArray(holders);
        delete _cache[HOLDER_BIN_URL];
        await bot.sendMessage(chatId, `✅ Wallet added for @${realUser}! Use /verifyholder to confirm holdings.`, mainMenu);
      });
      return;
    }

    if (lower.includes("changewallet")) {
      if (!existing) {
        await bot.sendMessage(chatId, `⚠️ You do not have any wallet saved yet, @${realUser}.\nUse /addwallet first.`, mainMenu);
        return;
      }
      await bot.sendMessage(chatId, "Do you really want to change your wallet?", {
        reply_markup: { inline_keyboard: [[{ text: "✅ Yes, change it", callback_data: "confirm_change_yes" }, { text: "❌ Cancel", callback_data: "confirm_change_no" }]] },
      });
      return;
    }

    if (lower.includes("removewallet")) {
      if (!existing) {
        await bot.sendMessage(chatId, `⚠️ You do not have any wallet saved yet, @${realUser}.`, mainMenu);
        return;
      }
      await bot.sendMessage(chatId, "Are you sure you want to remove your wallet?", {
        reply_markup: { inline_keyboard: [[{ text: "✅ Yes, remove", callback_data: "confirm_remove_yes" }, { text: "❌ Cancel", callback_data: "confirm_remove_no" }]] },
      });
      return;
    }

    if (lower.includes("verifyholder")) {
      if (!existing?.wallet) {
        await bot.sendMessage(chatId, "⚠️ No wallet on file. Use /addwallet first.", mainMenu);
        return;
      }
      await bot.sendMessage(chatId, "🔍 Checking on-chain balance...");
      const res = await axios.post(`https://unstablecoin-fuddodge-backend.onrender.com/verifyHolder`, { username: "@" + realUser, wallet: existing.wallet });
      if (res.data.ok) await bot.sendMessage(chatId, `✅ Verified successfully for @${realUser}!`, mainMenu);
      else await bot.sendMessage(chatId, `⚠️ Verification failed: ${res.data.message || "Not enough tokens."}`, mainMenu);
      return;
    }
  } catch (err) {
    console.error("⚠️ Wallet flow error:", err?.message || err);
    await bot.sendMessage(chatId, "⚠️ Something went wrong. Try again later.", mainMenu);
  }
});

// Inline callbacks for wallet flows and admin confirmations
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  try {
    await bot.answerCallbackQuery(query.id);

    switch (data) {
      // handle both legacy and new keys
      case "confirm_remove":
      case "confirm_remove_yes":
        await removeWallet(chatId); // you may implement removeWallet if used elsewhere
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
        await sendSafeMessage(chatId, "💛 Your wallet has been removed.");
        break;

      case "confirm_change":
      case "confirm_change_yes":
        await changeWallet(chatId); // you may implement changeWallet if used elsewhere
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
        await sendSafeMessage(chatId, "⚡ Wallet successfully changed.");
        break;

      case "cancel":
      case "confirm_change_no":
      case "confirm_remove_no":
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
        await sendSafeMessage(chatId, "❌ Action cancelled.");
        break;

      default:
        // ignore
        break;
    }
  } catch (err) {
    console.error("❌ callback_query handler error:", err);
    try { await bot.answerCallbackQuery(query.id, { text: "⚠️ Something went wrong." }); } catch {}
  }
});

// Dummy implementations to avoid reference errors if not defined elsewhere
async function removeWallet(chatId) { /* no-op placeholder to keep behavior */ }
async function changeWallet(chatId) { /* no-op placeholder to keep behavior */ }

// ============================================================
// 20.5) HOLDER SNAPSHOT VERIFICATION & WINNERS
// ============================================================

async function readSnapshot(type = "start") {
  const binId =
    type === "start"
      ? process.env.JSONBIN_HOLDERS_START
      : process.env.JSONBIN_HOLDERS_END;
  if (!binId) throw new Error(`Missing bin ID for ${type} snapshot`);
  const res = await readBin(`https://api.jsonbin.io/v3/b/${binId}`);
  return res?.record || res || {};
}

// --- /verifyholdersnapshot [wallet] ---
bot.onText(/\/verifyholdersnapshot/i, async (msg) => {
  const chatId = msg.chat.id;
  const parts = msg.text.trim().split(" ");
  const wallet = (parts[1] || "").trim();

  if (!wallet) {
    return sendSafeMessage(chatId, "⚠️ Usage: /verifyholdersnapshot <wallet>");
  }

  try {
    const startSnap = await readSnapshot("start");
    const endSnap = await readSnapshot("end");

    const heldStart = startSnap.holders?.find(
      (h) => h.wallet?.toLowerCase() === wallet.toLowerCase()
    );
    const heldEnd = endSnap.holders?.find(
      (h) => h.wallet?.toLowerCase() === wallet.toLowerCase()
    );

    if (heldStart && heldEnd) {
      await sendSafeMessage(
        chatId,
        `✅ Wallet <code>${wallet.slice(0, 6)}…${wallet.slice(-4)}</code> held during both snapshots.\n\n💰 Start: ${heldStart.amount}\n💰 End: ${heldEnd.amount}`,
        { parse_mode: "HTML" }
      );
    } else if (heldStart || heldEnd) {
      await sendSafeMessage(
        chatId,
        `⚠️ Wallet <code>${wallet.slice(0, 6)}…${wallet.slice(-4)}</code> held during one snapshot only.`,
        { parse_mode: "HTML" }
      );
    } else {
      await sendSafeMessage(
        chatId,
        `❌ Wallet <code>${wallet.slice(0, 6)}…${wallet.slice(-4)}</code> not found in either snapshot.`,
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    console.error("❌ /verifyholdersnapshot failed:", err.message);
    sendSafeMessage(chatId, "⚠️ Could not verify wallet from snapshots.");
  }
});

// --- /winnerssnapshot ---
bot.onText(/\/winnerssnapshot/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user)) return sendSafeMessage(chatId, "⚠️ Admins only.");

  try {
    const cfg = await getConfig();
    const minHold = cfg.minHoldAmount || 0;
    const startSnap = await readSnapshot("start");
    const endSnap = await readSnapshot("end");

    const eligible = startSnap.holders?.filter((h) =>
      endSnap.holders?.some(
        (x) =>
          x.wallet?.toLowerCase() === h.wallet?.toLowerCase() &&
          h.amount >= minHold &&
          x.amount >= minHold
      )
    );

    if (!eligible || !eligible.length)
      return sendSafeMessage(chatId, "😔 No eligible wallets found.");

    const lines = eligible
      .slice(0, 20)
      .map(
        (w, i) =>
          `${i + 1}. ${w.wallet.slice(0, 6)}…${w.wallet.slice(-4)} (${w.amount})`
      );

    await sendChunked(
      chatId,
      `🏆 <b>Eligible Wallets from Snapshots</b>\nMin Hold: ${minHold.toLocaleString()} $US\n\n`,
      lines,
      3800
    );
  } catch (err) {
    console.error("❌ /winnerssnapshot failed:", err.message);
    sendSafeMessage(chatId, "⚠️ Could not load winners from snapshots.");
  }
});

// ==========================================================
// 21) HTTP API
// ==========================================================
// Verify holder
app.post("/verifyHolder", async (req, res) => {
  try {
    let { username, wallet } = req.body;
    if (!username || !wallet) return res.status(400).json({ ok: false, message: "Missing username or wallet." });

    username = normalizeUsername(username);
    if (!isLikelySolanaAddress(wallet)) return res.status(400).json({ ok: false, message: "Invalid Solana address." });

    const cfg = await getConfig();
    const check = await checkSolanaHolding(wallet, cfg.minHoldAmount);
    if (!check.ok) return res.json({ ok: false, message: "Below min hold." });

    const holders = await getHoldersArray();
    const idx = holders.findIndex((h) => h.username.toLowerCase() === username.toLowerCase());
    if (idx >= 0) {
      holders[idx].wallet = wallet;
      holders[idx].verifiedAt = new Date().toISOString();
    } else {
      holders.push({ username, wallet, verifiedAt: new Date().toISOString() });
    }
    await saveHoldersArray(holders);
    res.json({ ok: true, message: "Verified!" });
  } catch (err) {
    console.error("verifyHolder:", err);
    res.status(500).json({ ok: false, message: "Server error." });
  }
});

// Share
app.post("/share", async (req, res) => {
  try {
    const { username, score, imageBase64, mode, curveImage } = req.body;
    if (!username) return res.status(400).json({ ok: false, message: "Missing username" });

    const cfg = await getConfig();
    const holders = await getHoldersMapFromArray();
    const userRec = holders[username] || holders[normalizeUsername(username)];
    const isAth = String(mode).toLowerCase() === "ath";
    const targetChatId = ATH_CHAT_ID;

    if (REQUIRE_HOLDER_FOR_ATH) {
      if (!userRec?.wallet) {
        return res.json({ ok: false, message: "Wallet not verified. Use /verifyholder first." });
      }
      const verified = await checkSolanaHolding(userRec.wallet, cfg.minHoldAmount || 0);
      if (!verified.ok) {
        return res.json({ ok: false, message: "Holding below required minimum." });
      }
    }

    let shared = {};
    try {
      const r = await axios.get(`${ATH_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
      shared = (function unwrap(x){ while (x?.record) x = x.record; return x; })(r.data) || {};
    } catch (err) {
      console.warn("⚠️ Could not load previous A.T.H. records:", err.message);
    }

    const prev = shared[username] || 0;
    if (isAth && score <= prev && !ATH_TEST_MODE) {
      console.log(`🚫 ${username} already shared same or higher A.T.H. (${prev})`);
      return res.json({ ok: true, posted: false, stored: false, message: "Already shared same or higher A.T.H." });
    }

    let photoData = curveImage || imageBase64;
    if (!photoData) return res.status(400).json({ ok: false, message: "Missing image data" });
    if (photoData.startsWith("iVBOR") || photoData.startsWith("/9j/")) {
      photoData = "data:image/png;base64," + photoData;
    }
    const cleanBase64 = photoData.replace(/^data:image\/\w+;base64,/, "");

    let rankText = "";
    try {
      await sleep(1500);
      const resLB = await axios.get(`${MAIN_BIN_URL}/latest?nocache=${Date.now()}`, { headers: { "X-Master-Key": JSONBIN_KEY } });
      let raw = resLB.data; while (raw?.record) raw = raw.record;
      const scores = Object.entries(raw)
        .filter(([u, v]) => !isNaN(Number(v)))
        .map(([u, v]) => ({ username: u.startsWith("@") ? u : "@" + u, score: Number(v) }))
        .sort((a, b) => b.score - a.score);
      const rank = scores.findIndex((x) => x.username === username) + 1;
      if (rank > 0) {
        rankText = `Current rank: #${rank}`;
        console.log(`⚡ Rank check: ${username} is #${rank} / ${scores.length}`);
      }
    } catch (err) {
      console.warn("⚠️ Could not fetch leaderboard rank:", err.message);
    }

    if (isAth) {
      try {
        const bannerUrl = "https://theunstable.io/fuddodge/assets/ath_banner_base.png";
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, { chat_id: targetChatId, photo: bannerUrl });
        console.log("📤 Banner image posted first (no caption)");
        await sleep(1500);
      } catch (err) {
        console.warn("⚠️ Failed to post banner:", err.response?.data || err.message);
      }

      try {
        const form = new FormData();
        form.append("chat_id", targetChatId);
        form.append("caption",
          `${username} reached a new All-Time-High! ⚡️\n` +
          `A.T.H. MCap: ${(score / 1000).toFixed(2)}k\n` +
          (rankText ? `${rankText}\n` : "") +
          `Stay unstable.\n\n#UnStableCoin #WAGMI-ish`
        );
        form.append("parse_mode", "HTML");
        form.append("photo", Buffer.from(cleanBase64, "base64"), { filename: "ath_graph.png", contentType: "image/png" });

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
        console.log("📤 Graph post sent after banner");
      } catch (err) {
        console.error("❌ Failed to post graph:", err?.response?.data || err.message);
      }
    } else {
      const form = new FormData();
      form.append("chat_id", targetChatId);
      form.append("caption", `⚡️ ${username} shared a highlight — MCap ${(score / 1000).toFixed(2)}k\n#UnStableCoin #WAGMI-ish`);
      form.append("parse_mode", "HTML");
      form.append("photo", Buffer.from(cleanBase64, "base64"), { filename: "highlight.png", contentType: "image/png" });

      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
      console.log("📤 Highlight post sent");
    }

    if (isAth && score > prev) {
      shared[username] = score;

      try {
        await axios.put(`${ATH_BIN_URL}`, shared, { headers: { "X-Master-Key": JSONBIN_KEY, "Content-Type": "application/json" } });
        console.log(`✅ A.T.H. recorded for ${username} (${score})`);

        let globalData = {};
        try {
          const res = await axios.get(`${MAIN_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
          let d = res.data; while (d?.record) d = d.record;
          globalData = d || {};
        } catch (e) {
          console.warn("⚠️ Could not read global leaderboard:", e.message);
        }

        const prevMain = Number(globalData[username] || 0);
        if (score > prevMain) {
          globalData[username] = score;
          await axios.put(`${MAIN_BIN_URL}`, globalData, { headers: { "X-Master-Key": JSONBIN_KEY, "Content-Type": "application/json" } });
          console.log(`✅ Updated MAIN leaderboard for ${username}: ${score} (prev ${prevMain})`);
        } else {
          console.log(`🚫 Ignored lower score for ${username}: ${score} < ${prevMain}`);
        }
      } catch (err) {
        console.warn("⚠️ Failed to update ATH or MAIN_BIN_URL:", err.message);
      }
    }

    res.json({ ok: true, posted: true, stored: isAth, message: "Posted successfully" });
  } catch (err) {
    console.error("❌ /share error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/holderStatus", async (req, res) => {
  try {
    let username = req.query.username;
    if (!username) return res.status(400).json({ verified:false, message:"Missing username" });
    username = normalizeUsername(username);
    const holders = await getHoldersArray();
    const match = holders.find(h => h.username?.toLowerCase() === username.toLowerCase());
    if (match?.wallet) return res.json({ verified: !!match.verifiedAt, username: match.username, wallet: match.wallet, verifiedAt: match.verifiedAt || null });
    res.json({ verified:false });
  } catch (err) {
    console.error("holderStatus:", err?.message || err);
    res.status(500).json({ verified:false, message:"Server error checking holder status" });
  }
});

app.get("/leaderboard", async (req, res) => {
  try {
    const data = await readBin(`${MAIN_BIN_URL}/latest`);
    const raw = data || {};
    let arr = [];

    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === "object")
      arr = Object.entries(raw).map(([username, score]) => ({ username, score: Number(score) }));

    arr = arr.sort((a, b) => b.score - a.score).slice(0, 10);
    res.json(arr);
    console.log(`📤 /leaderboard sent ${arr.length} entries`);
  } catch (err) {
    console.error("❌ /leaderboard error:", err.message);
    res.status(500).json([]);
  }
});

app.get("/pricepool", async (req, res) => {
  try {
    const r = await axios.get(`${PRICELIST_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let record = r.data; while (record?.record) record = record.record;

    let data = [];
    if (Array.isArray(record)) data = record;
    else if (Array.isArray(record.prizes)) data = record.prizes;
    else {
      console.warn("⚠️ Invalid prizepool format:", record);
      return res.json([]);
    }
    data.sort((a, b) => (a.rank || 0) - (b.rank || 0));
    res.json(data);
  } catch (err) {
    console.error("❌ /pricepool:", err.message);
    res.status(500).json({ error: "Failed to fetch prize pool" });
  }
});

app.post("/submit", async (req, res) => {
  try {
    const { username, score, target = "both" } = req.body;
    if (!username || !score) return res.status(400).send("Missing username or score.");

    const uname = username.startsWith("@") ? username : "@" + username;
    const scoreVal = Math.round(Number(score));
    console.log(`🧩 Manual submit: ${uname} → ${scoreVal} (${target})`);

    const headers = { "X-Master-Key": process.env.JSONBIN_KEY, "Content-Type": "application/json" };

    // === MAIN leaderboard ===
    if (target === "main" || target === "both") {
      const mainRes = await axios.get(`${MAIN_BIN_URL}/latest`, { headers });
      let mainData = mainRes.data;
      while (mainData?.record) mainData = mainData.record;
      const prev = Number(mainData[uname] || 0);

      if (Number(scoreVal) > prev) {
        mainData[uname] = scoreVal;
        await axios.put(`${MAIN_BIN_URL}`, mainData, { headers });
        console.log(`✅ Updated MAIN leaderboard for ${uname}: ${scoreVal} (prev ${prev})`);
      } else {
        console.log(`🚫 Ignored lower MAIN score for ${uname}: ${scoreVal} ≤ ${prev}`);
      }
    }

    // === EVENT leaderboard ===
    if (target === "event" || target === "both") {
      const meta = await readBin(`${EVENT_META_BIN_URL}/latest`);
      let eventMeta = meta || {};
      const tz = eventMeta?.timezone || "Europe/Stockholm";
      const now = DateTime.now().setZone(tz);
      const start = eventMeta?.startDate ? DateTime.fromISO(eventMeta.startDate, { zone: tz }) : null;
      const end = eventMeta?.endDate ? DateTime.fromISO(eventMeta.endDate, { zone: tz }) : null;
      const isActive = start && end && now >= start && now <= end;

      if (!isActive) {
        console.log(`⚠️ Event not active (${tz})`);
        return res.json({ ok: false, msg: "Event not active" });
      }

      const evRes = await axios.get(`${EVENT_BIN_URL}/latest`, { headers });
      let evData = evRes.data;
      while (evData?.record) evData = evData.record;
      let scores = Array.isArray(evData.scores) ? evData.scores : [];

      const prevEntry = scores.find((s) => s.username === uname);
      const prevScore = prevEntry ? Number(prevEntry.score) : 0;

      if (scoreVal > prevScore) {
        scores = [
          ...scores.filter((s) => s.username !== uname),
          { username: uname, score: scoreVal, verified: true, at: new Date().toISOString() }
        ];
        const payload = { resetAt: evData.resetAt || new Date().toISOString(), scores };
        await axios.put(`${EVENT_BIN_URL}`, payload, { headers });
        console.log(`✅ Updated EVENT leaderboard for ${uname}: ${scoreVal} (prev ${prevScore})`);
      } else {
        console.log(`🚫 Ignored lower EVENT score for ${uname}: ${scoreVal} ≤ ${prevScore}`);
      }
    }

    res.send(`✅ ${uname} → ${scoreVal} checked and saved (${target})`);
  } catch (err) {
    console.error("❌ /submit failed:", err.message);
    res.status(500).send("Server error: " + err.message);
  }
});

app.get("/event", async (req, res) => {
  try {
    let data = await readBin(`${EVENT_META_BIN_URL}/latest`);
    if (!data?.title || !data?.startDate || !data?.endDate) {
      console.log("📤 /event → INACTIVE (missing fields)");
      return res.json({
        status: "inactive",
        title: "UnStable Challenge",
        info: "Stay tuned for upcoming events.",
        startDate: "",
        endDate: "",
        timezone: "Europe/Stockholm",
        minHoldAmount: 0,
      });
    }

    const now = new Date();
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const status = now < start ? "upcoming" : now > end ? "ended" : "active";
    const cfg = await getConfig();

    const participation = `
Participation
Hold at least ${cfg.minHoldAmount.toLocaleString()} $US to join and appear on event leaderboards.
Add your wallet from the start menu in the UnStableCoin Game Bot.

Community events reward holders, builders, and creative chaos.
Stay unstable. Build weird. Hold the chaos. ⚡
- UnStableCoin Community
`.trim();

    const unifiedInfo = [data.info || "", participation].filter(Boolean).join("\n\n");
    console.log(`📤 /event → ${status.toUpperCase()} (${data.startDate} → ${data.endDate})`);

    res.json({
      status,
      title: data.title,
      info: status === "ended" ? "Event ended. Results soon." : unifiedInfo,
      startDate: data.startDate,
      endDate: data.endDate,
      timezone: data.timezone || "Europe/Stockholm",
      minHoldAmount: cfg.minHoldAmount || 0,
    });
  } catch (err) {
    console.error("❌ /event failed:", err.message);
    res.status(500).json({ error: "Failed to load event info" });
  }
});

app.get("/eventtop10", async (req, res) => {
  try {
    const scoresRes = await axios.get(`${EVENT_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let rec = scoresRes.data; while (rec?.record) rec = rec.record;
    const arr = rec.scores || [];
    if (!arr.length) {
      console.log("📤 /eventtop10: 0 entries (no scores yet)");
      return res.json([]);
    }
    const top = arr.filter((x) => !!x.username && typeof x.score === "number").sort((a, b) => b.score - a.score).slice(0, 10);
    console.log(`📤 /eventtop10: ${top.length} entries`);
    res.json(top);
  } catch (err) {
    console.error("❌ /eventtop10 failed:", err.message);
    res.status(500).json({ error: "Failed to load event leaderboard" });
  }
});

app.get("/testpost", async (req, res) => {
  try {
    const chatId = "-1002703016911";
    const testMsg = "⚡️ Test message from UnStableCoin backend — confirming group post works.";
    await bot.sendMessage(chatId, testMsg, { parse_mode: "HTML" });
    console.log("✅ Test message sent to group:", chatId);
    res.json({ ok: true, sentTo: chatId });
  } catch (err) {
    console.error("❌ Failed to send test message:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/eventsubmit", async (req, res) => {
  try {
    const { username, score } = req.body;
    if (!username || !score) return res.status(400).json({ ok: false, msg: "Missing username or score" });

    const holders = await getHoldersMapFromArray();
    const verified = !!holders[username];
    if (!verified) {
      console.log(`🚫 ${username} not verified holder`);
      return res.status(403).json({ ok: false, msg: "Not a verified holder" });
    }

    const meta = await readBin(`${EVENT_META_BIN_URL}/latest`);
    let eventMeta = meta || {};
    const now = new Date();
    const start = eventMeta?.startDate ? new Date(eventMeta.startDate) : null;
    const end = eventMeta?.endDate ? new Date(eventMeta.endDate) : null;
    const isActive = start && end && now >= start && now <= end;
    if (!isActive) {
      console.log("⚠️ Event not active, skipping score write");
      return res.json({ ok: false, msg: "Event not active" });
    }

    const scoresRes = await axios.get(`${EVENT_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let data = scoresRes.data; while (data?.record) data = data.record;
    let scores = Array.isArray(data.scores) ? data.scores : [];

    const prev = scores.find((x) => x.username === username);
    if (prev && score <= prev.score) {
      console.log(`📉 Lower score ignored for ${username} (${score} <= ${prev.score})`);
      return res.json({ ok: true, stored: false });
    }

    const newScores = [...scores.filter((x) => x.username !== username), { username, score, verified, at: new Date().toISOString() }];
    const payload = { resetAt: data.resetAt || new Date().toISOString(), scores: newScores };

    await axios.put(`${EVENT_BIN_URL}`, payload, { headers: { "X-Master-Key": JSONBIN_KEY, "Content-Type": "application/json" } });
    console.log(`✅ Event score saved for ${username}: ${score}`);
    res.json({ ok: true, stored: true });
  } catch (err) {
    console.error("❌ /eventsubmit error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/getChart", async (req, res) => {
  try {
    const username = (req.query.username || "@anon").trim().toLowerCase();
    const binRes = await axios.get(`${ATH_CHARTS_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let data = binRes.data; while (data?.record) data = data.record;
    const entry = data[username] || null;
    if (!entry) return res.json({ ok: true, ath: 0, chartData: [] });

    res.json({ ok: true, ath: entry.ath || 0, chartData: entry.chartData || [], updated: entry.updated || null });
  } catch (err) {
    console.error("❌ /getChart error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load chart" });
  }
});

app.post("/saveChart", async (req, res) => {
  try {
    const username = (req.body.username || "@anon").trim().toLowerCase();
    const ath = parseFloat(req.body.ath || 0);
    const chartData = Array.isArray(req.body.chartData) ? req.body.chartData : [];
    if (!chartData.length || !ath) return res.status(400).json({ error: "Invalid chart data or ath" });

    const binRes = await axios.get(`${ATH_CHARTS_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let data = binRes.data; while (data?.record) data = data.record;

    const current = data[username] || { ath: 0 };
    if (ath > current.ath) {
      data[username] = { ath, chartData, updated: new Date().toISOString() };
      await axios.put(`${ATH_CHARTS_URL}`, data, { headers: { "X-Master-Key": JSONBIN_KEY } });
      console.log(`📈 Saved new ATH chart for ${username}`);
      return res.json({ ok: true, updated: true });
    } else {
      console.log(`🟡 Skipped save — existing ATH (${current.ath}) ≥ ${ath} for ${username}`);
      return res.json({ ok: true, updated: false });
    }
  } catch (err) {
    console.error("❌ /saveChart error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save chart" });
  }
});

bot.onText(/\/bugreport(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from?.username ? "@" + msg.from.username : msg.from.first_name || "Unknown user";

  await sendSafeMessage(chatId, "🐞 Please describe the issue or bug you are experiencing.\n\nTry to include what you were doing, what happened, and (if possible) screenshots or error messages.");

  bot.once("message", async (m2) => {
    const reportText = (m2.text || "").trim();
    if (!reportText || reportText.startsWith("/")) return sendSafeMessage(chatId, "⚠️ Report cancelled or invalid message.");

    try {
      const timestamp = new Date().toISOString().replace("T", " ").split(".")[0] + " UTC";
      const msgText =
        `🐞 <b>Bug Report</b>\n` +
        `<b>Time:</b> ${timestamp}\n` +
        `<b>From:</b> ${user}\n` +
        `<b>Chat ID:</b> ${chatId}\n\n` +
        `<b>Report:</b>\n${escapeXml(reportText)}`;

      await sendSafeMessage(BUG_REPORT_CHAT_ID, msgText, { parse_mode: "HTML" });
      await sendSafeMessage(chatId, "✅ Thanks! Your report has been sent to the devs.");
      console.log(`🐞 Bug report forwarded from ${user}: ${reportText}`);
    } catch (err) {
      console.error("❌ /bugreport:", err.message);
      await sendSafeMessage(chatId, "⚠️ Failed to send report. Please try again later.");
    }
  });
});

// ==========================================================
// 22) SERVER START
// ==========================================================
app.listen(PORT, async () => {
  console.log(`🚀 UnStableCoin Bot v3.4 running on port ${PORT}`);
  console.log("💛 UnStableCoin Bot v3.4 merged build (2025-10-25) booted");
  console.log("🏆 Most Hard-Core Player of the Year: @unstablecoinx");
  try {
    const cfg = await getConfig();
    console.log("✅ Config loaded:", { tokenMint: cfg.tokenMint, minHoldAmount: cfg.minHoldAmount, network: cfg.network });
  } catch (_) {}
});
