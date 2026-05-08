const TelegramBot = require(‘node-telegram-bot-api’);

const BOT_TOKEN = ‘8598069647:AAG-7dNC_Y7e3SPV_wE1_m4QE4xGSp_fLWo’;
const SUPABASE_URL = ‘https://bmfxcrgaavbeidakeqiw.supabase.co’;
const SUPABASE_KEY = ‘eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtZnhjcmdhYXZiZWlkYWtlcWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMDQ2MzQsImV4cCI6MjA5MzY4MDYzNH0.Sucl9zCtlu433X0nEjOkJ3fSD_drRtWJIGyrNJZkOfA’;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

async function supaFetch(path, method=‘GET’, body=null) {
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
const data = await supaFetch(‘users?telegram_id=eq.’ + tid + ‘&select=*’);
return data[0] || null;
}

async function upsertUser(tid, username) {
let user = await getUser(tid);
if (!user) {
const data = await supaFetch(‘users’, ‘POST’, { telegram_id: tid, username, balance: 0 });
return data[0];
}
return user;
}

async function addBalance(tid, amount, type, desc) {
const user = await getUser(tid);
if (!user) return 0;
const newBal = (user.balance || 0) + amount;
await supaFetch(‘users?telegram_id=eq.’ + tid, ‘PATCH’, { balance: newBal });
await supaFetch(‘transactions’, ‘POST’, { telegram_id: tid, amount, type, description: desc });
return newBal;
}

bot.onText(//start/, async (msg) => {
const tid = msg.from.id;
const username = msg.from.username || msg.from.first_name;
await upsertUser(tid, username);
const user = await getUser(tid);

bot.sendMessage(tid,
`✊ Welcome to RPS Stars!\n\n⭐ Your balance: ${user ? user.balance : 0} Stars\n\nDeposit Stars to play:`,
{
reply_markup: {
inline_keyboard: [
[{ text: ‘🎮 Play Game’, web_app: { url: ‘https://backgammon-app.vercel.app’ } }],
[{ text: ‘⭐ Deposit 76 Stars’, callback_data: ‘deposit_76’ }],
[{ text: ‘⭐ Deposit 152 Stars’, callback_data: ‘deposit_152’ }],
[{ text: ‘⭐ Deposit 304 Stars’, callback_data: ‘deposit_304’ }],
[{ text: ‘💰 My Balance’, callback_data: ‘balance’ }]
]
}
}
);
});

bot.on(‘callback_query’, async (query) => {
const tid = query.from.id;
const data = query.data;

if (data === ‘balance’) {
const user = await getUser(tid);
bot.answerCallbackQuery(query.id, { text: `⭐ Balance: ${user ? user.balance : 0} Stars`, show_alert: true });
return;
}

if (data.startsWith(‘deposit_’)) {
const amount = parseInt(data.split(’_’)[1]);
bot.sendInvoice(
tid,
`Add ${amount} Stars to Balance`,
`Your ${amount} Stars will be added to your RPS game balance instantly.`,
`deposit_${amount}_${tid}_${Date.now()}`,
‘’,
‘XTR’,
[{ label: `${amount} Game Stars`, amount: amount }]
);
bot.answerCallbackQuery(query.id);
}
});

bot.on(‘pre_checkout_query’, (query) => {
bot.answerPreCheckoutQuery(query.id, true);
});

bot.on(‘successful_payment’, async (msg) => {
const tid = msg.from.id;
const amount = msg.successful_payment.total_amount;
const newBal = await addBalance(tid, amount, ‘deposit’, `Deposited ${amount} Stars`);

bot.sendMessage(tid,
`✅ ${amount} Stars added!\n\n💰 New balance: ${newBal} Stars\n\nGo play! 🎮`,
{
reply_markup: {
inline_keyboard: [[
{ text: ‘🎮 Play Now’, web_app: { url: ‘https://backgammon-app.vercel.app’ } }
]]
}
}
);
});

console.log(‘Bot running…’);
