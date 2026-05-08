const TelegramBot = require(‘node-telegram-bot-api’);
const http = require(‘http’);

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end(‘OK’)).listen(PORT);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log(‘Bot started’);

async function getUser(tid) {
const r = await fetch(SUPABASE_URL + ‘/rest/v1/users?telegram_id=eq.’ + tid, {
headers: { apikey: SUPABASE_KEY, Authorization: ’Bearer ’ + SUPABASE_KEY }
});
const d = await r.json();
return d[0] || null;
}

async function upsertUser(tid, name) {
let u = await getUser(tid);
if (!u) {
await fetch(SUPABASE_URL + ‘/rest/v1/users’, {
method: ‘POST’,
headers: { apikey: SUPABASE_KEY, Authorization: ’Bearer ’ + SUPABASE_KEY, ‘Content-Type’: ‘application/json’, Prefer: ‘return=representation’ },
body: JSON.stringify({ telegram_id: tid, username: name, balance: 0 })
});
u = await getUser(tid);
}
return u;
}

async function addBalance(tid, amount, desc) {
const u = await getUser(tid);
if (!u) return 0;
const bal = (u.balance || 0) + amount;
await fetch(SUPABASE_URL + ‘/rest/v1/users?telegram_id=eq.’ + tid, {
method: ‘PATCH’,
headers: { apikey: SUPABASE_KEY, Authorization: ’Bearer ’ + SUPABASE_KEY, ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({ balance: bal })
});
await fetch(SUPABASE_URL + ‘/rest/v1/transactions’, {
method: ‘POST’,
headers: { apikey: SUPABASE_KEY, Authorization: ’Bearer ’ + SUPABASE_KEY, ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({ telegram_id: tid, amount: amount, type: amount > 0 ? ‘deposit’ : ‘loss’, description: desc })
});
return bal;
}

bot.onText(/\/start/, async (msg) => {
const tid = msg.from.id;
const name = msg.from.username || msg.from.first_name || ‘Player’;
await upsertUser(tid, name);
const u = await getUser(tid);
bot.sendMessage(tid, ‘Welcome to RPS Stars!\n\nBalance: ’ + (u ? u.balance : 0) + ’ Stars’, {
reply_markup: {
inline_keyboard: [
[{ text: ‘Play Game’, web_app: { url: ‘https://backgammon-app.vercel.app’ } }],
[{ text: ‘Deposit 76 Stars’, callback_data: ‘dep_76’ }],
[{ text: ‘Deposit 152 Stars’, callback_data: ‘dep_152’ }],
[{ text: ‘Deposit 304 Stars’, callback_data: ‘dep_304’ }],
[{ text: ‘My Balance’, callback_data: ‘bal’ }]
]
}
});
});

bot.on(‘callback_query’, async (q) => {
const tid = q.from.id;
if (q.data === ‘bal’) {
const u = await getUser(tid);
bot.answerCallbackQuery(q.id, { text: ‘Balance: ’ + (u ? u.balance : 0) + ’ Stars’, show_alert: true });
return;
}
if (q.data.startsWith(‘dep_’)) {
const amt = parseInt(q.data.split('_')[1]);
bot.sendInvoice(tid, ‘Add ’ + amt + ’ Stars’, ‘Deposit ’ + amt + ’ Stars to play RPS’, ’dep*’ + amt + ‘_’ + Date.now(), ‘’, ‘XTR’, [{ label: amt + ’ Stars’, amount: amt }]);
}
bot.answerCallbackQuery(q.id);
});

bot.on(‘pre_checkout_query’, q => bot.answerPreCheckoutQuery(q.id, true));

bot.on(‘successful_payment’, async (msg) => {
const tid = msg.from.id;
const amt = msg.successful_payment.total_amount;
const bal = await addBalance(tid, amt, ‘Deposit ’ + amt);
bot.sendMessage(tid, amt + ’ Stars added!\nBalance: ’ + bal + ’ Stars’, {
reply_markup: { inline_keyboard: [[{ text: ‘Play Now’, web_app: { url: ‘https://backgammon-app.vercel.app’ } }]] }
});
});

bot.on(‘polling_error’, e => console.error(‘Error:’, e.message));
