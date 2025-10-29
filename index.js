// ✅ UnStableCoin Bot v3.4 — Clean merged stable build (2025-10-25)
// 💬 t.me/UnStableCoin_US — the unstable force in crypto
/*
==========================================================
🧩 UnStableCoin Bot v3.4 — Full Wallet Flow + Events + ATH
Build: 2025-10-25  |  TEST MODE: OFF (production)
==========================================================
📑 TABLE OF CONTENTS
1)  Imports & Config Defaults
2)  Environment & Constants
3)  Express + Telegram Webhook Setup
4)  Small Utilities (sleep, escape, normalize, validators)
5)  JSONBin Helpers (readBin, writeBin)
6)  Config & Holders
7)  Solana Checks
8)  Image Composition (share image + ATH banner)
9)  Leaderboards & Event Data
10) Telegram: Safe send helpers (sendSafeMessage, sendChunked)
11) Telegram: Main Menu UI
12) Telegram: Core Commands
13) Telegram: Wallet Flows
14) Telegram: Button Text Router
15) HTTP: Frontend Endpoints
16) Server Start
==========================================================
*/

// ==========================================================
// 1) IMPORTS & CONFIG DEFAULTS
// ==========================================================
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const { DateTime } = require("luxon");
const sharp = require("sharp");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");

const CONFIG_DEFAULTS = {
  tokenMint: "6zzHz3X3s53zhEqyBMmokZLh6Ba5EfC5nP3XURzYpump",
  minHoldAmount: 500000,
  network: "mainnet-beta",
};

// 🧩 Feature toggles
const ATH_TEST_MODE = false; // disable test mode for production
const ATH_CHAT_ID = process.env.ATH_CHAT_ID || "8067310645";
// --- Bug reports destination (currently same as A.T.H. chat) ---
const BUG_REPORT_CHAT_ID = ATH_CHAT_ID; // can later be replaced with your group chat id

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
const ATH_TEST_CHAT_ID          = process.env.ATH_TEST_CHAT_ID;
const JSONBIN_KEY               = process.env.JSONBIN_KEY;
const RESET_KEY                 = process.env.RESET_KEY;
const RENDER_EXTERNAL_HOSTNAME  = process.env.RENDER_EXTERNAL_HOSTNAME || null;
const PORT                      = process.env.PORT || 10000;

// ✅ Validation — ensure all required ENV vars exist
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
  !JSONBIN_KEY ||
  !RESET_KEY
) {
  console.error("❌ Missing one or more required environment variables!");
  process.exit(1);
}

// ==========================================================
// 🗄️ JSONBIN URL DEFINITIONS — Final Canonical References
// ==========================================================
const MAIN_BIN_URL            = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const CONFIG_BIN_URL          = `https://api.jsonbin.io/v3/b/${CONFIG_JSONBIN_ID}`;
const HOLDER_BIN_URL          = `https://api.jsonbin.io/v3/b/${HOLDER_JSONBIN_ID}`;
const ATH_BIN_URL             = `https://api.jsonbin.io/v3/b/${ATH_JSONBIN_ID}`;
const ATH_SHARED_BIN_URL      = `https://api.jsonbin.io/v3/b/${ATH_SHARED_ID}`;
const EVENT_BIN_URL           = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;          // event scores
const EVENT_META_BIN_URL      = `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}`;     // event info/meta
const EVENT_SNAPSHOT_BIN_URL  = `https://api.jsonbin.io/v3/b/${EVENT_SNAPSHOT_JSONBIN_ID}`; // archived events

// ==========================================================
// 🧑‍💻 ADMIN
// ==========================================================
const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot", "pachenko_14"];

// ==========================================================
// 3) EXPRESS + TELEGRAM WEBHOOK SETUP
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
// 4) SMALL UTILITIES
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

// simple in-memory cache for short periods
const _cache = {};

// ==========================================================
// 5) JSONBin Helpers (readBin + writeBin)
// ==========================================================
async function readBin(url, tries = 3) {
  const c = _cache[url];
  if (c && Date.now() - c.t < 30_000) return c.data;

  for (let i = 0; i < tries; i++) {
    try {
      const resp = await axios.get(url, { headers: { "X-Master-Key": JSONBIN_KEY } });
      let data = resp.data?.record ?? resp.data ?? {};
      if (data.record) data = data.record;
      if (Array.isArray(data.record)) data = data.record;
      if (data?.scores) data = data.scores;
      _cache[url] = { t: Date.now(), data };
      return data;
    } catch (err) {
      const code = err?.response?.status;
      if (code === 429 && i < tries - 1) {
        const delay = 1000 * (i + 1);
        console.warn(`⏳ 429 rate-limit hit — waiting ${delay} ms`);
        await sleep(delay);
        continue;
      }
      console.error("❌ readBin:", err?.message || err);
      return null;
    }
  }
  return null;
}

async function writeBin(url, payload, tries = 3) {
  const body = Array.isArray(payload) ? { record: payload } : payload;
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await axios.put(url, body, {
        headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY },
      });
      return resp.data;
    } catch (err) {
      const code = err?.response?.status;
      if (code === 429 && i < tries - 1) {
        await sleep(250 * (i + 1));
        continue;
      }
      console.error("❌ writeBin:", err?.response?.data || err?.message || err);
      throw err;
    }
  }
}

// ==========================================================
// 6) CONFIG & HOLDERS
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
// 7) SOLANA CHECKS
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
// 8) IMAGE COMPOSITION
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

// 🖼️ Updated MCap Reached overlay (Oct 2025)
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
      input: await sharp({
        create: { width: 3, height: H, channels: 4, background: { r: 0, g: 255, b: 200, alpha: 0.5 } },
      }).png().toBuffer(),
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
// 9) LEADERBOARDS & EVENT DATA
// ==========================================================

function _normalizeScoreMap(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const n = Number(v);
    if (!Number.isNaN(n)) {
      const name = k.startsWith("@") ? k : "@" + k;
      out[name] = n;
    }
  }
  return out;
}

function _extractScoresFromBin(raw) {
  // Unwrap any JSONBin nesting
  let data = raw;
  if (data && data.record && typeof data.record === "object") data = data.record;
  while (data && typeof data === "object" && data.record && typeof data.record === "object") {
    const siblings = {};
    for (const [k, v] of Object.entries(data)) if (k !== "record") siblings[k] = v;
    data = Object.assign({}, siblings, data.record);
  }

  // ✅ New format: { resetAt, scores: [ { username, score, ... } ] }
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

  // Legacy format: direct object map { "@user": score, ... } or { scores: { ... } }
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
// 🧩 EVENT DATA FUNCTIONS — clean read from unified bins
// ==========================================================

async function getEventData() {
  try {
    const res = await axios.get(EVENT_BIN_URL, {
      headers: { "X-Master-Key": JSONBIN_KEY }
    });

    // ✅ Handle both new and old JSONBin formats
    const raw = res.data?.record || res.data || {};
    const scoresArray = raw.scores || [];

    // ✅ Convert scores to a username→score map for easy access
    const scores = {};
    for (const s of scoresArray) {
      if (s.username && typeof s.score === "number") {
        // only keep the highest score per user
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
    const res = await axios.get(`${EVENT_META_BIN_URL}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    const p = res.data?.record || res.data || {};
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

async function getVerifiedEventTop(n = 10) {
  const { scores } = await getEventData();
  const holdersMap = await getHoldersMapFromArray();
  const cfg = await getConfig();
  const minHold = cfg.minHoldAmount || 0;
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [uname, score] of sorted) {
    const rec = holdersMap[uname];
    if (!rec?.wallet) continue;
    const check = await checkSolanaHolding(rec.wallet, minHold);
    if (check.ok) out.push({ username: uname, score });
    if (out.length >= n) break;
  }
  return out;
}

// ==========================================================
// 10) TELEGRAM SAFE SEND HELPERS
// ==========================================================
async function sendSafeMessage(chatId, message, opts = {}) {
  try {
    await bot.sendMessage(
      chatId,
      message,
      Object.assign({ parse_mode: "HTML", disable_web_page_preview: true }, opts)
    );
  } catch (err) {
    console.error("❌ sendMessage:", err?.message || err);
  }
}

// --- unified async chunked sender ---
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
// 11) TELEGRAM MAIN MENU — Stable build (v3.5 compatible)
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

// --- Show menu ---
bot.onText(/\/start|\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  const welcome =
    "💛 <b>Welcome to UnStableCoin</b>\nUse the buttons below to manage wallet, verify holdings, or join the current event.";
  await sendSafeMessage(chatId, welcome, { ...mainMenu, parse_mode: "HTML" });
});

// ==========================================================
//  BUTTON HANDLERS — Interpret button text as bot commands
// ==========================================================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  try {
    switch (text) {
      case "🌕 Add Wallet":
        bot.processUpdate({ message: { ...msg, text: "/addwallet" } });
        break;

      case "⚡ Verify Holder":
        bot.processUpdate({ message: { ...msg, text: "/verifyholder" } });
        break;

      case "🔁 Change Wallet":
        bot.processUpdate({ message: { ...msg, text: "/changewallet" } });
        break;

      case "❌ Remove Wallet":
        bot.processUpdate({ message: { ...msg, text: "/removewallet" } });
        break;

      case "🏆 Leaderboard":
        bot.processUpdate({ message: { ...msg, text: "/top10" } });
        break;

      case "🚀 Current Event":
        bot.processUpdate({ message: { ...msg, text: "/event" } });
        break;

      case "🏁 Event Leaderboard":
        bot.processUpdate({ message: { ...msg, text: "/eventtop10" } });
        break;

      case "🐞 Report Bug":
        bot.processUpdate({ message: { ...msg, text: "/bugreport" } });
        break;

      default:
        // ignore unknown button presses
        break;
    }
  } catch (err) {
    console.error("❌ Menu handler error:", err.message);
    await sendSafeMessage(
      chatId,
      "⚠️ Something went wrong while processing your request."
    );
  }
});
// ==========================================================
// 12) TELEGRAM CORE COMMANDS
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
    lines.push("/winners [n] — Check top event holders");
    lines.push("/setholdingreq — Set required token holding amount");
  }

  await sendSafeMessage(msg.chat.id, lines.join("\n"));
});

bot.onText(/\/play/, async (msg) => {
  const isPrivate = msg.chat.type === "private";
  if (isPrivate) {
    await bot.sendMessage(msg.chat.id, "🎮 <b>Play FUD Dodge</b>", {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "⚡ Open Game", web_app: { url: "https://theunstable.io/fuddodge" } }]],
      },
    });
  } else {
    const me = await bot.getMe();
    await bot.sendMessage(msg.chat.id, "Play safely in DM 👇", {
      reply_markup: {
        inline_keyboard: [[{ text: "⚡ Open DM", url: `https://t.me/${me.username}?start=play` }]],
      },
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

// --- FIXED /event (v3.4.2 compatible with new meta structure) ---
bot.onText(/\/event$/i, async (msg) => {
  try {
    const chatId = msg.chat.id;
    const meta = await getEventMeta();
    const cfg = await getConfig();
    const tz = meta.timezone || "Europe/Stockholm";
    const now = DateTime.now().setZone(tz);

    // Hantera flera möjliga strukturer
    const data = meta.raw?.record || meta.raw || meta;

    if (!data.title) {
      await sendSafeMessage(chatId, "⚠️ No active event found in metadata.");
      return;
    }

    let body = `🧩 <b>${escapeXml(data.title)}</b>\n\n${escapeXml(data.info || "")}\n`;

    if (data.startDate) {
      const start = DateTime.fromISO(data.startDate).setZone(tz);
      const end = data.endDate ? DateTime.fromISO(data.endDate).setZone(tz) : null;

      if (now < start) {
        const diff = start.diff(now, ["days", "hours", "minutes"]).toObject();
        const remain = `${diff.days ? Math.floor(diff.days) + "d " : ""}${diff.hours ? Math.floor(diff.hours) + "h " : ""}${diff.minutes ? Math.floor(diff.minutes) + "m" : ""}`.trim();
        body += `\n🟡 Starts in ${remain}`;
      } else if (end && now < end) {
        const diff = end.diff(now, ["days", "hours", "minutes"]).toObject();
        const remain = `${diff.days ? Math.floor(diff.days) + "d " : ""}${diff.hours ? Math.floor(diff.hours) + "h " : ""}${diff.minutes ? Math.floor(diff.minutes) + "m" : ""}`.trim();
        body += `\n⏳ Ends in ${remain}`;
      } else if (end && now >= end) {
        body += `\n🔴 Event ended ${end.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
        body += `\n📜 Stay tuned for next event.`;
      }

      body += `\n🕓 ${start.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
      if (end) body += ` → ${end.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
    }

    body += `\n\n<b>Timezone:</b> ${escapeXml(tz)}\n<b>Minimum holding:</b> ${cfg.minHoldAmount.toLocaleString()} $US`;

    await sendSafeMessage(chatId, body, { parse_mode: "HTML" });
  } catch (err) {
    console.error("❌ /event:", err?.message || err);
    await sendSafeMessage(msg.chat.id, "⚠️ Could not load event info.");
  }
});

// ==========================================================
//  /bugreport — report bugs or issues (to BUG_REPORT_CHAT_ID)
// ==========================================================
bot.onText(/\/bugreport(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const user =
    msg.from?.username ? "@" + msg.from.username :
    msg.from.first_name || "Unknown user";

  await sendSafeMessage(
    chatId,
    "🐞 Please describe the issue or bug you're experiencing.\n\n" +
    "Try to include what you were doing, what happened, and (if possible) screenshots or error messages."
  );

  // Wait for the next message as the report
  bot.once("message", async (m2) => {
    const reportText = (m2.text || "").trim();
    if (!reportText || reportText.startsWith("/"))
      return sendSafeMessage(chatId, "⚠️ Report cancelled or invalid message.");

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
// 🧩 PATCH: Leaderboard + Admin Commands (v3.4.1 restore)
// ==========================================================

// --- LEADERBOARD COMMANDS ---
bot.onText(/\/top10/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const data = await getLeaderboard();
    const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!sorted.length) return sendSafeMessage(chatId, "⚠️ No leaderboard data available.");
    const lines = sorted.map(([u, v], i) => `${i + 1}. ${u} — ${v}`);
    await sendChunked(chatId, "🏆 <b>Top 10</b>\n\n", lines);
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
    const lines = sorted.map(([u, v], i) => `${i + 1}. ${u} — ${v}`);
    await sendChunked(chatId, "📈 <b>Top 50</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /top50:", err.message);
    sendSafeMessage(chatId, "⚠️ Failed to load leaderboard.");
  }
});

// --- EVENT LEADERBOARD COMMANDS ---
bot.onText(/\/eventtop10/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const top = await getVerifiedEventTop(10);
    if (!top.length) return sendSafeMessage(chatId, "⚠️ No verified holders found for current event.");
    const lines = top.map((x, i) => `${i + 1}. ${x.username} — ${x.score}`);
    await sendChunked(chatId, "⚡ <b>Event Top 10 (Verified)</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /eventtop10:", err.message);
    sendSafeMessage(chatId, "⚠️ Could not load event leaderboard.");
  }
});

bot.onText(/\/eventtop50/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const top = await getVerifiedEventTop(50);
    if (!top.length) return sendSafeMessage(chatId, "⚠️ No verified holders found for current event.");
    const lines = top.map((x, i) => `${i + 1}. ${x.username} — ${x.score}`);
    await sendChunked(chatId, "⚡ <b>Event Top 50 (Verified)</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /eventtop50:", err.message);
    sendSafeMessage(chatId, "⚠️ Could not load event leaderboard.");
  }
});

// ==========================================================
//  /validatewinners — verify event top wallets on-chain
// ==========================================================
bot.onText(/\/validatewinners(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user))
    return sendSafeMessage(chatId, "⚠️ Admins only.");

  await sendSafeMessage(chatId, "🔍 Checking top verified event wallets on-chain...");

  try {
    const cfg = await getConfig();
    const minHold = cfg.minHoldAmount || 0;
    const { scores } = await getEventData();
    const holdersMap = await getHoldersMapFromArray();

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 20); // top 20
    const results = [];

    for (const [uname, score] of sorted) {
      const holder = holdersMap[uname] || holdersMap[uname.toLowerCase()];
      if (!holder?.wallet) {
        results.push(`⚪️ ${uname} — no wallet on file`);
        continue;
      }

      const check = await checkSolanaHolding(holder.wallet, minHold);
      if (check.ok)
        results.push(`✅ ${uname} — verified (${score})`);
      else
        results.push(`❌ ${uname} — insufficient holding (${check.balance || 0})`);
    }

    const header = `🧩 <b>Validated Top Event Holders</b>\n<code>minHold = ${minHold.toLocaleString()} $US</code>\n\n`;
    await sendChunked(chatId, header, results, 3800);
  } catch (err) {
    console.error("❌ /validatewinners:", err.message);
    await sendSafeMessage(chatId, `⚠️ Could not validate winners: ${err.message}`);
  }
});

// ==========================================================
//  /winners — list top 10 event holders + wallets
// ==========================================================
bot.onText(/\/winners(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user))
    return sendSafeMessage(chatId, "⚠️ Admins only.");

  await sendSafeMessage(chatId, "📊 Fetching top 10 event holders...");

  try {
    const { scores } = await getEventData();
    const holdersMap = await getHoldersMapFromArray();
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 10);

    if (!sorted.length)
      return sendSafeMessage(chatId, "⚠️ No event data found.");

    const lines = sorted.map(([uname, score], i) => {
      const holder = holdersMap[uname] || holdersMap[uname.toLowerCase()];
      const wallet = holder?.wallet
        ? holder.wallet.slice(0, 4) + "…" + holder.wallet.slice(-4)
        : "—";
      return `${i + 1}. ${uname} — ${score}  |  ${wallet}`;
    });

    const header = "🏁 <b>Top 10 Event Holders</b>\n\n";
    await sendChunked(chatId, header, lines, 3800);
  } catch (err) {
    console.error("❌ /winners:", err.message);
    await sendSafeMessage(chatId, `⚠️ Could not load winners: ${err.message}`);
  }
});

// ==========================================================
// 🧹 /resetevent — Admin Command (scores only, meta kept intact)
// ==========================================================
bot.onText(/\/resetevent/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();

  if (!ADMIN_USERS.includes(user)) {
    return sendSafeMessage(chatId, "⚠️ Admins only.");
  }

  try {
    console.log("🧹 /resetevent (scores only) triggered by", user);
    console.log("➡️ EVENT_BIN_URL:", EVENT_BIN_URL);

    // 🔄 Prepare clean payload — flat structure
    const payload = {
      resetAt: new Date().toISOString(),
      scores: []
    };

    // ✅ Clear only the event scores bin
    const eventRes = await writeBin(EVENT_BIN_URL, payload);
    console.log("✅ EVENT scores reset:", eventRes?.metadata || "OK");

    await sendSafeMessage(
      chatId,
      "🧹 <b>Event leaderboard reset</b>\nOnly scores were cleared — event info/meta remains.",
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("❌ /resetevent failed:", err.response?.data || err.message);
    await sendSafeMessage(
      chatId,
      `⚠️ Reset failed: ${err.response?.data?.message || err.message}`
    );
  }
});

// ==========================================================
// 🧠 /setevent — Admin command to create a new event
// ==========================================================
bot.onText(/\/setevent/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();

  if (!ADMIN_USERS.includes(user)) {
    return sendSafeMessage(chatId, "⚠️ Admins only.");
  }

  try {
    console.log("🧩 /setevent triggered by", user);

    await sendSafeMessage(chatId, "🧠 Let's set up a new event.\n\nPlease reply with the <b>title</b>:", { parse_mode: "HTML" });

    // 1️⃣ Title
    bot.once("message", async (m1) => {
      const title = (m1.text || "").trim();
      if (!title) return sendSafeMessage(chatId, "⚠️ Title cannot be empty. Try /setevent again.");

      await sendSafeMessage(chatId, "✏️ Great! Now send a short <b>description</b> for the event:", { parse_mode: "HTML" });

      // 2️⃣ Description
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

                  // 🧩 Preview for confirmation
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
                      inline_keyboard: [
                        [
                          { text: "✅ Save", callback_data: "confirm_event_save" },
                          { text: "❌ Cancel", callback_data: "confirm_event_cancel" },
                        ],
                      ],
                    },
                  });

                  // 8️⃣ Confirmation handler
                  bot.once("callback_query", async (cbq) => {
                    if (cbq.data === "confirm_event_cancel") {
                      await sendSafeMessage(chatId, "❌ Event creation cancelled.");
                      return;
                    }

                    if (cbq.data === "confirm_event_save") {
                      const payload = {
                        record: {
                          title,
                          info,
                          startDate: startISO,
                          endDate: endISO,
                          timezone,
                          updatedAt: new Date().toISOString(),
                          createdBy: "@" + user,
                        },
                      };

                      try {
                        console.log("📝 Writing new event meta to:", EVENT_META_BIN_URL);
                        console.log("📦 Payload:", JSON.stringify(payload, null, 2));

                        const res = await writeBin(EVENT_META_BIN_URL, payload);
                        console.log("✅ Event meta updated:", res?.metadata || "OK");

                        await sendSafeMessage(
                          chatId,
                          `🎯 <b>Event saved successfully!</b>\n\n` +
                          `<b>Title:</b> ${escapeXml(title)}\n` +
                          `<b>Start:</b> ${escapeXml(startISO)}\n` +
                          `<b>End:</b> ${escapeXml(endISO)}\n` +
                          `<b>Timezone:</b> ${escapeXml(timezone)}`,
                          { parse_mode: "HTML" }
                        );
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
//  HOLDING REQUIREMENT COMMANDS
// ==========================================================

// /getholdingreq — anyone can view current requirement
bot.onText(/\/getholdingreq(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const cfg = await getConfig();
    if (!cfg || !cfg.minHoldAmount)
      return sendSafeMessage(chatId, "⚠️ No config found or invalid bin data.");

    await sendSafeMessage(
      chatId,
      `💰 Minimum holding requirement: ${cfg.minHoldAmount.toLocaleString()} $US`
    );
  } catch (err) {
    console.error("❌ /getholdingreq:", err?.message || err);
    await sendSafeMessage(chatId, "⚠️ Could not load current holding requirement.");
  }
});

// /setholdingreq — interactive admin update
bot.onText(/\/setholdingreq(@[A-Za-z0-9_]+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user))
    return sendSafeMessage(chatId, "⚠️ Admins only.");

  await sendSafeMessage(chatId, "💬 Enter new minimum holding (number only):");

  bot.once("message", async (m2) => {
    const input = (m2.text || "").trim().replace(/[^\d]/g, "");
    const newVal = parseInt(input, 10);

    if (isNaN(newVal) || newVal <= 0)
      return sendSafeMessage(chatId, "⚠️ Invalid number. Try again with /setholdingreq.");

    try {
      const cfg = await getConfig();
      cfg.minHoldAmount = newVal;
      const payload = { record: cfg };

      console.log(`💾 Updating minHoldAmount to ${newVal}`);
      const res = await writeBin(CONFIG_BIN_URL, payload);
      console.log("✅ Config updated:", res?.metadata || "OK");

      await sendSafeMessage(
        chatId,
        `✅ <b>Minimum holding updated</b>\nNew value: ${newVal.toLocaleString()} $US`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("❌ /setholdingreq:", err.response?.data || err.message);
      await sendSafeMessage(chatId, "⚠️ Failed to update holding requirement.");
    }
  });
});

// ==========================================================
// 13) TELEGRAM: WALLET FLOWS
// ==========================================================
bot.onText(/\/addwallet|\/changewallet|\/removewallet|\/verifyholder/i, async (msg) => {
  const chatId = msg.chat.id;
  const realUser = msg.from?.username;
  if (!realUser)
    return bot.sendMessage(chatId, "❌ You need a Telegram username (Settings → Username).");

  const holders = await getHoldersArray();
  const existing = holders.find((h) => normalizeName(h.username) === normalizeName(realUser));

  try {
    const lower = msg.text.toLowerCase();

    // === ADD WALLET ===
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

    // === CHANGE WALLET ===
    if (lower.includes("changewallet")) {
      if (!existing) {
        await bot.sendMessage(chatId, `⚠️ You don’t have any wallet saved yet, @${realUser}.\nUse /addwallet first.`, mainMenu);
        return;
      }
      await bot.sendMessage(chatId, "Do you really want to change your wallet?", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Yes, change it", callback_data: "confirm_change_yes" },
             { text: "❌ Cancel", callback_data: "confirm_change_no" }],
          ],
        },
      });
      return;
    }

    // === REMOVE WALLET ===
    if (lower.includes("removewallet")) {
      if (!existing) {
        await bot.sendMessage(chatId, `⚠️ You don’t have any wallet saved yet, @${realUser}.`, mainMenu);
        return;
      }
      await bot.sendMessage(chatId, "Are you sure you want to remove your wallet?", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Yes, remove", callback_data: "confirm_remove_yes" },
             { text: "❌ Cancel", callback_data: "confirm_remove_no" }],
          ],
        },
      });
      return;
    }

    // === VERIFY HOLDER ===
    if (lower.includes("verifyholder")) {
      if (!existing?.wallet) {
        await bot.sendMessage(chatId, "⚠️ No wallet on file. Use /addwallet first.", mainMenu);
        return;
      }
      await bot.sendMessage(chatId, "🔍 Checking on-chain balance...");
      const res = await axios.post(
        `https://unstablecoin-fuddodge-backend.onrender.com/verifyHolder`,
        { username: "@" + realUser, wallet: existing.wallet }
      );
      if (res.data.ok)
        await bot.sendMessage(chatId, `✅ Verified successfully for @${realUser}!`, mainMenu);
      else
        await bot.sendMessage(chatId, `⚠️ Verification failed: ${res.data.message || "Not enough tokens."}`, mainMenu);
      return;
    }
  } catch (err) {
    console.error("⚠️ Wallet flow error:", err?.message || err);
    await bot.sendMessage(chatId, "⚠️ Something went wrong. Try again later.", mainMenu);
  }
});


// ==========================================================
// 13) TELEGRAM INLINE BUTTON HANDLER — Stable + Auto Cleanup
// ==========================================================

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  try {
    console.log("⚡ Inline button pressed:", data);

    // Always answer Telegram immediately to stop spinner
    await bot.answerCallbackQuery(query.id);

    switch (data) {
      // --- Confirm wallet removal ---
      case "confirm_remove":
        await removeWallet(chatId);
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
        await sendSafeMessage(chatId, "💛 Your wallet has been removed.");
        break;

      // --- Confirm wallet change ---
      case "confirm_change":
        await changeWallet(chatId);
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
        await sendSafeMessage(chatId, "⚡ Wallet successfully changed.");
        break;

      // --- Cancel any action ---
      case "cancel":
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
        await sendSafeMessage(chatId, "❌ Action cancelled.");
        break;

      // --- Unknown callbacks (ignore silently) ---
      default:
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
        break;
    }
  } catch (err) {
    console.error("❌ callback_query handler error:", err);
    try {
      await bot.answerCallbackQuery(query.id, { text: "⚠️ Something went wrong." });
    } catch (innerErr) {
      console.error("❌ Failed to answer callback:", innerErr);
    }
  }
});

// ==========================================================
// 14) TELEGRAM: BUTTON TEXT ROUTER
// ==========================================================
bot.on("message", async (msg) => {
  try {
    if (!msg.text || msg.text.startsWith("/")) return;
    const t = msg.text.toLowerCase();
    let command = null;
    if (t.includes("add wallet")) command = "/addwallet";
    else if (t.includes("verify")) command = "/verifyholder";
    else if (t.includes("change")) command = "/changewallet";
    else if (t.includes("remove")) command = "/removewallet";
    else if (t.includes("leader")) command = "/top10";
    else if (t.includes("event")) command = "/event";
    else if (t.includes("bug")) command = "/report";
    else return;
    bot.emit("manual_command", { ...msg, text: command });
  } catch (err) {
    console.error("⚠️ Router error:", err?.message || err);
  }
});

// ==========================================================
// 15) HTTP: FRONTEND ENDPOINTS
// ==========================================================
app.post("/verifyHolder", async (req, res) => {
  try {
    let { username, wallet } = req.body;
    if (!username || !wallet) return res.status(400).json({ ok:false, message:"Missing username or wallet." });
    username = normalizeUsername(username);
    if (!isLikelySolanaAddress(wallet)) return res.status(400).json({ ok:false, message:"Invalid Solana address format." });

    const holders = await getHoldersArray();
    const already = holders.find(h => h.username.toLowerCase() === username.toLowerCase());
    const verified = await checkSolanaHolding(wallet, (await getConfig()).minHoldAmount || 0);
    if (!verified.ok) return res.json({ ok:false, message:"Wallet balance below minimum requirement." });

    if (already) {
      already.prevWallet = already.wallet || null;
      already.wallet = wallet;
      already.verifiedAt = new Date().toISOString();
      already.changedAt  = new Date().toISOString();
    } else {
      holders.push({ username, wallet, verifiedAt: new Date().toISOString() });
    }
    await saveHoldersArray(holders);
    res.json({ ok:true, message:"✅ Holder verified successfully!", username });
  } catch (err) {
    console.error("verifyHolder:", err?.message || err);
    res.status(500).json({ ok:false, message:"Server error verifying holder." });
  }
});

app.get("/holderStatus", async (req, res) => {
  try {
    let username = req.query.username;
    if (!username) return res.status(400).json({ verified:false, message:"Missing username" });
    username = normalizeUsername(username);
    const holders = await getHoldersArray();
    const match = holders.find(h => h.username?.toLowerCase() === username.toLowerCase());
    if (match?.wallet)
      return res.json({ verified: !!match.verifiedAt, username: match.username, wallet: match.wallet, verifiedAt: match.verifiedAt || null });
    res.json({ verified:false });
  } catch (err) {
    console.error("holderStatus:", err?.message || err);
    res.status(500).json({ verified:false, message:"Server error checking holder status" });
  }
});

// 🧩 Enhanced /share — with verified-only event sync (v3.4.3)
app.post("/share", async (req, res) => {
  try {
    const { username, score, chatId, imageBase64, mode, curveImage } = req.body;
    if (!username) return res.status(400).json({ ok: false, message: "Missing username" });

    const cfg = await getConfig();
    const holders = await getHoldersMapFromArray();
    const userRec = holders[username] || holders[normalizeUsername(username)];
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const targetChatId = ATH_CHAT_ID;
    const isAth = String(mode).toLowerCase() === "ath";

    // 🧩 Verify holder before allowing event update or sharing
    if (!userRec?.wallet) {
      return res.json({ ok: false, message: "Wallet not verified. Use /verifyholder first." });
    }
    const verified = await checkSolanaHolding(userRec.wallet, cfg.minHoldAmount || 0);
    if (!verified.ok) {
      return res.json({ ok: false, message: "Holding below required minimum." });
    }

    // === Step 1: Optional A.T.H. sharing ===
    let shared = {};
    try {
      const r = await axios.get(`${ATH_BIN_URL}/latest`, {
        headers: { "X-Master-Key": JSONBIN_KEY },
      });
      shared = r.data?.record || {};
    } catch (err) {
      console.warn("⚠️ Could not load previous A.T.H. records:", err.message);
    }

    const prev = shared[username] || 0;
    if (isAth && score <= prev && !ATH_TEST_MODE) {
      console.log(`🚫 ${username} already shared same or higher A.T.H. (${prev})`);
      return res.json({
        ok: true,
        posted: false,
        stored: false,
        message: "Already shared. Make a new A.T.H. and share that.",
      });
    }

    // === Step 2: Telegram post ===
    const caption = isAth
      ? `💛 ${username} just reached a new A.T.H: ${score.toLocaleString()} MCap!\n#UnStableCoin #WAGMI-ish`
      : `⚡️ ${username} posted a highlight moment!\nScore: ${score.toLocaleString()}`;
    const photoData = curveImage || imageBase64;
    if (!photoData) return res.status(400).json({ ok: false, message: "Missing image data" });

    let tgResp = null;
    try {
      tgResp = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        chat_id: targetChatId,
        caption,
        photo: photoData,
        parse_mode: "HTML",
      });
      console.log(`📤 Sent ${isAth ? "A.T.H." : "post"} to Telegram`);
    } catch (err) {
      console.error("❌ Telegram post failed:", err.response?.data || err.message);
    }

    // === Step 3: A.T.H. record update ===
    if (isAth && score > prev) {
      shared[username] = score;
      try {
        await axios.put(`${ATH_BIN_URL}`, shared, {
          headers: {
            "X-Master-Key": JSONBIN_KEY,
            "Content-Type": "application/json",
          },
        });
        console.log(`✅ A.T.H. recorded for ${username} (${score})`);
      } catch (err) {
        console.warn("⚠️ Failed to update A.T.H. bin:", err.message);
      }
    }

    // === Step 4: Update EVENT leaderboard if active ===
    try {
      const meta = await readBin(`https://api.jsonbin.io/v3/b/${process.env.EVENT_META_JSONBIN_ID}`);
      const record = meta?.record?.record || meta?.record || {};
      const now = new Date();
      const start = record.startDate ? new Date(record.startDate) : null;
      const end = record.endDate ? new Date(record.endDate) : null;
      const isActive = start && end && now >= start && now <= end;

      if (isActive) {
        const evData = await readBin(`https://api.jsonbin.io/v3/b/${process.env.EVENT_JSONBIN_ID}`);
        const scores = evData?.record || evData || {};
        scores[username] = Math.max(Number(scores[username] || 0), Number(score));

        await axios.put(
          `https://api.jsonbin.io/v3/b/${process.env.EVENT_JSONBIN_ID}`,
          { record: scores },
          {
            headers: {
              "X-Master-Key": process.env.JSONBIN_KEY,
              "Content-Type": "application/json",
            },
          }
        );

        console.log(`⚡ Added verified ${username} (${score}) to active event leaderboard`);
      } else {
        console.log("⚠️ No active event — skipping event leaderboard update.");
      }
    } catch (err) {
      console.warn("⚠️ Could not update event leaderboard:", err.message);
    }

    res.json({ ok: true, posted: !!tgResp, stored: isAth });
  } catch (err) {
    console.error("❌ /share error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================================
// 🌐 WEB APP ENDPOINTS — FUD DODGE Splash & Game
// ==========================================================

app.get("/leaderboard", async (req, res) => {
  try {
    const data = await readBin(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`);
    const raw = data?.record || data || {};
    let arr = [];

    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === "object")
      arr = Object.entries(raw).map(([username, score]) => ({
        username,
        score: Number(score)
      }));

    arr = arr.sort((a, b) => b.score - a.score).slice(0, 10);
    res.json(arr);
    console.log(`📤 /leaderboard sent ${arr.length} entries`);
  } catch (err) {
    console.error("❌ /leaderboard error:", err.message);
    res.status(500).json([]);
  }
});

// ======================================================
// 🚀 EVENT META + LEADERBOARD (Unified Logic)
// ======================================================

app.get("/event", async (req, res) => {
  try {
    const resp = await axios.get(`https://api.jsonbin.io/v3/b/${process.env.EVENT_META_JSONBIN_ID}/latest`, {
      headers: { "X-Master-Key": process.env.JSONBIN_KEY }
    });

    // Unwrap possible nesting: { record: { record: {...} } }
    let data = resp.data?.record;
    if (data?.record) data = data.record;

    if (!data?.title || !data?.startDate || !data?.endDate) {
      console.log("📤 /event → INACTIVE (missing fields)");
      return res.json({
        status: "inactive",
        title: "UnStable Challenge",
        info: "Stay tuned for upcoming events.",
        startDate: "",
        endDate: "",
        timezone: "Europe/Stockholm"
      });
    }

    const now = new Date();
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const status = now < start ? "upcoming" : now > end ? "ended" : "active";

    console.log(`📤 /event → ${status.toUpperCase()} (${data.startDate} → ${data.endDate})`);

    res.json({
      status,
      title: data.title,
      info: status === "ended" ? "Event ended. Results soon." : data.info,
      startDate: data.startDate,
      endDate: data.endDate,
      timezone: data.timezone || "Europe/Stockholm"
    });
  } catch (err) {
    console.error("❌ /event failed:", err.message);
    res.status(500).json({ error: "Failed to load event info" });
  }
});

// === EVENT LEADERBOARD (TOP 10) ===
app.get("/eventtop10", async (req, res) => {
  try {
    const scoresRes = await axios.get(`https://api.jsonbin.io/v3/b/${process.env.EVENT_JSONBIN_ID}/latest`, {
      headers: { "X-Master-Key": process.env.JSONBIN_KEY }
    });

    const rec = scoresRes.data?.record || {};
    const arr = rec.scores || [];

    if (!arr.length) {
      console.log("📤 /eventtop10: 0 entries (no scores yet)");
      return res.json([]);
    }

    const top = arr
      .filter((x) => !!x.username && typeof x.score === "number")
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    console.log(`📤 /eventtop10: ${top.length} entries`);
    res.json(top);
  } catch (err) {
    console.error("❌ /eventtop10 failed:", err.message);
    res.status(500).json({ error: "Failed to load event leaderboard" });
  }
});

app.post("/eventsubmit", async (req, res) => {
  try {
    const { username, score } = req.body;
    if (!username || !score)
      return res.status(400).json({ ok: false, msg: "Missing username or score" });

    const holders = await getHoldersMapFromArray();
    const verified = !!holders[username];
    if (!verified) {
      console.log(`🚫 ${username} not verified holder`);
      return res.status(403).json({ ok: false, msg: "Not a verified holder" });
    }

    // --- Check if event is active ---
    const meta = await readBin(`https://api.jsonbin.io/v3/b/${process.env.EVENT_META_JSONBIN_ID}/latest`);
    let eventMeta = meta?.record?.record || meta?.record || meta;
    const now = new Date();
    const start = eventMeta?.startDate ? new Date(eventMeta.startDate) : null;
    const end = eventMeta?.endDate ? new Date(eventMeta.endDate) : null;
    const isActive = start && end && now >= start && now <= end;

    if (!isActive) {
      console.log("⚠️ Event not active, skipping score write");
      return res.json({ ok: false, msg: "Event not active" });
    }

    // --- Read current leaderboard ---
    const scoresRes = await axios.get(
      `https://api.jsonbin.io/v3/b/${process.env.EVENT_JSONBIN_ID}/latest`,
      { headers: { "X-Master-Key": process.env.JSONBIN_KEY } }
    );

    // 🧹 Clean unwrap — fixes nested "record" issue
    let data = scoresRes.data?.record || scoresRes.data || {};
    while (data.record) data = data.record;
    let scores = Array.isArray(data.scores) ? data.scores : [];

    // 🏁 Update or insert player's best score only
    const prev = scores.find((x) => x.username === username);
    if (prev && score <= prev.score) {
      console.log(`📉 Lower score ignored for ${username} (${score} <= ${prev.score})`);
      return res.json({ ok: true, stored: false });
    }

    const newScores = [
      ...scores.filter((x) => x.username !== username),
      { username, score, verified, at: new Date().toISOString() }
    ];

    // ✅ Write back clean, non-nested structure
    const payload = {
      resetAt: data.resetAt || new Date().toISOString(),
      scores: newScores
    };

    await axios.put(
      `https://api.jsonbin.io/v3/b/${process.env.EVENT_JSONBIN_ID}`,
      payload,
      {
        headers: {
          "X-Master-Key": process.env.JSONBIN_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    console.log(`✅ Event score saved for ${username}: ${score}`);
    res.json({ ok: true, stored: true });
  } catch (err) {
    console.error("❌ /eventsubmit error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
 
// 🧩 META (optional, used for global app state / version info)
app.get("/meta", async (req, res) => {
  try {
    const data = await readBin(EVENT_META_BIN_URL);
    const record = data?.record || {};
    res.json(record);
  } catch (err) {
    console.error("❌ /meta error:", err.message);
    res.status(500).json({});
  }
});

// ==========================================================
// 16) SERVER START
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
