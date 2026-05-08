const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('OK')).listen(PORT);
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('Bot started');
bot.onText(/\/start/, async (msg) => {
  bot.sendMessage(msg.from.id, 'Welcome to RPS Stars!', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Play Game', web_app: { url: 'https://backgammon-app.vercel.app' } }],
        [{ text: 'Deposit 76 Stars', callback_data: 'dep_76' }],
        [{ text: 'Deposit 152 Stars', callback_data: 'dep_152' }],
        [{ text: 'Deposit 304 Stars', callback_data: 'dep_304' }]
      ]
    }
  });
});
bot.on('callback_query', async (q) => {
  if (q.data.startsWith('dep_')) {
    const amt = parseInt(q.data.split('_')[1]);
    bot.sendInvoice(q.from.id, 'Add ' + amt + ' Stars', 'Deposit to play RPS', 'dep_' + Date.now(), '', 'XTR', [{ label: amt + ' Stars', amount: amt }]);
  }
  bot.answerCallbackQuery(q.id);
});
bot.on('pre_checkout_query', q => bot.answerPreCheckoutQuery(q.id, true));
bot.on('successful_payment', (msg) => {
  bot.sendMessage(msg.from.id, msg.successful_payment.total_amount + ' Stars added!');
});
bot.on('polling_error', e => console.error(e.message));
