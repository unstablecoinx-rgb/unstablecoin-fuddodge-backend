// === UnStableCoin Game Bot ===
// ⚡ Version: Event start+end, holder-gated event submits, winners continuous-hold check, improved /help, /event
// Author: UnStableCoin Community

/*
  Required environment variables:
  - TELEGRAM_BOT_TOKEN
  - JSONBIN_ID                (main leaderboard bin)
  - EVENT_JSONBIN_ID          (event leaderboard bin)
  - JSONBIN_KEY               (jsonbin master key)
  - EVENT_META_JSONBIN_ID     (event meta bin: title, info, startDate, endDate, timezone)
  - RESET_KEY                 (admin/reset key)
  - CONFIG_JSONBIN_ID         (config bin: token mint, minHoldAmount)
  - HOLDER_JSONBIN_ID         (holders list bin; array of {username, wallet, verifiedAt})
  - RENDER_EXTERNAL_HOSTNAME  (optional; used for webhook URL construction)
  - SOLANA_RPC_URL            (optional; otherwise uses clusterApiUrl from @solana/web3.js)
*/

const CONFIG = {
  tokenMint: '6zzHz3X3s53zhEqyBMmokZLh6Ba5EfC5nP3XURzYpump',
  minHoldAmount: 500000,
  network: 'mainnet-beta'
};

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const { DateTime } = require("luxon");
const sharp = require("sharp");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");

// === ENVIRONMENT ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;
const EVENT_JSONBIN_ID = process.env.EVENT_JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const EVENT_META_JSONBIN_ID = process.env.EVENT_META_JSONBIN_ID;
const RESET_KEY = process.env.RESET_KEY;
const CONFIG_JSONBIN_ID = process.env.CONFIG_JSONBIN_ID;
const HOLDER_JSONBIN_ID = process.env.HOLDER_JSONBIN_ID;
const RENDER_EXTERNAL_HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || null;

if (
  !TELEGRAM_BOT_TOKEN ||
  !JSONBIN_ID ||
  !EVENT_JSONBIN_ID ||
  !JSONBIN_KEY ||
  !EVENT_META_JSONBIN_ID ||
  !RESET_KEY ||
  !CONFIG_JSONBIN_ID ||
  !HOLDER_JSONBIN_ID
) {
  console.error("❌ Missing env. Set TELEGRAM_BOT_TOKEN, JSONBIN_ID, EVENT_JSONBIN_ID, JSONBIN_KEY, EVENT_META_JSONBIN_ID, RESET_KEY, CONFIG_JSONBIN_ID, HOLDER_JSONBIN_ID");
  process.exit(1);
}

// === CONSTANTS & URLS ===
const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;
const META_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}`;
const CONFIG_BIN_URL = `https://api.jsonbin.io/v3/b/${CONFIG_JSONBIN_ID}`;
const HOLDER_BIN_URL = `https://api.jsonbin.io/v3/b/${HOLDER_JSONBIN_ID}`;

const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot", "pachenko_14"]; // lowercase usernames
const PORT = process.env.PORT || 10000;

// === EXPRESS ===
const app = express();
app.use(cors({ origin: ["https://theunstable.io", "https://www.theunstable.io", "https://t.me", "https://web.telegram.org", "https://telegram.org"] }));
app.use(bodyParser.json({ limit: "8mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// === TELEGRAM BOT (webhook) ===
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

(async () => {
  try {
    const host = RENDER_EXTERNAL_HOSTNAME || `https://unstablecoin-fuddodge-backend.onrender.com`;
    const webhookUrl = `${host.replace(/\/$/, "")}/bot${TELEGRAM_BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook set to: ${webhookUrl}`);
  } catch (err) {
    console.warn("⚠️ setWebHook warning:", err?.message || err);
  }
})();

app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  try { bot.processUpdate(req.body); } catch (err) { console.error("❌ processUpdate failed:", err?.message || err); }
  res.sendStatus(200);
});

app.get("/", (req, res) => res.send("💛 UnStableCoin Game Bot is alive"));

// ============================
// JSONBin helpers
// ============================
async function readBin(url) {
  try {
    const resp = await axios.get(url, { headers: { "X-Master-Key": JSONBIN_KEY } });
    return resp.data.record || resp.data || {};
  } catch (err) {
    console.error("❌ readBin:", err?.message || err);
    return null;
  }
}
async function writeBin(url, payload) {
  const headers = { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY };
  // small retry for race safety
  for (let i = 0; i < 2; i++) {
    try {
      const resp = await axios.put(url, payload, { headers });
      return resp.data;
    } catch (err) {
      if (i === 1) throw err;
      await new Promise(r => setTimeout(r, 120));
    }
  }
}
async function getConfig() {
  const cfg = (await readBin(CONFIG_BIN_URL)) || {};
  return Object.assign(
    {
      tokenMint: CONFIG.tokenMint,
      minHoldAmount: CONFIG.minHoldAmount,
      network: CONFIG.network,
      holderVerificationEnabled: true,
      allowPostingWithoutHold: false,
      lastUpdated: new Date().toISOString(),
    },
    cfg
  );
}

// Holders as ARRAY everywhere
async function getHoldersArray() {
  const list = (await readBin(HOLDER_BIN_URL)) || [];
  return Array.isArray(list) ? list : [];
}
async function saveHoldersArray(arr) {
  if (!Array.isArray(arr)) throw new Error("holders must be array");
  await writeBin(HOLDER_BIN_URL, arr);
}
function findHolderByUsername(arr, username) {
  const u = String(username || "").toLowerCase();
  return arr.find(h => (h.username || "").toLowerCase() === u);
}

// Leaderboards
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
    console.error("❌ getLeaderboard:", err.message || err);
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
    console.error("❌ getEventData:", err.message || err);
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
      startDate: payload.startDate || null,
      endDate: payload.endDate || null,
      timezone: payload.timezone || "Europe/Stockholm",
      updatedAt: payload.updatedAt || res.data?.metadata?.modifiedAt || new Date().toISOString(),
      raw: payload
    };
  } catch (err) {
    console.error("❌ getEventMeta:", err?.message || err);
    return {
      title: "No active event",
      info: "No description available.",
      startDate: null,
      endDate: null,
      timezone: "Europe/Stockholm",
      updatedAt: new Date().toISOString(),
      raw: {}
    };
  }
}

// ============================
// Solana holder check
// ============================
async function checkSolanaHolding(walletAddress, requiredWholeTokens) {
  try {
    const cfg = await getConfig();
    const network = cfg.network || "mainnet-beta";
    const rpc = process.env.SOLANA_RPC_URL || clusterApiUrl(network);
    const conn = new Connection(rpc, "confirmed");

    const ownerPub = new PublicKey(walletAddress);
    const mintPub = new PublicKey(cfg.tokenMint);

    const parsed = await conn.getParsedTokenAccountsByOwner(ownerPub, { mint: mintPub });
    if (!parsed.value || parsed.value.length === 0) return { ok: false, amount: 0, decimals: 0 };

    let total = 0;
    let decimals = 0;
    for (const acc of parsed.value) {
      const info = acc.account?.data?.parsed?.info;
      if (info?.tokenAmount) {
        total += parseFloat(info.tokenAmount.uiAmount || 0);
        decimals = info.tokenAmount.decimals || 0;
      }
    }
    const whole = Math.floor(total);
    const ok = whole >= requiredWholeTokens;
    return { ok, amount: total, whole, decimals };
  } catch (err) {
    console.error("❌ checkSolanaHolding:", err?.message || err);
    return { ok: false, amount: 0, whole: 0, decimals: 0, error: err?.message || String(err) };
  }
}

// ============================
// Image composition
// ============================
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeXml(unsafe) { return escapeHtml(unsafe); }

async function composeShareImage(graphBase64, username, score) {
  const W = 1200, H = 628;
  let base64 = graphBase64 || "";
  const m = base64.match(/^data:image\/(png|jpeg);base64,(.*)$/);
  if (m) base64 = m[2];
  let graphBuffer = null;
  try { if (base64) graphBuffer = Buffer.from(base64, "base64"); } catch (_) {}
  const bgSvg = `<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#070707"/><stop offset="100%" stop-color="#0b0b10"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  const title = "UnStableCoin — FUD Dodge";
  const sub = `@${String(username).replace(/^@+/, "")}  •  MCap: ${score}`;
  const textSvg = `<svg width="${W}" height="${H}">
  <style>
    .title { fill: #ffd400; font-family: 'Press Start 2P', monospace; font-size:34px; font-weight:bold; }
    .sub { fill: #ffffff; font-family: 'Press Start 2P', monospace; font-size:22px; opacity:0.95; }
    .badge { fill: rgba(255,212,0,0.06); stroke: rgba(255,212,0,0.18); stroke-width:1; rx:8; }
  </style>
  <rect x="40" y="36" width="${W - 80}" height="100" rx="10" class="badge" />
  <text x="80" y="80" class="title">${escapeXml(title)}</text>
  <text x="80" y="110" class="sub">${escapeXml(sub)}</text>
</svg>`;
  try {
    let img = sharp(Buffer.from(bgSvg)).resize(W, H);
    if (graphBuffer) {
      const graphW = Math.floor(W * 0.86);
      const graphH = Math.floor(H * 0.62);
      const graphImg = await sharp(graphBuffer).resize(graphW, graphH, { fit: "contain", background: { r: 0, g: 0, b: 0, a: 0 } }).toBuffer();
      img = img.composite([{ input: graphImg, left: Math.floor((W - graphW) / 2), top: Math.floor(H * 0.18) }, { input: Buffer.from(textSvg), left: 0, top: 0 }]);
    } else {
      img = img.composite([{ input: Buffer.from(textSvg), left: 0, top: 0 }]);
    }
    return await img.png().toBuffer();
  } catch (err) {
    console.error("❌ composeShareImage:", err?.message || err);
    throw err;
  }
}

// ============================
// Helpers
// ============================
function remainingTimeString(endISO, tz = "Europe/Stockholm") {
  try {
    const now = DateTime.now().setZone(tz);
    const end = DateTime.fromISO(endISO).setZone(tz);
    let diff = end.diff(now, ["days", "hours", "minutes", "seconds"]).toObject();
    if (diff.days < 0 || diff.hours < 0 || diff.minutes < 0) return "0m";
    const d = Math.floor(diff.days || 0);
    const h = Math.floor(diff.hours || 0);
    const m = Math.floor(diff.minutes || 0);
    const s = Math.floor(diff.seconds || 0);
    return (d ? `${d}d ` : "") + (h ? `${h}h ` : "") + (m ? `${m}m ` : s ? `${s}s` : "");
  } catch { return ""; }
}
async function sendSafeMessage(chatId, message, opts = {}) {
  try { await bot.sendMessage(chatId, message, Object.assign({ parse_mode: "HTML", disable_web_page_preview: true }, opts)); } catch (err) { console.error("❌ Telegram send:", err?.message || err); }
}
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

// ============================
// Telegram Commands
// ============================

// /help — full, dynamic overview
bot.onText(/\/help$/, async (msg) => {
  try {
    const uname = msg.from.username?.toLowerCase() || "";
    const isAdmin = ADMIN_USERS.includes(uname);

    let text = `💛 <b>UnStableCoin Game Bot — Commands</b>\n\n`;

    text += `🎮 <b>Public</b>\n`;
    text += `/play — Open the FUD Dodge game\n`;
    text += `/info — How to play and score\n`;
    text += `/top10 — Top 10 global\n`;
    text += `/top50 — Top 50 global\n`;
    text += `/event — Event info and status\n`;
    text += `/eventtop10 — Event top 10\n`;
    text += `/eventtop50 — Event top 50\n`;
    text += `/help — Show this help\n\n`;

    text += `🪙 <b>Holders</b>\n`;
    text += `Verify inside the game. Only verified holders can submit event scores.\n\n`;

    if (isAdmin) {
      text += `🧰 <b>Admins</b>\n`;
      text += `/setevent &lt;Title&gt; | &lt;Info&gt; | &lt;StartDate&gt; | &lt;StartTime&gt; | &lt;EndDate&gt; | &lt;EndTime&gt; | [TZ]\n`;
      text += `/setholdingreq &lt;amount&gt;\n`;
      text += `/winners [n]\n`;
      text += `/validatewinners\n`;
      text += `/resetevent\n`;
      text += `/holders\n\n`;
    }

    text += `⚡ Only verified holders can post event scores. View is open for all.`;

    await sendSafeMessage(msg.chat.id, text);
  } catch (err) {
    console.error("❌ /help:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Could not display help.");
  }
});

// /play
bot.onText(/\/play/, async (msg) => {
  try {
    const isPrivate = msg.chat.type === "private";
    if (isPrivate) {
      await bot.sendMessage(msg.chat.id, "🎮 <b>Play FUD Dodge</b>", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⚡ Open Game", web_app: { url: "https://theunstable.io/fuddodge" } }]] },
      });
    } else {
      await bot.sendMessage(msg.chat.id, "💨 FUD levels too high here 😅\nPlay safely in DM 👇", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⚡ Open DM to Play", url: `https://t.me/${(await bot.getMe()).username}?start=play` }]] },
      });
    }
  } catch (err) { console.error("❌ /play:", err?.message || err); }
});

// /info
bot.onText(/\/info|\/howtoplay/, async (msg) => {
  const text = `
🎮 <b>How to Play FUD Dodge</b>

🪙 Dodge FUD and scams. Collect coins and memes to grow your MCap.
⚡ Power-ups: Lightning, Coin, Green Candle, Meme
💀 Threats: FUD Skull, Red Candle, The Scammer (-50%)
📊 Compete: /top10  /eventtop10

Stay unstable. 💛⚡`;
  await sendSafeMessage(msg.chat.id, text);
});

// /event — show current event window and status
bot.onText(/\/event$/, async (msg) => {
  try {
    const meta = await getEventMeta();
    const zone = meta.timezone || "Europe/Stockholm";
    const now = DateTime.now().setZone(zone);

    const start = meta.startDate ? DateTime.fromISO(meta.startDate).setZone(zone) : null;
    const end = meta.endDate ? DateTime.fromISO(meta.endDate).setZone(zone) : null;

    let body = `<b>${escapeHtml(meta.title)}</b>\n\n${escapeHtml(meta.info)}\n`;
    if (start) body += `\n🕓 <b>Start:</b> ${start.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
    if (end) {
      body += `\n⏳ <b>End:</b> ${end.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
      if (now < start) {
        const until = start.diff(now, ["hours", "minutes"]);
        body += `\n\n🕒 <b>Status:</b> Not started\nBegins in: ${Math.floor(until.hours)}h ${Math.floor(until.minutes)}m`;
      } else if (now >= start && now <= end) {
        const left = end.diff(now, ["hours", "minutes"]);
        body += `\n\n⚡ <b>Status:</b> ACTIVE\nTime left: ${Math.floor(left.hours)}h ${Math.floor(left.minutes)}m`;
      } else {
        body += `\n\n🏁 <b>Status:</b> Event ended`;
      }
    }
    await sendSafeMessage(msg.chat.id, body);
  } catch (err) {
    console.error("❌ /event:", err?.message || err);
    await sendSafeMessage(msg.chat.id, "⚠️ Could not load event info.");
  }
});

// /top10 /top50 (main)
bot.onText(/\/top10/, async (msg) => {
  const data = await getLeaderboard();
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return sendSafeMessage(msg.chat.id, "No scores yet!");
  const lines = sorted.slice(0, 10).map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
  sendChunked(msg.chat.id, "<b>🏆 Top 10 Players</b>\n\n", lines);
});
bot.onText(/\/top50/, async (msg) => {
  const data = await getLeaderboard();
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return sendSafeMessage(msg.chat.id, "No scores yet!");
  const lines = sorted.slice(0, 50).map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
  sendChunked(msg.chat.id, "<b>📈 Top 50 Players</b>\n\n", lines);
});

// /eventtop10 /eventtop50 (public view; submissions gated in /submit)
bot.onText(/\/eventtop10/, async (msg) => {
  try {
    const { scores } = await getEventData();
    const sorted = Object.entries(scores).filter(([u]) => !u.startsWith("_")).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!sorted.length) return sendSafeMessage(msg.chat.id, "No event scores yet.");
    const lines = sorted.map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
    sendChunked(msg.chat.id, "<b>🥇 Event Top 10</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /eventtop10:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to load event top 10.");
  }
});
bot.onText(/\/eventtop50/, async (msg) => {
  try {
    const { scores } = await getEventData();
    const sorted = Object.entries(scores).filter(([u]) => !u.startsWith("_")).sort((a, b) => b[1] - a[1]).slice(0, 50);
    if (!sorted.length) return sendSafeMessage(msg.chat.id, "No event scores yet.");
    const lines = sorted.map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
    sendChunked(msg.chat.id, "<b>🥇 Event Top 50</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /eventtop50:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to load event top 50.");
  }
});

// ============================
// Admin: setholdingreq, winners, validatewinners, resetevent, setevent
// ============================

// /setholdingreq <amount>
bot.onText(/\/setholdingreq ?(.+)?/, async (msg, match) => {
  try {
    const from = (msg.from.username || "").trim().toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");
    const param = (match && match[1]) ? match[1].trim() : null;
    if (!param || isNaN(parseInt(param))) {
      return sendSafeMessage(msg.chat.id, `Usage: /setholdingreq <whole_tokens>\nExample: /setholdingreq 500000`);
    }
    const amount = parseInt(param, 10);
    const cur = (await readBin(CONFIG_BIN_URL)) || {};
    const merged = Object.assign({}, cur, { minHoldAmount: amount, lastUpdated: new Date().toISOString() });
    await writeBin(CONFIG_BIN_URL, merged);
    await sendSafeMessage(msg.chat.id, `✅ Holding requirement set to ${amount} $US.\nConfig saved.`);
  } catch (err) {
    console.error("❌ /setholdingreq:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to update config.");
  }
});

// /winners [n] — must have held for the whole event window
bot.onText(/\/winners ?(.*)?/, async (msg, match) => {
  try {
    const from = (msg.from.username || "").trim().toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const nParam = (match && match[1]) ? parseInt(match[1].trim()) : 10;
    const n = isNaN(nParam) ? 10 : nParam;

    const meta = await getEventMeta();
    if (!meta.startDate || !meta.endDate) return sendSafeMessage(msg.chat.id, "⚠️ Event missing startDate or endDate.");

    const start = DateTime.fromISO(meta.startDate).toUTC();
    const end = DateTime.fromISO(meta.endDate).toUTC();
    const now = DateTime.now().toUTC();
    if (now < end) return sendSafeMessage(msg.chat.id, "⏳ Event has not ended yet.");

    const { scores } = await getEventData();
    const holders = await getHoldersArray();
    const cfg = await getConfig();
    const required = cfg.minHoldAmount || 0;

    // top candidates
    const top = Object.entries(scores)
      .filter(([u]) => !u.startsWith("_"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

    const results = [];
    for (const [username, score] of top) {
      const h = findHolderByUsername(holders, username);
      if (!h || !h.wallet) {
        results.push({ username, ok: false, reason: "no wallet" });
        continue;
      }
      // must be verified before start
      const wasVerified = h.verifiedAt ? DateTime.fromISO(h.verifiedAt).toUTC() <= start : false;

      // live check at winner computation time (proxy for "end" balance)
      const endCheck = await checkSolanaHolding(h.wallet, required);

      const qualifies = Boolean(wasVerified && endCheck.ok);
      results.push({
        username,
        ok: qualifies,
        amount: endCheck.amount || 0,
        reason: qualifies ? "held throughout" : (wasVerified ? "sold or dropped below" : "joined late")
      });
    }

    const header = `<b>🏁 Confirmed Winners — Continuous Holders</b>\nEvent: ${escapeHtml(meta.title)}\nFrom ${start.toFormat("yyyy-MM-dd HH:mm")} to ${end.toFormat("yyyy-MM-dd HH:mm")}\n\n`;
    const lines = results.map((r, i) => `${i + 1}. ${r.username} — ${r.ok ? "✅" : "❌"} ${r.reason} ${r.amount ? "(" + Math.floor(r.amount) + ")" : ""}`);
    sendChunked(msg.chat.id, header, lines);
  } catch (err) {
    console.error("❌ /winners:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to compute winners.");
  }
});

// /validatewinners — quick re-check top 50 holders now
bot.onText(/\/validatewinners ?(.*)?/, async (msg) => {
  try {
    const from = (msg.from.username || "").trim().toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const { scores } = await getEventData();
    const holders = await getHoldersArray();
    const cfg = await getConfig();
    const required = cfg.minHoldAmount || 0;

    const sorted = Object.entries(scores).filter(([u]) => !u.startsWith("_")).sort((a, b) => b[1] - a[1]).slice(0, 50);
    const out = [];
    for (const [u] of sorted) {
      const h = findHolderByUsername(holders, u);
      if (!h || !h.wallet) { out.push({ u, ok: false, reason: "no wallet" }); continue; }
      const check = await checkSolanaHolding(h.wallet, required);
      out.push({ u, ok: check.ok, amount: check.amount || 0, reason: check.ok ? "ok" : "insufficient" });
    }
    const lines = out.map((r, i) => `${i + 1}. ${r.u} — ${r.ok ? "✅" : "❌"} ${r.amount ? "(" + Math.floor(r.amount) + ")" : ""} ${r.reason}`);
    sendChunked(msg.chat.id, `<b>🔎 Revalidation results (top 50)</b>\n`, lines);
  } catch (err) {
    console.error("❌ /validatewinners:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Validation failed.");
  }
});

// /resetevent
bot.onText(/\/resetevent/, async (msg) => {
  try {
    const from = (msg.from.username || "").trim().toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const chatId = msg.chat.id;
    await sendSafeMessage(chatId, "⚠️ Confirm reset of event leaderboard? Reply <b>YES</b> within 30s.");
    const listener = async (reply) => {
      if (reply.chat.id !== chatId) return;
      if ((reply.from.username || "").toLowerCase() !== from) return;
      if (String(reply.text || "").trim().toUpperCase() === "YES") {
        await writeBin(EVENT_BIN_URL, { scores: {} });
        await sendSafeMessage(chatId, "✅ Event leaderboard cleared.");
      } else {
        await sendSafeMessage(chatId, "❌ Cancelled.");
      }
      bot.removeListener("message", listener);
    };
    bot.on("message", listener);
    setTimeout(() => bot.removeListener("message", listener), 30000);
  } catch (err) {
    console.error("❌ /resetevent:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to reset event.");
  }
});

// /setevent — supports start and end
bot.onText(/\/setevent(.*)/, async (msg, match) => {
  try {
    const username = msg.from.username?.toLowerCase() || "";
    if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 You are not authorized.");

    const args = match[1]?.trim();
    if (!args) {
      return sendSafeMessage(msg.chat.id,
`🛠 <b>Create or update an event</b>

Use:
<code>/setevent &lt;Title&gt; | &lt;Description&gt; | &lt;Start Date&gt; | &lt;Start Time&gt; | &lt;End Date&gt; | &lt;End Time&gt; | [Timezone]</code>

Example:
<code>/setevent Meme Rally | Keep your MCap above FUD! | 2025-11-05 | 18:00 | 2025-11-10 | 18:00 | CET</code>`, { parse_mode: "HTML" });
    }

    const parts = args.split("|").map((s) => s.trim());
    const [title, info, startDateStr, startTimeStr, endDateStr, endTimeStr, tzStrRaw] = parts;
    const tzMap = { CET: "Europe/Stockholm", CEST: "Europe/Stockholm", UTC: "UTC", GMT: "UTC" };
    const zone = tzMap[tzStrRaw?.toUpperCase()] || tzStrRaw || "Europe/Stockholm";

    if (!startDateStr || !startTimeStr || !endDateStr || !endTimeStr) {
      return sendSafeMessage(msg.chat.id, "❌ Missing date or time.\nExample: /setevent Title | Info | 2025-11-05 | 18:00 | 2025-11-10 | 18:00 | CET");
    }

    const startDT = DateTime.fromFormat(`${startDateStr} ${startTimeStr}`, "yyyy-MM-dd HH:mm", { zone });
    const endDT = DateTime.fromFormat(`${endDateStr} ${endTimeStr}`, "yyyy-MM-dd HH:mm", { zone });
    if (!startDT.isValid || !endDT.isValid) return sendSafeMessage(msg.chat.id, "❌ Invalid date/time format.\nUse: YYYY-MM-DD | HH:mm | [TZ]");
    if (endDT <= startDT) return sendSafeMessage(msg.chat.id, "⚠️ End time must be after start time.");

    const newData = {
      title: title || "⚡️ Unstable Challenge",
      info: info || "Score big, stay unstable!",
      startDate: startDT.toUTC().toISO(),
      startLocal: startDT.setZone(zone).toFormat("yyyy-MM-dd HH:mm ZZZZ"),
      endDate: endDT.toUTC().toISO(),
      endLocal: endDT.setZone(zone).toFormat("yyyy-MM-dd HH:mm ZZZZ"),
      timezone: zone,
      updatedAt: new Date().toISOString(),
    };
    await writeBin(META_BIN_URL, newData);
    await sendSafeMessage(msg.chat.id, `✅ <b>Event updated</b>\n⚡️ <b>${escapeHtml(newData.title)}</b>\n${escapeHtml(newData.info)}\n🕓 From: ${newData.startLocal}\n⏳ To: ${newData.endLocal}`);
  } catch (err) {
    console.error("❌ /setevent:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to update event (internal error).");
  }
});

// ============================
// FRONTEND ENDPOINTS
// ============================

// Submit score: main always; event only if active and holder
app.post("/submit", async (req, res) => {
  try {
    const { username, score, target } = req.body;
    const adminKey = req.headers["x-admin-key"];
    const isAdmin = adminKey && adminKey === RESET_KEY;

    if (!username || typeof score !== "number") {
      return res.status(400).json({ error: "Invalid data" });
    }

    // Load event meta
    let eventMeta = {};
    try {
      const resp = await axios.get(`${META_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
      eventMeta = resp.data.record || {};
    } catch (err) {
      console.warn("⚠️ Failed to load event meta:", err.message);
    }

    const cfg = await getConfig();
    const now = DateTime.now().toUTC();
    const start = eventMeta.startDate ? DateTime.fromISO(eventMeta.startDate).toUTC() : null;
    const end = eventMeta.endDate ? DateTime.fromISO(eventMeta.endDate).toUTC() : null;
    const eventActive = start && end ? now >= start && now <= end : false;

    // MAIN always allowed unless explicitly targeting event only
    if (target !== "event") {
      const main = await getLeaderboard();
      const prev = main[username] || 0;
      if (score > prev || isAdmin) {
        const newMain = Object.assign({}, main, { [username]: score });
        await writeBin(MAIN_BIN_URL, newMain);
      }
    }

    // EVENT only when active and user is verified holder (or admin)
    if (target !== "main") {
      if (eventActive || isAdmin) {
        const holders = await getHoldersArray();
        const isHolder = !!findHolderByUsername(holders, username);
        if (!isHolder && !isAdmin && cfg.holderVerificationEnabled) {
          return res.json({
            success: false,
            message: "❌ You must be a verified holder to participate in events.",
            eventActive,
            endDate: eventMeta.endDate || null,
          });
        }

        const { scores } = await getEventData();
        const prev = scores[username] || 0;
        if (score > prev || isAdmin) {
          const newEvent = { scores: Object.assign({}, scores, { [username]: score }) };
          await writeBin(EVENT_BIN_URL, newEvent);
        }
      } else {
        // Not active or no window set
        if (!isAdmin) {
          return res.json({
            success: true,
            message: "⚠️ Event not active. Main leaderboard was updated if higher.",
            eventActive: false,
            startDate: eventMeta.startDate || null,
            endDate: eventMeta.endDate || null,
          });
        }
      }
    }

    res.json({ success: true, message: "✅ Score submitted.", eventActive, startDate: eventMeta.startDate || null, endDate: eventMeta.endDate || null });
  } catch (err) {
    console.error("❌ /submit:", err.message || err);
    res.status(500).json({ error: "Failed to submit score" });
  }
});

// Share image to Telegram
app.post("/share", async (req, res) => {
  try {
    const { username, score, chatId, imageBase64 } = req.body;
    if (!username || typeof score === "undefined" || !chatId) {
      return res.status(400).json({ error: "Missing username, score or chatId" });
    }

    const cfg = await getConfig();
    const holders = await getHoldersArray();

    if (!cfg.allowPostingWithoutHold) {
      const rec = findHolderByUsername(holders, username);
      if (!rec) return res.status(403).json({ ok: false, message: "User not a verified holder. Posting blocked." });
    }

    const imgBuf = await composeShareImage(imageBase64, username, score);
    const caption = `<b>${escapeHtml(String(username))}</b>\nMCap: ${escapeHtml(String(score))}\nShared from UnStableCoin FUD Dodge`;

    await bot.sendPhoto(chatId.toString(), imgBuf, { caption, parse_mode: "HTML" });
    res.json({ ok: true, message: "Posted to Telegram" });
  } catch (err) {
    console.error("❌ /share:", err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Holder verification (on-chain)
async function verifySolanaBalance(wallet) {
  try {
    const cfg = await getConfig();
    const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl(cfg.network), "confirmed");
    const publicKey = new PublicKey(wallet);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(cfg.tokenMint) });
    let totalBalance = 0;
    tokenAccounts.value.forEach(acc => {
      const amount = acc.account.data.parsed.info.tokenAmount.uiAmount;
      totalBalance += amount;
    });
    return totalBalance >= (cfg.minHoldAmount || CONFIG.minHoldAmount);
  } catch (err) {
    console.error("❌ verifySolanaBalance:", err);
    return false;
  }
}

// Verify holder
app.post("/verifyHolder", async (req, res) => {
  try {
    let { username, wallet } = req.body;
    if (!username || !wallet) return res.status(400).json({ ok: false, message: "Missing username or wallet." });

    username = username.trim();
    if (!username.startsWith("@")) username = "@" + username.replace(/^@+/, "");

    let holders = await getHoldersArray();
    const exists = findHolderByUsername(holders, username);
    if (exists) return res.json({ ok: true, message: "Already verified.", username: exists.username });

    const verified = await verifySolanaBalance(wallet);
    if (!verified) return res.json({ ok: false, message: "Wallet balance below minimum requirement." });

    holders.push({ username, wallet, verifiedAt: new Date().toISOString() });
    await saveHoldersArray(holders);

    return res.json({ ok: true, message: "✅ Holder verified successfully!", username });
  } catch (err) {
    console.error("❌ /verifyHolder:", err);
    res.status(500).json({ ok: false, message: "Server error verifying holder." });
  }
});

// Holder status
app.get("/holderStatus", async (req, res) => {
  try {
    let username = req.query.username;
    if (!username) return res.status(400).json({ verified: false, message: "Missing username" });
    username = username.trim();
    if (!username.startsWith("@")) username = "@" + username.replace(/^@+/, "");

    const holders = await getHoldersArray();
    const match = findHolderByUsername(holders, username);

    if (match) return res.json({ verified: true, username: match.username, wallet: match.wallet });
    return res.json({ verified: false });
  } catch (err) {
    console.error("❌ /holderStatus:", err);
    res.status(500).json({ verified: false, message: "Server error checking holder status" });
  }
});

// Public event tops for frontend
app.get("/eventtop10", async (req, res) => {
  try {
    const { scores } = await getEventData();
    const arr = Object.entries(scores)
      .filter(([u]) => !u.startsWith("_"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([username, score]) => ({ username, score }));
    res.json(arr);
  } catch (err) {
    console.error("❌ /eventtop10:", err?.message || err);
    res.status(500).json({ error: "Failed to load event top10" });
  }
});

app.get("/eventtop50", async (req, res) => {
  try {
    const { scores } = await getEventData();
    const arr = Object.entries(scores)
      .filter(([u]) => !u.startsWith("_"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([username, score]) => ({ username, score }));
    res.json(arr);
  } catch (err) {
    console.error("❌ /eventtop50:", err?.message || err);
    res.status(500).json({ error: "Failed to load event top50" });
  }
});

// Public event info for frontend
app.get("/event", async (req, res) => {
  try {
    const meta = await getEventMeta();
    const { title, info, startDate, endDate, timezone, updatedAt } = meta;
    res.json({ title, info, startDate, endDate, timezone, updatedAt });
  } catch (err) {
    console.error("❌ /event GET:", err?.message || err);
    res.status(500).json({ error: "Failed to load event info" });
  }
});

// Public main leaderboard for splash UI
app.get("/leaderboard", async (req, res) => {
  try {
    const data = await getLeaderboard();
    const sorted = Object.entries(data)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([username, score]) => ({ username, score }));
    res.json(sorted);
  } catch (err) {
    console.error("❌ /leaderboard:", err?.message || err);
    res.status(500).json({ ok: false, message: "Failed to load leaderboard." });
  }
});

// Admin: list holders
bot.onText(/\/holders/, async (msg) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const holders = await getHoldersArray();
    if (!holders.length) return sendSafeMessage(msg.chat.id, "📋 No holder records.");

    holders.sort((a, b) => new Date(b.verifiedAt || 0) - new Date(a.verifiedAt || 0));
    const lines = holders.map(h => `<b>${escapeHtml(h.username || "n/a")}</b> — ${escapeHtml(h.wallet || "n/a")} — ${h.verifiedAt || "n/a"}`);
    sendChunked(msg.chat.id, "<b>📋 Verified Holders</b>\n", lines);
  } catch (err) {
    console.error("❌ /holders:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to load holders.");
  }
});

// ============================
// START SERVER
// ============================
app.listen(PORT, () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
  (async () => {
    try {
      const cfg = await getConfig();
      console.log("✅ Config loaded:", { tokenMint: cfg.tokenMint, minHoldAmount: cfg.minHoldAmount, network: cfg.network });
    } catch (_) {}
  })();
});
