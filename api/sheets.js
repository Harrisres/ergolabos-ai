async function getAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));

  const signingInput = `${header}.${payload}`;
  const privateKey = credentials.private_key;

  const keyData = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');

  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function sheetsRequest(token, method, path, body) {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { type, data } = req.body;
    const token = await getAccessToken();
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;

    if (type === 'load_projects') {
      const [proj, exp, task] = await Promise.all([
        sheetsRequest(token, 'GET', '/values/Projects!A:E'),
        sheetsRequest(token, 'GET', '/values/Expenses!A:G'),
        sheetsRequest(token, 'GET', '/values/Tasks!A:F'),
      ]);
      const projects = {};
      for (const row of (proj.values || [])) {
        if (row[0]) projects[row[0]] = { id: row[0], name: row[1], client: row[2], budget: row[3], phase: row[4], expenses: [], tasks: [] };
      }
      for (const row of (exp.values || [])) {
        if (projects[row[0]]) projects[row[0]].expenses.push({ id: row[1], date: row[2], category: row[3], recipient: row[4], amount: Number(row[5]), note: row[6] });
      }
      for (const row of (task.values || [])) {
        if (projects[row[0]]) projects[row[0]].tasks.push({ id: row[1], name: row[2], assignee: row[3], deadline: row[4], done: row[5] === 'true' });
      }
      return res.status(200).json({ projects });
    }

    if (type === 'save_project') {
      await sheetsRequest(token, 'POST', '/values/Projects!A:E:append?valueInputOption=RAW', {
        values: [[data.id, data.name, data.client, data.budget, data.phase]]
      });
      return res.status(200).json({ ok: true });
    }

    if (type === 'save_expense') {
      await sheetsRequest(token, 'POST', '/values/Expenses!A:G:append?valueInputOption=RAW', {
        values: [[data.projectId, data.id, data.date, data.category, data.recipient, data.amount, data.note || '']]
      });
      return res.status(200).json({ ok: true });
    }

    if (type === 'save_task') {
      await sheetsRequest(token, 'POST', '/values/Tasks!A:F:append?valueInputOption=RAW', {
        values: [[data.projectId, data.id, data.name, data.assignee || '', data.deadline || '', data.done || false]]
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown type' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
