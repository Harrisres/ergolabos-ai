const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function dbCall(type, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${type === 'load_projects' ? 'projects' : type === 'save_expense' ? 'expenses' : 'tasks'}`, {
    method: type === 'load_projects' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' },
    body: type !== 'load_projects' ? JSON.stringify(data) : undefined
  });
  return type === 'load_projects' ? res.json() : res.ok;
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

    // Load projects for context
    const projects = await dbCall('load_projects');
    const projectContext = projects.length > 0
      ? projects.map(p => `- ${p.name} (${p.client})`).join('\n')
      : 'Κανένα έργο ακόμα';

    const system = `Είσαι ο "Εργολάβος AI", βοηθός για έλληνα εργολάβο ανακαίνισης. Μιλάς ΠΑΝΤΑ ελληνικά, σύντομα και πρακτικά. Είσαι σε Telegram οπότε οι απαντήσεις πρέπει να είναι σύντομες.\n\nΈργα: ${projectContext}\n\nΟΤΑΝ ο χρήστης αναφέρει πληρωμή, στο τέλος πρόσθεσε:\nSAVE_EXPENSE:{"projectId":"[id]","category":"[κατηγορία]","recipient":"[παραλήπτης]","amount":[ποσό],"note":"[σημείωση]"}\n\nΑπάντα σύντομα, max 3-4 γραμμές.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, system, messages: [{ role: 'user', content: text }] })
    });

    const claudeData = await claudeRes.json();
    let reply = claudeData?.content?.[0]?.text || 'Δεν μπόρεσα να απαντήσω.';

    // Process SAVE_EXPENSE
    const expMatch = reply.match(/SAVE_EXPENSE:(\{.*?\})/);
    if (expMatch) {
      try {
        const expData = JSON.parse(expMatch[1]);
        await dbCall('save_expense', {
          id: 'e'+Date.now(),
          project_id: expData.projectId || (projects[0]?.id || ''),
          date: new Date().toLocaleDateString('el-GR'),
          category: expData.category || 'Γενικά',
          recipient: expData.recipient || '',
          amount: Number(expData.amount) || 0,
          note: expData.note || ''
        });
      } catch(e) { console.error(e); }
      reply = reply.replace(/SAVE_EXPENSE:\{.*?\}/g, '').trim() + '\n\n✅ Αποθηκεύτηκε!';
    }

    await sendTelegram(chatId, reply);
    return res.status(200).json({ ok: true });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
