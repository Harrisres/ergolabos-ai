const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function supabaseGet(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' })
  });
}

function parseGreekDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length === 3) return new Date(parts[2], parts[1]-1, parts[0]);
  return null;
}

function daysDiff(date) {
  const today = new Date();
  today.setHours(0,0,0,0);
  date.setHours(0,0,0,0);
  return Math.round((date - today) / (1000*60*60*24));
}

export default async function handler(req, res) {
  try {
    const [projects, schedules, tasks] = await Promise.all([
      supabaseGet('projects'),
      supabaseGet('payment_schedule'),
      supabaseGet('tasks'),
    ]);

    const projectMap = {};
    (projects || []).forEach(p => projectMap[p.id] = p);

    let message = `🔔 *Καλημέρα!*\n\n`;
    let hasContent = false;

    // Δόσεις που λήγουν σε 7 μέρες
    const upcomingPayments = (schedules || []).filter(s => {
      if (s.paid) return false;
      const due = parseGreekDate(s.due_date);
      if (!due) return false;
      const days = daysDiff(due);
      return days >= 0 && days <= 7;
    });

    const overduePayments = (schedules || []).filter(s => {
      if (s.paid) return false;
      const due = parseGreekDate(s.due_date);
      if (!due) return false;
      return daysDiff(due) < 0;
    });

    if (overduePayments.length > 0) {
      hasContent = true;
      message += `⚠️ *Εκπρόθεσμες Δόσεις:*\n`;
      overduePayments.forEach(p => {
        const proj = projectMap[p.project_id];
        message += `• ${proj?.name || '?'} - ${p.description} €${Number(p.amount).toLocaleString('el-GR')}\n`;
      });
      message += `\n`;
    }

    if (upcomingPayments.length > 0) {
      hasContent = true;
      message += `📅 *Επερχόμενες Δόσεις (7 ημέρες):*\n`;
      upcomingPayments.forEach(p => {
        const proj = projectMap[p.project_id];
        const due = parseGreekDate(p.due_date);
        const days = daysDiff(due);
        const when = days === 0 ? 'Σήμερα' : days === 1 ? 'Αύριο' : `Σε ${days} μέρες`;
        message += `• ${proj?.name || '?'} - ${p.description}: €${Number(p.amount).toLocaleString('el-GR')} (${when})\n`;
      });
      message += `\n`;
    }

    // Εργασίες που λήγουν σε 7 μέρες
    const upcomingTasks = (tasks || []).filter(t => {
      if (t.done) return false;
      const due = parseGreekDate(t.deadline);
      if (!due) return false;
      const days = daysDiff(due);
      return days >= 0 && days <= 7;
    });

    if (upcomingTasks.length > 0) {
      hasContent = true;
      message += `⏰ *Εργασίες που λήγουν σύντομα:*\n`;
      upcomingTasks.forEach(t => {
        const proj = projectMap[t.project_id];
        message += `• ${t.name} (${proj?.name || '?'}) - ${t.deadline}\n`;
      });
    }

    if (!hasContent) {
      message += `✅ Όλα υπό έλεγχο! Καμία εκκρεμότητα σήμερα.`;
    }

    await sendTelegram(message);
    return res.status(200).json({ ok: true });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
