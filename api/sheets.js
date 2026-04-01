const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function supabase(method, table, body, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query || ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (method === 'GET') return res.json();
  return res.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { type, data } = req.body;

    if (type === 'load_projects') {
      const [projects, expenses, tasks] = await Promise.all([
        supabase('GET', 'projects', null, '?select=*'),
        supabase('GET', 'expenses', null, '?select=*'),
        supabase('GET', 'tasks', null, '?select=*'),
      ]);
      const result = {};
      (projects || []).forEach(p => {
        result[p.id] = { ...p, expenses: [], tasks: [] };
      });
      (expenses || []).forEach(e => {
        if (result[e.project_id]) result[e.project_id].expenses.push(e);
      });
      (tasks || []).forEach(t => {
        if (result[t.project_id]) result[t.project_id].tasks.push(t);
      });
      return res.status(200).json({ projects: result });
    }

    if (type === 'save_project') {
      await supabase('POST', 'projects', {
        id: data.id, name: data.name, client: data.client,
        budget: data.budget, phase: data.phase
      });
      return res.status(200).json({ ok: true });
    }

    if (type === 'save_expense') {
      await supabase('POST', 'expenses', {
        id: data.id, project_id: data.projectId, date: data.date,
        category: data.category, recipient: data.recipient,
        amount: data.amount, note: data.note || ''
      });
      return res.status(200).json({ ok: true });
    }

    if (type === 'save_task') {
      await supabase('POST', 'tasks', {
        id: data.id, project_id: data.projectId, name: data.name,
        assignee: data.assignee || '', deadline: data.deadline || '',
        done: data.done || false
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown type' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
