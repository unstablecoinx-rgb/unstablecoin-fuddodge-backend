// === Telegram leaderboards ===
async function sendTopList(msg, binUrl, title, limit = 10) {
  const scores = await getScores(binUrl);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!sorted.length) return bot.sendMessage(msg.chat.id, "No scores yet.");

  let text = `🏆 *${title}*\n\n`;
  sorted.forEach(([user, score], i) => {
    const rank = i + 1;
    const medal =
      rank === 1 ? "🥇" :
      rank === 2 ? "🥈" :
      rank === 3 ? "🥉" : " ";
    text += `${medal} ${rank}. ${user}: ${score}\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
}

// === Main leaderboard commands ===
bot.onText(/^\/top10$/, (msg) =>
  sendTopList(msg, MAIN_BIN_URL, "Top 10 FUD Dodgers", 10)
);

// === Event leaderboard commands ===
bot.onText(/^\/eventtop$/, (msg) =>
  sendTopList(msg, EVENT_BIN_URL, "Event Leaderboard (Top 10)", 10)
);

bot.onText(/^\/eventtop50$/, (msg) =>
  sendTopList(msg, EVENT_BIN_URL, "Event Leaderboard (Top 50)", 50)
);

// === Reset Event Leaderboard (Admin-only Telegram command) ===
bot.onText(/^\/resetevent(?:\s+(.+))?$/, async (msg, match) => {
  const key = match[1]?.trim();

  if (!key) {
    bot.sendMessage(
      msg.chat.id,
      "🔑 Please provide the reset key. Example:\n`/resetevent unstable_reset_2025`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (key !== RESET_KEY) {
    bot.sendMessage(msg.chat.id, "🚫 Invalid reset key. Access denied.");
    return;
  }

  try {
    await saveScores(EVENT_BIN_URL, {});
    console.log(`🧹 Event leaderboard reset via Telegram by ${msg.from.username || msg.from.first_name}`);
    bot.sendMessage(msg.chat.id, "✅ Event leaderboard successfully reset!");
  } catch (err) {
    console.error("❌ Reset failed:", err.message);
    bot.sendMessage(msg.chat.id, "⚠️ Failed to reset event leaderboard. Check server logs.");
  }
});

// === Play command ===
bot.onText(/^\/play$/, (msg) => bot.sendGame(msg.chat.id, "US_FUD_Dodge"));
