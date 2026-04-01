const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

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

    // Load data from Supabase
    const [projects, expenses, tasks] = await Promise.all([
      supabaseGet('projects'),
      supabaseGet('expenses'),
      supabaseGet('tasks')
    ]);

    // Build project context
    const projectMap = {};
    (projects || []).forEach(p => {
      projectMap[p.id] = { ...p, expenses: [], tasks: [] };
    });
    (expenses || []).forEach(e => {
      if (projectMap[e.project_id]) projectMap[e.project_id].expenses.push(e);
    });
    (tasks || []).forEach(t => {
      if (projectMap[t.project_id]) projectMap[t.project_id].tasks.push(t);
    });

    const projectContext = Object.values(projectMap).map(p => {
      const tot = p.expenses.reduce((a,e) => a + Number(e.amount), 0);
      const bud = Number(p.budget) || 0;
      return `• ${p.name} (${p.client}) | Π/Υ: €${bud.toLocaleString('el-GR')} | Έξοδα: €${tot.toLocaleString('el-GR')} | Υπόλοιπο: €${(bud-tot).toLocaleString('el-GR')}`;
    }).join('\n') || 'Κανένα έργο ακόμα';

    const firstProjectId = projects?.[0]?.id || '';

    const system = `Είσαι ο "Εργολάβος AI", βοηθός για έλληνα εργολάβο ανακαίνισης. Μιλάς ΠΑΝΤΑ ελληνικά, σύντομα και πρακτικά. Είσαι σε Telegram.\n\nΈργα:\n${projectContext}\n\nΟΤΑΝ ο χρήστης αναφέρει πληρωμή ή έξοδο, ΠΑΝΤΑ στο τέλος πρόσθεσε:\nSAVE_EXPENSE:{"project_id":"${firstProjectId}","category":"[κατηγορία]","recipient":"[παραλήπτης]","amount":[ποσό],"note":"[σημείωση]"}\n\nΟΤΑΝ ο χρήστης αναφέρει νέο έργο, ΠΑΝΤΑ στο τέλος πρόσθεσε:\nSAVE_PROJECT:{"name":"[όνομα]","client":"[πελάτης]","budget":[προϋπολογισμός],"phase":"Προετοιμασία"}\n\nΑπάντα σύντομα, max 4-5 γραμμές.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, system, messages: [{ role: 'user', content: text }] })
    });

    const claudeData = await claudeRes.json();
    let reply = claudeData?.content?.[0]?.text || 'Δεν μπόρεσα να απαντήσω.';

    // Process SAVE_EXPENSE
    const expMatch = reply.match(/SAVE_EXPENSE:(\{[^}]+\})/);
    if (expMatch) {
      try {
        const expData = JSON.parse(expMatch[1]);
        await supabasePost('expenses', {
          id: 'e'+Date.now(),
          project_id: expData.project_id || firstProjectId,
          date: new Date().toLocaleDateString('el-GR'),
          category: expData.category || 'Γενικά',
          recipient: expData.recipient || '',
          amount: Number(expData.amount) || 0,
          note: expData.note || ''
        });
        reply = reply.replace(/SAVE_EXPENSE:\{[^}]+\}/g, '').trim() + '\n\n✅ Αποθηκεύτηκε στη βάση!';
      } catch(e) { console.error('Expense error:', e); }
    }

    // Process SAVE_PROJECT
    const projMatch = reply.match(/SAVE_PROJECT:(\{[^}]+\})/);
    if (projMatch) {
      try {
        const projData = JSON.parse(projMatch[1]);
        const newId = 'p'+Date.now();
        await supabasePost('projects', {
          id: newId,
          name: projData.name || '',
          client: projData.client || '',
          budget: Number(projData.budget) || 0,
          phase: projData.phase || 'Προετοιμασία'
        });
        reply = reply.replace(/SAVE_PROJECT:\{[^}]+\}/g, '').trim() + '\n\n✅ Έργο αποθηκεύτηκε!';
      } catch(e) { console.error('Project error:', e); }
    }

    await sendTelegram(chatId, reply);
    return res.status(200).json({ ok: true });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
