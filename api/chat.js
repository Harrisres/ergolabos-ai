import { GoogleAuth } = from 'google-auth-library';
import { google } from 'googleapis';

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function ensureSheets() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const titles = meta.data.sheets.map(s => s.properties.title);
  const needed = ['Projects', 'Expenses', 'Tasks'];
  for (const title of needed) {
    if (!titles.includes(title)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] }
      });
    }
  }
}

async function saveProject(project) {
  await ensureSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Projects!A:A'
  });
  const rows = res.data.values || [];
  const existingRow = rows.findIndex(r => r[0] === project.id);
  const row = [project.id, project.name, project.client, project.budget, project.phase];
  if (existingRow === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Projects!A:E',
      valueInputOption: 'RAW',
      requestBody: { values: [row] }
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Projects!A${existingRow + 1}:E${existingRow + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] }
    });
  }
}

async function loadProjects() {
  await ensureSheets();
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

    if (type === 'save_project') {
      await saveProject(data);
      return res.status(200).json({ ok: true });
    }

    if (type === 'load_projects') {
      const projects = await loadProjects();
      return res.status(200).json({ projects });
    }

    if (type === 'save_expense') {
      await ensureSheets();
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Expenses!A:G',
        valueInputOption: 'RAW',
        requestBody: { values: [[data.projectId, data.id, data.date, data.category, data.recipient, data.amount, data.note || '']] }
      });
      return res.status(200).json({ ok: true });
    }

    if (type === 'save_task') {
      await ensureSheets();
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Tasks!A:F',
        valueInputOption: 'RAW',
        requestBody: { values: [[data.projectId, data.id, data.name, data.assignee || '', data.deadline || '', data.done || false]] }
      });
      return res.status(200).json({ ok: true });
    }

    // Claude API call
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system, messages })
    });
    const result = await response.json();
    return res.status(200).json(result);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
