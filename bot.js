const TelegramBot = require(‘node-telegram-bot-api’);
const http = require(‘http’);

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_ID = process.env.ADMIN_ID;

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end(‘OK’)).listen(PORT);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log(‘Bot started’);

async function db(path, method, body) {
method = method || ‘GET’;
const res = await fetch(SUPABASE_URL + ‘/rest/v1/’ + path, {
method: method,
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
const d = await db(‘users’, ‘POST’, { telegram_id: tid, username: username, balance: 0 });
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
amount: amount,
type: amount > 0 ? ‘credit’ : ‘debit’,
description: amount > 0 ? ‘Added ’ + amount + ’ Stars’ : ‘Used ’ + Math.abs(amount) + ’ Stars’
});
return newBal;
}

async function getPendingWithdrawals() {
return await db(‘withdrawals?status=eq.pending&select=*&order=created_at.asc’);
}

async function handleWithdraw(tid, name) {
const u = await getUser(tid);
if (!u || u.balance <= 0) {
bot.sendMessage(tid, ‘You have no Stars to withdraw. Play and win first!’);
return;
}
const amount = u.balance;
await db(‘withdrawals’, ‘POST’, { telegram_id: tid, username: name, amount: amount, status: ‘pending’ });
await db(‘users?telegram_id=eq.’ + tid, ‘PATCH’, { balance: 0 });
await db(‘transactions’, ‘POST’, { telegram_id: tid, amount: -amount, type: ‘withdrawal_request’, description: ‘Withdrawal: ’ + amount });
bot.sendMessage(tid, ‘Withdrawal request submitted!\n\nAmount: ’ + amount + ’ Stars\n\nPayments are processed every few hours. You will get a notification when sent!’);
if (ADMIN_ID) {
bot.sendMessage(ADMIN_ID, ‘New withdrawal!\n\nUser: @’ + name + ’ (’ + tid + ‘)\nAmount: ’ + amount + ’ Stars\n\nUse /pending to see all.’);
}
}

bot.onText(//start/, async function(msg) {
const tid = msg.from.id;
const name = msg.from.username || msg.from.first_name || ‘Player’;
await upsertUser(tid, name);
const u = await getUser(tid);
bot.sendMessage(tid, ‘Welcome to RPS Stars!\n\nBalance: ’ + (u ? u.balance : 0) + ’ Stars\n\nDeposit Stars to play!’, {
reply_markup: {
inline_keyboard: [
[{ text: ‘🎮 Play Game’, web_app: { url: ‘https://backgammon-app.vercel.app’ } }],
[{ text: ‘⭐ 76 Stars’, callback_data: ‘dep_76’ }, { text: ‘⭐ 152 Stars’, callback_data: ‘dep_152’ }, { text: ‘⭐ 304 Stars’, callback_data: ‘dep_304’ }],
[{ text: ‘💰 My Balance’, callback_data: ‘balance’ }, { text: ‘💸 Withdraw’, callback_data: ‘withdraw’ }]
]
}
});
});

bot.onText(//balance/, async function(msg) {
const u = await getUser(msg.from.id);
bot.sendMessage(msg.from.id, ‘Balance: ’ + (u ? u.balance : 0) + ’ Stars’);
});

bot.onText(//withdraw/, async function(msg) {
await handleWithdraw(msg.from.id, msg.from.username || msg.from.first_name);
});

bot.onText(//pending/, async function(msg) {
if (String(msg.from.id) !== String(ADMIN_ID)) return;
const list = await getPendingWithdrawals();
if (!list || list.length === 0) {
bot.sendMessage(msg.from.id, ‘No pending withdrawals!’);
return;
}
let text = ‘Pending Withdrawals (’ + list.length + ‘):\n\n’;
list.forEach(function(w, i) {
text += (i+1) + ‘. @’ + w.username + ’ - ’ + w.amount + ’ Stars (ID: ’ + w.id + ‘)\n’;
});
text += ‘\nUse /pay_1 to mark ID 1 as paid.’;
bot.sendMessage(msg.from.id, text);
});

bot.onText(//pay_(\d+)/, async function(msg, match) {
if (String(msg.from.id) !== String(ADMIN_ID)) return;
const wid = match[1];
const list = await db(‘withdrawals?id=eq.’ + wid);
const w = list[0];
if (!w) { bot.sendMessage(msg.from.id, ‘Not found.’); return; }
await db(‘withdrawals?id=eq.’ + wid, ‘PATCH’, { status: ‘paid’ });
bot.sendMessage(w.telegram_id, ‘Your withdrawal of ’ + w.amount + ’ Stars has been sent! Thank you for playing RPS Stars!’);
bot.sendMessage(msg.from.id, ‘Paid: @’ + w.username + ’ - ’ + w.amount + ’ Stars’);
});

bot.onText(//stats/, async function(msg) {
if (String(msg.from.id) !== String(ADMIN_ID)) return;
const txns = await db(‘transactions?select=amount,type’);
let totalDeposit = 0;
if (Array.isArray(txns)) {
txns.forEach(function(t) {
if (t.type === ‘credit’ && t.amount > 0) totalDeposit += t.amount;
});
}
bot.sendMessage(msg.from.id, ‘Stats:\n\nTotal deposited: ’ + totalDeposit + ’ Stars’);
});

bot.on(‘callback_query’, async function(q) {
const tid = q.from.id;
if (q.data === ‘balance’) {
const u = await getUser(tid);
bot.answerCallbackQuery(q.id, { text: ‘Balance: ’ + (u ? u.balance : 0) + ’ Stars’, show_alert: true });
return;
}
if (q.data === ‘withdraw’) {
bot.answerCallbackQuery(q.id);
await handleWithdraw(tid, q.from.username || q.from.first_name);
return;
}
if (q.data.startsWith(‘dep_’)) {
const amt = parseInt(q.data.split(’*’)[1]);
bot.sendInvoice(tid, ‘Add ’ + amt + ’ Stars’, ‘Deposit ’ + amt + ’ Stars to play RPS’, ’dep*’ + amt + ‘_’ + Date.now(), ‘’, ‘XTR’, [{ label: amt + ’ Stars’, amount: amt }]);
bot.answerCallbackQuery(q.id);
}
});

bot.on(‘pre_checkout_query’, function(q) {
bot.answerPreCheckoutQuery(q.id, true);
});

bot.on(‘successful_payment’, async function(msg) {
const tid = msg.from.id;
const total = msg.successful_payment.total_amount;
const newBal = await updateBalance(tid, total);
bot.sendMessage(tid, total + ’ Stars added!\nNew balance: ’ + newBal + ’ Stars\n\nGo play!’, {
reply_markup: { inline_keyboard: [[{ text: ‘Play Now’, web_app: { url: ‘https://backgammon-app.vercel.app’ } }]] }
});
});

setInterval(async function() {
if (!ADMIN_ID) return;
const list = await getPendingWithdrawals();
if (list && list.length > 0) {
bot.sendMessage(ADMIN_ID, ‘Reminder: ’ + list.length + ’ withdrawal(s) pending!\nUse /pending to see.’);
}
}, 6 * 60 * 60 * 1000);

bot.on(‘polling_error’, function(e) { console.error(‘Error:’, e.message); });
