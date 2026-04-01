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
    const activeProjectId = userState[chatId] || projects?.[0]?.id || '';
    const activeProject = projectMap[activeProjectId];

    // Φτιάξε λίστα έργων για να μπορεί ο χρήστης να επιλέξει
    const projectList = (projects || []).map((p, i) => `${i+1}. ${p.name} (${p.client})`).join('\n');

    // Context για Claude
    const activeInfo = activeProject ? (() => {
      const tot = activeProject.expenses.reduce((a,e) => a + Number(e.amount), 0);
      const bud = Number(activeProject.budget) || 0;
      return `Ενεργό έργο: ${activeProject.name} (${activeProject.client})\nΠ/Υ: €${bud.toLocaleString('el-GR')} | Έξοδα: €${tot.toLocaleString('el-GR')} | Υπόλοιπο: €${(bud-tot).toLocaleString('el-GR')}`;
    })() : 'Κανένα ενεργό έργο';

    const system = `Είσαι ο "Εργολάβος AI", βοηθός για έλληνα εργολάβο ανακαίνισης. Μιλάς ΠΑΝΤΑ ελληνικά, σύντομα και πρακτικά.

${activeInfo}

Όλα τα έργα:
${projectList}

Αν ο χρήστης θέλει να αλλάξει ενεργό έργο, πρόσθεσε: SWITCH_PROJECT:[αριθμός]

ΟΤΑΝ ο χρήστης αναφέρει πληρωμή ή έξοδο, ΠΑΝΤΑ πρόσθεσε:
SAVE_EXPENSE:{"category":"[κατηγορία]","recipient":"[παραλήπτης]","amount":[ποσό],"note":"[σημείωση]"}

ΟΤΑΝ ο χρήστης αναφέρει νέο έργο, ΠΑΝΤΑ πρόσθεσε:
SAVE_PROJECT:{"name":"[όνομα]","client":"[πελάτης]","budget":[ποσό]}

Απάντα σύντομα, max 4-5 γραμμές.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, system, messages: [{ role: 'user', content: text }] })
    });

    const claudeData = await claudeRes.json();
    let reply = claudeData?.content?.[0]?.text || 'Δεν μπόρεσα να απαντήσω.';

    // SWITCH PROJECT
    const switchMatch = reply.match(/SWITCH_PROJECT:(\d+)/);
    if (switchMatch) {
      const idx = parseInt(switchMatch[1]) - 1;
      if (projects[idx]) {
        userState[chatId] = projects[idx].id;
        reply = reply.replace(/SWITCH_PROJECT:\d+/g, '').trim() + `\n\n✅ Ενεργό έργο: ${projects[idx].name}`;
      }
    }

    // SAVE EXPENSE
    const expMatch = reply.match(/SAVE_EXPENSE:(\{[^}]+\})/);
    if (expMatch) {
      try {
        const expData = JSON.parse(expMatch[1]);
        await supabasePost('expenses', {
          id: 'e'+Date.now(),
          project_id: activeProjectId,
          date: new Date().toLocaleDateString('el-GR'),
          category: expData.category || 'Γενικά',
          recipient: expData.recipient || '',
          amount: Number(expData.amount) || 0,
          note: expData.note || ''
        });
        reply = reply.replace(/SAVE_EXPENSE:\{[^}]+\}/g, '').trim() + '\n\n✅ Αποθηκεύτηκε!';
      } catch(e) { console.error(e); }
    }

    // SAVE PROJECT
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
          phase: 'Προετοιμασία'
        });
        userState[chatId] = newId;
        reply = reply.replace(/SAVE_PROJECT:\{[^}]+\}/g, '').trim() + '\n\n✅ Έργο αποθηκεύτηκε!';
      } catch(e) { console.error(e); }
    }

    await sendTelegram(chatId, reply);
    return res.status(200).json({ ok: true });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
