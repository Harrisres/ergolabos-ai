import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

const getAuth = () => new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function ensureSheets(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const titles = meta.data.sheets.map(s => s.properties.title);
  for (const title of ['Projects', 'Expenses', 'Tasks']) {
    if (!titles.includes(title)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] }
      });
    }
  }
}

async function loadProjects(sheets) {
  await ensureSheets(sheets);
  const [projRes, expRes, taskRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Projects!A:E' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Expenses!A:G' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Tasks!A:F' }),
  ]);
  const projects = {};
  for (const row of (projRes.data.values || [])) {
    projects[row[0]] = { id: row[0], name: row[1], client: row[2], budget: row[3], phase: row[4], expenses: [], tasks: [] };
  }
  for (const row of (expRes.data.values || [])) {
    if (projects[row[0]]) projects[row[0]].expenses.push({ id: row[1], date: row[2], category: row[3], recipient: row[4], amount: Number(row[5]), note: row[6] });
  }
  for (const row of (taskRes.data.values || [])) {
    if (projects[row[0]]) projects[row[0]].tasks.push({ id: row[1], name: row[2], assignee: row[3], deadline: row[4], done: row[5] === 'true' });
  }
  return projects;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { type, data, messages, system } = req.body;
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    if (type === 'load_projects') {
      const projects = await loadProjects(sheets);
      return res.status(200).json({ projects });
    }

    if (type === 'save_project') {
      await ensureSheets(sheets);
      const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Projects!A:A' });
      const rows = existing.data.values || [];
      const idx = rows.findIndex(r => r[0] === data.id);
      const row = [data.id, data.name, data.client, data.budget, data.phase];
      if (idx === -1) {
        await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: 'Projects!A:E', valueInputOption: 'RAW', requestBody: { values: [row] } });
      } else {
        await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `Projects!A${idx+1}:E${idx+1}`, valueInputOption: 'RAW', requestBody: { values: [row] } });
      }
      return res.status(200).json({ ok: true });
    }

    if (type === 'save_expense') {
      await ensureSheets(sheets);
      await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: 'Expenses!A:G', valueInputOption: 'RAW', requestBody: { values: [[data.projectId, data.id, data.date, data.category, data.recipient, data.amount, data.note || '']] } });
      return res.status(200).json({ ok: true });
    }

    if (type === 'save_task') {
      await ensureSheets(sheets);
      await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: 'Tasks!A:F', valueInputOption: 'RAW', requestBody: { values: [[data.projectId, data.id, data.name, data.assignee || '', data.deadline || '', data.done || false]] } });
      return res.status(200).json({ ok: true });
    }

    if (type !== 'chat') return res.status(400).json({ error: 'unknown type' });

    // Claude API call
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system, messages })
    });
    });
    const result = await response.json();
    return res.status(200).json(result);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
