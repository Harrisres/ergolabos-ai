const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Θυμάται το ενεργό έργο ανά χρήστη
const userState = {};

async function supabaseGet(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function supabasePost(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  return res.ok;
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { message } = req.body;
    if (!message || !message.text) return res.status(200).end();

    const chatId = message.chat.id;
    const text = message.text;

    // Load data
    const [projects, expenses] = await Promise.all([
      supabaseGet('projects'),
      supabaseGet('expenses')
    ]);

    const projectMap = {};
    (projects || []).forEach(p => {
      projectMap[p.id] = { ...p, expenses: [] };
    });
    (expenses || []).forEach(e => {
      if (projectMap[e.project_id]) projectMap[e.project_id].expenses.push(e);
    });

    // Αν ο χρήστης δεν έχει επιλέξει έργο, χρησιμοποίησε το πρώτο
    if (!userState[chatId] && projects?.length > 0) {
      userState[chatId] = projects[0].id;
    }
    const
