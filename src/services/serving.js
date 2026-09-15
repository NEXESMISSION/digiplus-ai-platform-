// Decides whether a bot may answer right now.
const db = require('../db');
const { sanitizeSettings } = require('../settings');
const { limitsFor } = require('../plans');

// A bot answers only while it is active and inside the account's bot allowance.
// After a downgrade the oldest active bots keep working.
async function servingContext(bot) {
  if (!bot || !bot.is_active) return null;
  const account = await db.getAccount(bot.account_id);
  if (!account) return null;
  const limits = limitsFor(account);
  const active = (await db.listBots(account.id)).filter((b) => b.is_active);
  const rank = active.findIndex((b) => b.id === bot.id);
  if (rank < 0 || rank >= limits.bots) return null;
  return { bot, account, limits, settings: sanitizeSettings(bot.settings) };
}

module.exports = { servingContext };
