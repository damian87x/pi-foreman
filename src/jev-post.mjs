import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL = 'https://api.typesafe.ai/v1/systemone';
const KEY_FILE = join(homedir(), '.pi/agent/secrets/typesafe_api_key');

function key() {
  const env = process.env.TYPESAFE_API_KEY?.trim();
  if (env) return env;
  try {
    const dot = readFileSync('.env', 'utf8');
    for (const line of dot.split('\n')) {
      const [name, ...rest] = line.trim().split('=');
      if (name === 'TYPESAFE_API_KEY' && rest.join('=').trim()) return rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {}
  try { return readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; }
}

export function jevPost({ model = 'jev-1.13.0', timeoutMs = 8000, fetchImpl = fetch } = {}) {
  return async ({ state, questions }) => {
    const bearer = key();
    if (!bearer) throw new Error('no_key');
    const wire = Object.fromEntries(questions.map(({ id, text }) => [id, { type: 'noul', instructions: text }]));
    const res = await fetchImpl(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ state, questions: wire, model }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const body = await res.json();
    return { answers: questions.map(({ id }) => ({ id, p: body?.answers?.[id]?.noul })) };
  };
}
