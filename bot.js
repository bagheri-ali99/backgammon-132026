const TelegramBot = require(‘node-telegram-bot-api’);
const http = require(‘http’);

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_ID = process.env.ADMIN_ID; // تلگرام ID خودت

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end(‘OK’)).listen(PORT);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log(‘Bot started’);

// ===== SUPABASE =====
async function db(path, method=‘GET’, body=null) {
const res = await fetch(SUPABASE_URL + ‘/rest/v1/’ + path, {
method,
headers: {
‘apikey’: SUPABASE_KEY,
‘Authorization’: ’Bearer ’ + SUPABASE_KEY,
‘Content-Type’: ‘application/json’,
‘Prefer’: method === ‘POST’ ? ‘return=representation’ : ‘’
},
body: body ? JSON.stringify(body) : null
});
return res.json();
}

async function getUser(tid) {
const d = await db(‘users?telegram_id=eq.’ + tid);
return d[0] || null;
}

async function upsertUser(tid, username) {
let u = await getUser(tid);
if (!u) {
const d = await db(‘users’, ‘POST’, { telegram_id: tid, username, balance: 0, pending_withdrawal: 0 });
return d[0];
}
return u;
}

async function updateBalance(tid, amount) {
const u = await getUser(tid);
if (!u) return 0;
const newBal = Math.max(0, (u.balance || 0) + amount);
await db(‘users?telegram_id=eq.’ + tid, ‘PATCH’, { balance: newBal });
await db(‘transactions’, ‘POST’, {
telegram_id: tid,
amount,
type: amount > 0 ? ‘credit’ : ‘debit’,
description: amount > 0 ? ‘Added ’ + amount + ’ Stars’ : ‘Used ’ + Math.abs(amount) + ’ Stars’
});
return newBal;
}

async function getPendingWithdrawals() {
return await db(‘withdrawals?status=eq.pending&select=*&order=created_at.asc’);
}

// ===== /start =====
bot.onText(//start/, async (msg) => {
const tid = msg.from.id;
const name = msg.from.username || msg.from.first_name || ‘Player’;
await upsertUser(tid, name);
const u = await getUser(tid);

bot.sendMessage(tid,
`✊ Welcome to RPS Stars!\n\n⭐ Balance: ${u ? u.balance : 0} Stars\n\nDeposit Stars to play and win!`,
{
reply_markup: {
inline_keyboard: [
[{ text: ‘🎮 Play Game’, web_app: { url: ‘https://backgammon-app.vercel.app’ } }],
[{ text: ‘⭐ Deposit 76 Stars’, callback_data: ‘dep_76’ }],
[{ text: ‘⭐ Deposit 152 Stars’, callback_data: ‘dep_152’ }],
[{ text: ‘⭐ Deposit 304 Stars’, callback_data: ‘dep_304’ }],
[{ text: ‘💰 My Balance’, callback_data: ‘balance’ }],
[{ text: ‘💸 Withdraw’, callback_data: ‘withdraw’ }]
]
}
}
);
});

// ===== /balance =====
bot.onText(//balance/, async (msg) => {
const u = await getUser(msg.from.id);
bot.sendMessage(msg.from.id, `⭐ Your balance: ${u ? u.balance : 0} Stars`);
});

// ===== /withdraw =====
bot.onText(//withdraw/, async (msg) => {
await handleWithdraw(msg.from.id, msg.from.username || msg.from.first_name);
});

async function handleWithdraw(tid, name) {
const u = await getUser(tid);
if (!u || u.balance <= 0) {
bot.sendMessage(tid, ‘❌ You have no Stars to withdraw.\n\nPlay and win first! 🎮’);
return;
}

const amount = u.balance;

// Save withdrawal request
await db(‘withdrawals’, ‘POST’, {
telegram_id: tid,
username: name,
amount,
status: ‘pending’
});

// Deduct balance
await db(‘users?telegram_id=eq.’ + tid, ‘PATCH’, { balance: 0 });
await db(‘transactions’, ‘POST’, {
telegram_id: tid,
amount: -amount,
type: ‘withdrawal_request’,
description: ‘Withdrawal request: ’ + amount + ’ Stars’
});

// Notify user
bot.sendMessage(tid,
`✅ Withdrawal request submitted!\n\n💸 Amount: ${amount} Stars\n\n⏳ Payments are processed every few hours.\nYou will receive a notification when sent! 🎉`
);

// Notify admin
if (ADMIN_ID) {
bot.sendMessage(ADMIN_ID,
`🔔 New withdrawal request!\n\n👤 User: @${name} (${tid})\n💸 Amount: ${amount} Stars\n\nUse /pending to see all requests.`
);
}
}

// ===== /pending (admin only) =====
bot.onText(//pending/, async (msg) => {
if (String(msg.from.id) !== String(ADMIN_ID)) return;

const list = await getPendingWithdrawals();
if (!list || list.length === 0) {
bot.sendMessage(msg.from.id, ‘✅ No pending withdrawals!’);
return;
}

let text = `📋 Pending Withdrawals (${list.length}):\n\n`;
list.forEach((w, i) => {
text += `${i+1}. @${w.username} — ${w.amount}⭐ (ID: ${w.id})\n`;
});
text += ‘\nUse /pay_ID to mark as paid.\nExample: /pay_1’;

bot.sendMessage(msg.from.id, text);
});

// ===== /pay_ID (admin only) =====
bot.onText(//pay_(\d+)/, async (msg, match) => {
if (String(msg.from.id) !== String(ADMIN_ID)) return;

const wid = match[1];
const list = await db(‘withdrawals?id=eq.’ + wid);
const w = list[0];

if (!w) {
bot.sendMessage(msg.from.id, ‘❌ Withdrawal not found.’);
return;
}

// Mark as paid
await db(‘withdrawals?id=eq.’ + wid, ‘PATCH’, { status: ‘paid’ });

// Notify user
bot.sendMessage(w.telegram_id,
`🎉 Your withdrawal has been processed!\n\n⭐ ${w.amount} Stars sent to your account!\n\nThank you for playing RPS Stars! ✊🖐✌️`
);

bot.sendMessage(msg.from.id, `✅ Marked as paid: @${w.username} — ${w.amount}⭐`);
});

// ===== /stats (admin only) =====
bot.onText(//stats/, async (msg) => {
if (String(msg.from.id) !== String(ADMIN_ID)) return;

const users = await db(‘users?select=count’, ‘GET’);
const txns = await db(‘transactions?select=amount,type’);

let totalDeposit = 0, totalWin = 0;
if (Array.isArray(txns)) {
txns.forEach(t => {
if (t.type === ‘credit’ && t.amount > 0) totalDeposit += t.amount;
if (t.type === ‘credit’ && t.description && t.description.includes(‘Won’)) totalWin += t.amount;
});
}

bot.sendMessage(msg.from.id,
`📊 Stats:\n\n💰 Total deposited: ${totalDeposit}⭐\n🏆 Total won: ${totalWin}⭐\n💵 Your earnings: ${totalDeposit - totalWin}⭐`
);
});

// ===== CALLBACK QUERIES =====
bot.on(‘callback_query’, async (q) => {
const tid = q.from.id;

if (q.data === ‘balance’) {
const u = await getUser(tid);
bot.answerCallbackQuery(q.id, {
text: `⭐ Balance: ${u ? u.balance : 0} Stars`,
show_alert: true
});
return;
}

if (q.data === ‘withdraw’) {
bot.answerCallbackQuery(q.id);
await handleWithdraw(tid, q.from.username || q.from.first_name);
return;
}

if (q.data.startsWith(‘dep_’)) {
const amt = parseInt(q.data.split(’*’)[1]);
bot.sendInvoice(
tid,
‘Add ’ + amt + ’ Stars’,
‘Deposit ’ + amt + ’ Stars to your RPS balance and start playing!’,
’dep*’ + amt + ‘_’ + Date.now(),
‘’,
‘XTR’,
[{ label: amt + ’ Game Stars’, amount: amt }]
);
bot.answerCallbackQuery(q.id);
}
});

// ===== PAYMENT =====
bot.on(‘pre_checkout_query’, q => bot.answerPreCheckoutQuery(q.id, true));

bot.on(‘successful_payment’, async (msg) => {
const tid = msg.from.id;
const total = msg.successful_payment.total_amount;

// Add to user balance
const newBal = await updateBalance(tid, total);

bot.sendMessage(tid,
`✅ ${total} Stars added!\n💰 New balance: ${newBal} Stars\n\n🎮 Go play and win!`,
{
reply_markup: {
inline_keyboard: [[
{ text: ‘🎮 Play Now’, web_app: { url: ‘https://backgammon-app.vercel.app’ } }
]]
}
}
);
});

// ===== AUTO NOTIFY pending withdrawals every 6 hours =====
setInterval(async () => {
if (!ADMIN_ID) return;
const list = await getPendingWithdrawals();
if (list && list.length > 0) {
bot.sendMessage(ADMIN_ID,
`⏰ Reminder: ${list.length} pending withdrawal(s) waiting!\nUse /pending to see the list.`
);
}
}, 6 * 60 * 60 * 1000);

bot.on(‘polling_error’, e => console.error(‘Error:’, e.message));
