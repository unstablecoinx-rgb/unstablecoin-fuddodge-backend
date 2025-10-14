// index.js
// === UnStableCoin Game Bot ===
// ⚡ Version: EventTimeStrict + EventCloseOnEnd + Protected Submits + Admin Tools + Holder Verification + Telegram Posting
// Author: UnStableCoin Community (integrated features)

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const sharp = require("sharp");
const { DateTime } = require("luxon");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");

const app = express();
app.use(cors({ origin: "https://theunstable.io" }));
app.use(bodyParser.json({ limit: "6mb" })); // allow base64 images

// === ENVIRONMENT VARIABLES ===
const token = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;
const EVENT_JSONBIN_ID = process.env.EVENT_JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const EVENT_META_JSONBIN_ID = process.env.EVENT_META_JSONBIN_ID;
const RESET_KEY = process.env.RESET_KEY;
const CONFIG_JSONBIN_ID = process.env.CONFIG_JSONBIN_ID;
const HOLDER_JSONBIN_ID = process.env.HOLDER_JSONBIN_ID;
const RENDER_EXTERNAL_HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || process.env.HOST || null;

// minimal validation
if (!token || !JSONBIN_ID || !EVENT_JSONBIN_ID || !JSONBIN_KEY || !EVENT_META_JSONBIN_ID || !RESET_KEY || !CONFIG_JSONBIN_ID || !HOLDER_JSONBIN_ID) {
  console.error("❌ Missing environment variables! Required: TELEGRAM_BOT_TOKEN, JSONBIN_ID, EVENT_JSONBIN_ID, JSONBIN_KEY, EVENT_META_JSONBIN_ID, RESET_KEY, CONFIG_JSONBIN_ID, HOLDER_JSONBIN_ID");
  process.exit(1);
}

// === SETTINGS ===
const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot", "pachenko_14"];

// JSONBin URLs
const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;
const META_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}`;
const CONFIG_BIN_URL = `https://api.jsonbin.io/v3/b/${CONFIG_JSONBIN_ID}`;
const HOLDER_BIN_URL = `https://api.jsonbin.io/v3/b/${HOLDER_JSONBIN_ID}`;

// === TELEGRAM BOT SETUP ===
const bot = new TelegramBot(token);
const webhookUrl = (RENDER_EXTERNAL_HOSTNAME ? `https://${RENDER_EXTERNAL_HOSTNAME}` : `https://unstablecoin-fuddodge-backend.onrender.com`) + `/bot${token}`;

(async () => {
  try {
    await bot.setWebHook(`/bot${token}`, { url: webhookUrl });
    console.log(`✅ Webhook set to: ${webhookUrl}`);
  } catch (err) {
    // If setWebHook fails (e.g. already set) we still continue - logs
    console.warn("⚠️ setWebHook warning (may already be set):", err?.message || err);
  }
})();

// webhook endpoint for Telegram
app.post(`/bot${token}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ bot webhook process failed:", err);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("💛 UnStableCoin Game Bot is online and unstable as ever.");
});

// === UTIL: JSONBin helpers ===
async function jsonbinGet(url) {
  const res = await axios.get(url, { headers: { "X-Master-Key": JSONBIN_KEY } });
  return res.data.record || res.data || {};
}
async function jsonbinPut(url, payload) {
  const res = await axios.put(url, payload, { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } });
  return res.data;
}

// === CONFIG LOADING ===
let runtimeConfig = null;
async function loadConfig() {
  try {
    const cfg = await jsonbinGet(CONFIG_BIN_URL);
    // default fallback shape
    runtimeConfig = Object.assign({
      tokenMint: "6zzHz3X3s53zhEqyBMmokZLh6Ba5Efc5nP3XURzYPump",
      minHoldAmount: 500000,
      network: "mainnet-beta",
      checkIntervalHours: 24,
      holderVerificationEnabled: true,
      allowPostingWithoutHold: false,
      lastUpdated: new Date().toISOString()
    }, cfg);
    console.log("✅ Config loaded:", { tokenMint: runtimeConfig.tokenMint, minHoldAmount: runtimeConfig.minHoldAmount, network: runtimeConfig.network });
  } catch (err) {
    console.warn("⚠️ loadConfig failed:", err?.message || err);
    // fallback defaults
    runtimeConfig = {
      tokenMint: "6zzHz3X3s53zhEqyBMmokZLh6Ba5Efc5nP3XURzYPump",
      minHoldAmount: 500000,
      network: "mainnet-beta",
      checkIntervalHours: 24,
      holderVerificationEnabled: true,
      allowPostingWithoutHold: false,
      lastUpdated: new Date().toISOString()
    };
  }
}
loadConfig();

// === HOLDER LIST helpers ===
// stored shape in HOLDER_BIN: { holders: { "<wallet>": { username, wallet, verifiedAt, lastChecked } } }
async function getHolderList() {
  try {
    const data = await jsonbinGet(HOLDER_BIN_URL);
    return data.holders || {};
  } catch (err) {
    console.warn("⚠️ getHolderList failed:", err?.message || err);
    return {};
  }
}

async function putHolderList(holders) {
  return await jsonbinPut(HOLDER_BIN_URL, { holders });
}

// === Solana balance check ===
function getRpcForNetwork(network) {
  if (!network || network === "mainnet-beta") return clusterApiUrl("mainnet-beta");
  if (network === "devnet") return clusterApiUrl("devnet");
  if (network === "testnet") return clusterApiUrl("testnet");
  // otherwise return given url
  return network;
}

async function getTokenBalanceForWallet(walletAddress) {
  if (!runtimeConfig) await loadConfig();
  const mint = runtimeConfig.tokenMint;
  const network = runtimeConfig.network || "mainnet-beta";
  const rpc = getRpcForNetwork(network);
  const conn = new Connection(rpc, "confirmed");

  try {
    const ownerPub = new PublicKey(walletAddress);
    const mintPub = new PublicKey(mint);

    // Using parsed accounts for convenience (gives tokenAmount.uiAmount)
    const resp = await conn.getParsedTokenAccountsByOwner(ownerPub, { mint: mintPub });
    let total = 0;
    for (const acc of resp.value) {
      const info = acc.account.data?.parsed?.info;
      if (!info || !info.tokenAmount) continue;
      const ui = info.tokenAmount.uiAmount || 0;
      total += ui;
    }
    // Return raw uiAmount (float)
    return total;
  } catch (err) {
    console.error("❌ getTokenBalanceForWallet failed:", err?.message || err);
    throw err;
  }
}

// quick helper to check and optionally store verified holder
async function verifyAndStoreHolder(wallet, username, storeIfVerified = true) {
  if (!wallet) return { verified: false, reason: "No wallet" };
  if (!runtimeConfig) await loadConfig();

  let balance = 0;
  try {
    balance = await getTokenBalanceForWallet(wallet);
  } catch (err) {
    return { verified: false, reason: "rpc_error", err: err?.message };
  }

  const whole = Math.floor(balance); // only whole tokens count
  const min = Number(runtimeConfig.minHoldAmount || 0);
  const verified = whole >= min;

  if (verified && storeIfVerified) {
    const holders = await getHolderList();
    holders[wallet] = {
      username: username || holders[wallet]?.username || null,
      wallet,
      verifiedAt: new Date().toISOString(),
      lastChecked: new Date().toISOString()
    };
    try {
      await putHolderList(holders);
    } catch (err) {
      console.warn("⚠️ Failed to store holder:", err?.message || err);
    }
  } else {
    // update lastChecked timestamp if exists in list
    const holders = await getHolderList();
    if (holders[wallet]) {
      holders[wallet].lastChecked = new Date().toISOString();
      try { await putHolderList(holders); } catch(_) {}
    }
  }

  return { verified, balance: whole, minRequired: min };
}

// === TELEGRAM: helper sendSafeMessage ===
async function sendSafeMessage(chatId, message, opts = {}) {
  try {
    await bot.sendMessage(chatId, message, Object.assign({ parse_mode: "HTML", disable_web_page_preview: true }, opts));
  } catch (err) {
    console.error("❌ Telegram send failed:", err?.message || err);
    throw err;
  }
}

// === Image composition (sharp) ===
// Compose banner + graph + overlay text into a single PNG buffer
// Accepts base64Graph: data:image/png;base64,... OR raw base64
async function composePostImage({ base64Graph, username, score, width = 1200 }) {
  // normalize base64
  if (!base64Graph) throw new Error("Missing base64Graph");
  const base64 = base64Graph.replace(/^data:image\/\w+;base64,/, "");
  const graphBuf = Buffer.from(base64, "base64");

  // sizes
  const targetWidth = width;
  const bannerHeight = Math.round(width * 0.18); // banner strip
  const graphHeight = Math.round(width * 0.55); // graph area
  const footerHeight = Math.round(width * 0.12);

  // create banner PNG as SVG (text)
  const bannerSvg = Buffer.from(`
    <svg width="${targetWidth}" height="${bannerHeight}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#000000"/>
          <stop offset="100%" stop-color="#111111"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <text x="50%" y="50%" font-family="Press Start 2P, monospace" font-size="${Math.round(bannerHeight*0.28)}" fill="#ffd400" dominant-baseline="middle" text-anchor="middle">UnStableCoin • FUD Dodge</text>
    </svg>
  `);

  // create footer SVG with username + score
  const footerSvg = Buffer.from(`
    <svg width="${targetWidth}" height="${footerHeight}">
      <rect width="100%" height="100%" fill="#000000" />
      <text x="6%" y="45%" font-family="Press Start 2P, monospace" font-size="${Math.round(footerHeight*0.28)}" fill="#ffffff" dominant-baseline="middle" text-anchor="start">@${String(username).replace(/^@+/, '')}</text>
      <text x="94%" y="45%" font-family="Press Start 2P, monospace" font-size="${Math.round(footerHeight*0.28)}" fill="#ffd400" dominant-baseline="middle" text-anchor="end">MCap: ${formatMCap(score)}</text>
    </svg>
  `);

  // Resize graph to targetWidth x graphHeight preserving aspect
  const graphProcessed = await sharp(graphBuf)
    .resize(targetWidth, graphHeight, { fit: "contain", background: "#000" })
    .png()
    .toBuffer();

  // build final image: banner + graph + footer
  const final = await sharp({
    create: {
      width: targetWidth,
      height: bannerHeight + graphHeight + footerHeight,
      channels: 4,
      background: "#000000"
    }
  })
    .composite([
      { input: bannerSvg, top: 0, left: 0 },
      { input: graphProcessed, top: bannerHeight, left: 0 },
      { input: footerSvg, top: bannerHeight + graphHeight, left: 0 }
    ])
    .png()
    .toBuffer();

  return final;
}

// reuse formatMCap from your frontend code
function formatMCap(v) {
  if (typeof v !== "number") return v;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(3) + "M";
  return (v / 1000).toFixed(3) + "k";
}

// === ENDPOINT: frontend check-holding ===
app.get("/check-holding", async (req, res) => {
  const { wallet, username } = req.query;
  if (!wallet) return res.status(400).json({ error: "Missing wallet param" });
  try {
    const result = await verifyAndStoreHolder(wallet, username || null, false);
    res.json({ ok: true, wallet, username: username || null, verified: result.verified, balance: result.balance, minRequired: result.minRequired });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || "rpc_error" });
  }
});

// === ENDPOINT: request send to telegram (called by frontend) ===
// POST JSON:
// {
//   username: "@player",
//   score: 12345,
//   imageBase64: "data:image/png;base64,...",
//   chatId: "<chat id or group id>",
//   wallet: "<optional wallet to verify>"
// }
app.post("/send-telegram", async (req, res) => {
  try {
    const { username, score, imageBase64, chatId, wallet } = req.body;
    if (!username || typeof score !== "number" || !imageBase64 || !chatId) {
      return res.status(400).json({ ok: false, error: "Missing fields (username, score, imageBase64, chatId)" });
    }

    // load config
    if (!runtimeConfig) await loadConfig();

    // check holder if required
    if (runtimeConfig.holderVerificationEnabled && !runtimeConfig.allowPostingWithoutHold) {
      let verified = false;
      try {
        if (wallet) {
          const v = await verifyAndStoreHolder(wallet, username, true);
          verified = v.verified;
        } else {
          // try to infer from stored holders by username -> search list
          const holders = await getHolderList();
          verified = Object.values(holders).some(h => (h.username || "").toLowerCase() === String(username).replace(/^@+/, "").toLowerCase());
        }
      } catch (err) {
        console.warn("Holder check error:", err?.message || err);
      }

      if (!verified) {
        return res.status(403).json({ ok: false, error: "Not verified holder", message: "Posting disabled — you must verify wallet holding required $US amount." });
      }
    }

    // compose image
    let imgBuffer;
    try {
      imgBuffer = await composePostImage({ base64Graph: imageBase64, username, score });
    } catch (err) {
      console.error("❌ composePostImage failed:", err?.message || err);
      return res.status(500).json({ ok: false, error: "compose_error" });
    }

    // send the photo to Telegram
    try {
      const caption = `🏆 <b>${String(username)}</b>\nMCap: ${formatMCap(score)}\nShared from UnStableCoin FUD Dodge`;
      // bot.sendPhoto can accept buffer
      await bot.sendPhoto(chatId, imgBuffer, { caption, parse_mode: "HTML" });
      return res.json({ ok: true, message: "Posted to Telegram" });
    } catch (err) {
      console.error("❌ sendPhoto failed:", err?.message || err);
      return res.status(500).json({ ok: false, error: "telegram_send_failed", details: err?.message || String(err) });
    }

  } catch (err) {
    console.error("❌ /send-telegram error:", err?.message || err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// === Admin helper: produce verified winners list after event is finished ===
async function getVerifiedWinnersForEvent() {
  const meta = await getEventMeta();
  if (!meta.endDate) throw new Error("No event configured");
  // ensure event is ended
  const end = DateTime.fromISO(meta.endDate);
  if (DateTime.now().toUTC() < end) throw new Error("Event not finished");

  // get event scores and holders
  const { scores } = await getEventData();
  const holders = await getHolderList();

  // filter event scores by holders map (wallets mapped to username) - we stored by wallet, with optional username
  // But event scores are keyed by username (e.g. "@bob"). We'll produce winners that are both in event scores and in holders by username matching.
  const holderUsernames = new Set(Object.values(holders).map(h => (h.username || "").toLowerCase()));
  // also include those who were stored with username null but wallet - those won't match; admins can cross-check separately
  const verifiedEntries = Object.entries(scores)
    .filter(([username, score]) => holderUsernames.has(String(username).replace(/^@+/, "").toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .map(([username, score]) => ({ username, score }));

  return verifiedEntries;
}

// === Telegram command: /verifywallet <wallet> (can be run by user to check & store) ===
bot.onText(/\/verifywallet(?:\s+)?(.+)?/, async (msg, match) => {
  const wallet = (match && match[1]) ? match[1].trim() : null;
  if (!wallet) return sendSafeMessage(msg.chat.id, "Usage: /verifywallet <SOL_WALLET_ADDRESS>\nThis will check your $US balance and mark you verified if you meet the minimum.");
  await sendSafeMessage(msg.chat.id, "Checking wallet, please wait...");
  try {
    const result = await verifyAndStoreHolder(wallet, "@" + ((msg.from.username || msg.from.first_name || "unknown")), true);
    if (result.verified) {
      await sendSafeMessage(msg.chat.id, `✅ Wallet ${wallet} verified!\nBalance (whole tokens): ${result.balance}\nYou may now post ATH images.`);
    } else {
      await sendSafeMessage(msg.chat.id, `❌ Not enough $US.\nBalance: ${result.balance} (required: ${result.minRequired}).`);
    }
  } catch (err) {
    console.error("❌ /verifywallet error:", err?.message || err);
    await sendSafeMessage(msg.chat.id, `⚠️ Verification failed: ${err?.message || "error"}`);
  }
});

// === Telegram command: /checkholder <wallet> (public check) ===
bot.onText(/\/checkholder(?:\s+)?(.+)?/, async (msg, match) => {
  const wallet = (match && match[1]) ? match[1].trim() : null;
  if (!wallet) return sendSafeMessage(msg.chat.id, "Usage: /checkholder <SOL_WALLET_ADDRESS>");
  try {
    const result = await verifyAndStoreHolder(wallet, null, false);
    if (result.verified) {
      await sendSafeMessage(msg.chat.id, `✅ Holder confirmed. Balance (whole): ${result.balance} (min required: ${result.minRequired})`);
    } else {
      await sendSafeMessage(msg.chat.id, `❌ Not a qualifying holder. Balance (whole): ${result.balance} (min required: ${result.minRequired})`);
    }
  } catch (err) {
    console.error("❌ /checkholder error:", err?.message || err);
    await sendSafeMessage(msg.chat.id, `⚠️ Check failed: ${err?.message || "error"}`);
  }
});

// === Telegram admin: /verifiedwinners — export verified winners after event end ===
bot.onText(/\/verifiedwinners/, async (msg) => {
  const username = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 You are not authorized to run this command.");

  try {
    const winners = await getVerifiedWinnersForEvent();
    if (!winners || winners.length === 0) {
      return sendSafeMessage(msg.chat.id, "No verified winners found (or none passed the holder check).");
    }
    // send as chunked message
    const lines = winners.map((w, i) => `${i + 1}. <b>${w.username}</b> – ${w.score} pts`);
    sendChunked(msg.chat.id, "<b>✅ Verified Winners (Event)</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /verifiedwinners error:", err?.message || err);
    sendSafeMessage(msg.chat.id, `⚠️ Could not produce verified winners: ${err?.message || err}`);
  }
});

// === Admin command to manually post a player's ATH into a chat (admin only) ===
// /postath <@username> <chatId>
// If chatId omitted uses current chat
bot.onText(/\/postath(?:\s+)?(@\w+)(?:\s+)?(\-?\d+)?/, async (msg, match) => {
  const username = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

  const targetUser = match[1];
  const chatId = match[2] ? match[2] : msg.chat.id;
  if (!targetUser) return sendSafeMessage(msg.chat.id, "Usage: /postath <@username> [chatId]");

  // find player's ATH from main/event bins
  try {
    const main = await getLeaderboard();
    const uname = String(targetUser).startsWith("@") ? targetUser : "@" + targetUser;
    const score = main[uname] || 0;
    // For image, we don't have a graph here — so send a text post with summary
    const outText = `🏆 <b>${uname}</b>\nAll-time MCap: ${formatMCap(score)}\nShared by admins.`;
    await bot.sendMessage(chatId, outText, { parse_mode: "HTML" });
    await sendSafeMessage(msg.chat.id, `✅ Posted ${uname} ATH to ${chatId}`);
  } catch (err) {
    console.error("❌ /postath error:", err?.message || err);
    await sendSafeMessage(msg.chat.id, `Failed to post ATH: ${err?.message || err}`);
  }
});

// === Retain your existing event/leaderboard endpoints (unchanged core) ===
// We'll reuse available functions you already provided earlier in base file
// getEventData(), getLeaderboard(), getEventMeta() are implemented below:
async function getLeaderboard() {
  try {
    const res = await axios.get(MAIN_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let data = res.data.record || {};
    if (data.scores && typeof data.scores === "object") data = data.scores;
    const clean = {};
    for (const [u, v] of Object.entries(data)) {
      const n = parseFloat(v);
      if (!isNaN(n)) clean[u] = n;
    }
    return clean;
  } catch (err) {
    console.error("❌ Error loading leaderboard:", err.message || err);
    return {};
  }
}

async function getEventData() {
  try {
    const res = await axios.get(EVENT_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let data = res.data.record || {};
    if (data.scores?.scores) data = data.scores.scores;
    else if (data.scores) data = data.scores;
    const clean = {};
    for (const [u, v] of Object.entries(data)) {
      const n = parseFloat(v);
      if (!isNaN(n)) clean[u] = n;
    }
    return { scores: clean };
  } catch (err) {
    console.error("❌ Error fetching event data:", err.message || err);
    return { scores: {} };
  }
}

async function getEventMeta() {
  try {
    const res = await axios.get(`${META_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    const payload = res.data.record || res.data || {};
    return {
      title: payload.title || payload.name || "Current Event",
      info: payload.info || payload.description || "",
      endDate: payload.endDate || null,
      timezone: payload.timezone || "Europe/Stockholm",
      updatedAt: payload.updatedAt || res.data?.metadata?.modifiedAt || new Date().toISOString(),
      raw: payload
    };
  } catch (err) {
    console.error("❌ Error fetching event meta:", err?.message || err);
    return {
      title: "No active event",
      info: "No description available.",
      endDate: null,
      timezone: "Europe/Stockholm",
      updatedAt: new Date().toISOString(),
      raw: {}
    };
  }
}

// existing event and leaderboard endpoints (kept)
app.get("/event", async (req, res) => {
  try {
    const meta = await getEventMeta();
    res.json({
      title: meta.title,
      info: meta.info,
      endDate: meta.endDate,
      timezone: meta.timezone,
      updatedAt: meta.updatedAt,
      open: isEventOpen(meta)
    });
  } catch (err) {
    console.error("❌ /event route error:", err?.message || err);
    res.status(500).json({ error: "Internal event fetch error" });
  }
});

app.get("/leaderboard", async (req, res) => {
  try {
    const data = await getLeaderboard();
    const sorted = Object.entries(data)
      .sort((a, b) => b[1] - a[1])
      .map(([username, score]) => ({ username, score }));
    res.json(sorted);
  } catch (err) {
    console.error("❌ Failed /leaderboard:", err?.message || err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

// keep eventtop10, eventtop50 endpoints
app.get("/eventtop10", async (req, res) => {
  try {
    const { scores } = await getEventData();
    const sorted = Object.entries(scores)
      .filter(([u]) => !u.startsWith("_"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([username, score]) => ({ username, score }));
    res.json(sorted);
  } catch (err) {
    console.error("❌ Failed /eventtop10:", err?.message || err);
    res.status(500).json({ error: "Failed to load event top10" });
  }
});

app.get("/eventtop50", async (req, res) => {
  try {
    const { scores } = await getEventData();
    const sorted = Object.entries(scores)
      .filter(([u]) => !u.startsWith("_"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([username, score]) => ({ username, score }));
    res.json(sorted);
  } catch (err) {
    console.error("❌ Failed /eventtop50:", err?.message || err);
    res.status(500).json({ error: "Failed to load event top50" });
  }
});

// existing submit endpoint left unchanged (you had it previously) - copy/paste from your baseline submit
app.post("/submit", async (req, res) => {
  try {
    const { username, score, target } = req.body;
    const adminKey = req.headers["x-admin-key"];
    const isAdmin = adminKey && adminKey === RESET_KEY;

    if (!username || typeof score !== "number") {
      return res.status(400).json({ error: "Invalid data" });
    }

    console.log(`📥 Submit received → ${username}: ${score} (${target || "both"})`);

    // === Load event meta for status check ===
    let eventMeta = {};
    try {
      const resp = await axios.get(
        `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}/latest`,
        { headers: { "X-Master-Key": JSONBIN_KEY } }
      );
      eventMeta = resp.data.record || {};
    } catch (err) {
      console.warn("⚠️ Failed to load event meta:", err.message);
    }

    const now = DateTime.now().toUTC();
    const end = eventMeta.endDate ? DateTime.fromISO(eventMeta.endDate) : null;
    const eventActive = end ? now < end : false;

    // === If event closed and not admin, block event target ===
    if (!eventActive && !isAdmin && target !== "main") {
      console.log(`⏳ Event closed — ${username}'s event score ignored.`);
      return res.json({
        success: false,
        message: "⚠️ Event has ended. Stay tuned for the next ⚡️ UnStable Challenge!",
        eventActive: false,
        endDate: eventMeta.endDate || null,
      });
    }

    // MAIN
    if (target !== "event") {
      const main = await getLeaderboard();
      const prev = main[username] || 0;
      if (score > prev || isAdmin) {
        main[username] = score;
        await axios.put(MAIN_BIN_URL, main, {
          headers: {
            "Content-Type": "application/json",
            "X-Master-Key": JSONBIN_KEY,
          },
        });
        console.log(`🔥 Main updated for ${username}: ${score}`);
      }
    }

    // EVENT
    if (target !== "main") {
      const { scores } = await getEventData();
      const prev = scores[username] || 0;
      if (score > prev || isAdmin) {
        scores[username] = score;
        await axios.put(
          EVENT_BIN_URL,
          { scores },
          {
            headers: {
              "Content-Type": "application/json",
              "X-Master-Key": JSONBIN_KEY,
            },
          }
        );
        console.log(`⚡️ Event updated for ${username}: ${score}`);
      }
    }

    res.json({
      success: true,
      message: "✅ Score submitted successfully.",
      eventActive: eventActive,
      endDate: eventMeta.endDate || null,
    });
  } catch (err) {
    console.error("❌ Submit failed:", err.message);
    res.status(500).json({ error: "Failed to submit score" });
  }
});

// utility: chunked sender (reused)
function sendChunked(chatId, header, lines, maxLen = 3500) {
  let buf = header;
  for (const line of lines) {
    if ((buf + line + "\n").length > maxLen) {
      sendSafeMessage(chatId, buf.trim());
      buf = header + line + "\n";
    } else {
      buf += line + "\n";
    }
  }
  if (buf.trim()) sendSafeMessage(chatId, buf.trim());
}

// start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 UnStableCoinBot running on port ${PORT}`));
