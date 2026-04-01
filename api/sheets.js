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

async function deleteByProjectId(table, id) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?project_id=eq.${id}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { type, data } = req.body;

    if (type === 'load_projects') {
      const [projects, expenses, tasks, receipts] = await Promise.all([
        supabase('GET', 'projects', null, '?select=*'),
        supabase('GET', 'expenses', null, '?select=*'),
        supabase('GET', 'tasks', null, '?select=*'),
        supabase('GET', 'receipts', null, '?select=*'),
      ]);
      const result = {};
      (projects || []).forEach(p => {
        result[p.id] = { ...p, expenses: [], tasks: [], receipts: [] };
      });
      (expenses || []).forEach(e => {
        if (result[e.project_id]) result[e.project_id].expenses.push(e);
      });
      (tasks || []).forEach(t => {
        if (result[t.project_id]) result[t.project_id].tasks.push(t);
      });
      (receipts || []).forEach(r => {
        if (result[r.project_id]) result[r.project_id].receipts.push(r);
      });
      return res.status(200).json({ projects: result });
    }

    if (type === 'save_project') {
      await supabase('POST', 'projects', {
        id: data.id, name: data.name, client: data.client,
        budget: data.budget, phase: data.phase, start_date: data.start_date || ''
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

    if (type === 'save_receipt') {
      await supabase('POST', 'receipts', {
        id: data.id, project_id: data.projectId, date: data.date,
        amount: data.amount, note: data.note || ''
      });
      return res.status(200).json({ ok: true });
    }

    if (type === 'save_payment_schedule') {
      for (const payment of data.payments) {
        await supabase('POST', 'payment_schedule', {
          id: payment.id,
          project_id: payment.projectId,
          description: payment.description,
          percentage: payment.percentage,
          amount: payment.amount,
          due_date: payment.dueDate,
          paid: false,
          paid_date: ''
        });
      }
      return res.status(200).json({ ok: true });
    }

    if (type === 'update_payment') {
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/payment_schedule?id=eq.${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ paid: data.paid, paid_date: data.paidDate || '' })
      });
      return res.status(200).json({ ok: updateRes.ok });
    }

    if (type === 'load_payment_schedule') {
      const payments = await supabase('GET', 'payment_schedule', null, `?project_id=eq.${data.projectId}&select=*`);
      return res.status(200).json({ payments: payments || [] });
    }

    if (type === 'delete') {
      const { table, id } = data;
      const tableMap = { project: 'projects', expense: 'expenses', task: 'tasks', receipt: 'receipts' };
      const supaTable = tableMap[table];
      if (!supaTable) return res.status(400).json({ error: 'invalid table' });

      if (table === 'project') {
        await Promise.all([
          deleteByProjectId('expenses', id),
          deleteByProjectId('tasks', id),
          deleteByProjectId('receipts', id),
          deleteByProjectId('payment_schedule', id),
        ]);
      }

      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/${supaTable}?id=eq.${id}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      return res.status(200).json({ ok: delRes.ok });
    }

    return res.status(400).json({ error: 'unknown type' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
