const EVENTS = new Set(['before_agent_start', 'tool_call', 'subagent:async-complete', 'agent_settled', 'turn_end']);
const REASONS = new Set(['choice', 'ask', 'conflict', 'malformed', 'unknown_event', 'veto', 'shadow_no_answers', 'no_client', 'timeout', 'throw', 'bad_body', 'routine', 'unknown_completion', 'stale_evidence', 'no_haystack']);

export const QUESTIONS = {
  'before_agent_start': [
    { id: 'keep_tier', text: 'Keep the current tier?' },
    { id: 'note_tier_change', text: 'Note a tier change?' },
  ],
  tool_call: [
    { id: 'allow', text: 'Allow this tool call?' },
    { id: 'deny', text: 'Deny this tool call?' },
    { id: 'ask', text: 'Ask about this tool call?' },
  ],
  'subagent:async-complete': [
    { id: 'wake', text: 'Wake the parent?' },
    { id: 'stay_quiet', text: 'Stay quiet?' },
  ],
  agent_settled: [
    { id: 'note_pass', text: 'Note pass?' },
    { id: 'note_fail', text: 'Note fail?' },
  ],
  turn_end: [
    { id: 'note_healthy', text: 'Note healthy?' },
    { id: 'note_stuck', text: 'Note stuck?' },
  ],
};

export const HANDLE_DEADLINE_MS = 50;

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const decision = (event, disposition, reason, httpCalls = 0) => ({ event, disposition, acted: false, hookResult: null, reason, httpCalls });
const eventIds = (event) => QUESTIONS[event].map(({ id }) => id);
const wouldDispositions = new Set(Object.values(QUESTIONS).flat().map(({ id }) => `would_${id}`));

function normalize(event, answers) {
  if (!Array.isArray(answers)) return null;
  const ids = eventIds(event);
  const normalized = [];
  for (const answer of answers) {
    if (!plainObject(answer) || typeof answer.id !== 'string' || answer.id.length === 0 || !Number.isFinite(answer.p)) return null;
    normalized.push({ id: answer.id, p: answer.p });
  }
  if (normalized.length !== ids.length || normalized.some(({ id, p }) => !ids.includes(id) || p < 0 || p > 1)) return null;
  if (new Set(normalized.map(({ id }) => id)).size !== ids.length) return null;
  return normalized;
}

export function liveEnabled(env) {
  return plainObject(env) && env.PI_FOREMAN_LIVE === '1';
}

export function veto(haystack) {
  return typeof haystack === 'string' && (
    haystack.includes('plugins/pi-autonoxis') ||
    haystack.includes('.pi/agent/secrets') ||
    haystack.includes('typesafe_api_key') ||
    haystack.includes('git push') ||
    haystack.includes('gh pr create') ||
    haystack.includes('gh pr merge') ||
    haystack.includes('pi-jev') ||
    haystack.toLowerCase().includes('deploy')
  );
}

export function score(event, answers) {
  if (!EVENTS.has(event)) return decision('invalid', 'STOP', 'unknown_event');
  const normalized = normalize(event, answers);
  if (!normalized) return decision(event, 'STOP', 'malformed');
  const winners = normalized.filter(({ p }) => p >= 0.8);
  if (winners.length > 1) return decision(event, 'STOP', 'conflict');
  if (winners.length === 1) return decision(event, `would_${winners[0].id}`, 'choice');
  return decision(event, 'ASK', 'ask');
}

export function formatLog(value) {
  if (!plainObject(value)) return JSON.stringify(decision('invalid', 'STOP', 'bad_log'));
  const event = EVENTS.has(value.event) ? value.event : 'invalid';
  const disposition = value.disposition === 'ASK' || value.disposition === 'STOP' || wouldDispositions.has(value.disposition) ? value.disposition : 'STOP';
  const reason = REASONS.has(value.reason) ? value.reason : 'bad_log';
  const httpCalls = value.httpCalls === 1 ? 1 : 0;
  return JSON.stringify({ event, disposition, acted: false, hookResult: null, reason, httpCalls });
}

export async function handle(input = {}) {
  const dto = plainObject(input) ? input : {};
  const event = dto.event;
  if (!EVENTS.has(event)) return decision('invalid', 'STOP', 'unknown_event');
  const { haystack, completionClass, evidence, answers, env, post } = dto;
  if ((haystack !== undefined && typeof haystack !== 'string') || (event === 'tool_call' && (haystack === undefined || haystack === ''))) return decision(event, 'STOP', 'no_haystack');
  if (veto(haystack)) return decision(event, 'STOP', 'veto');
  if (event === 'subagent:async-complete') {
    if (completionClass === 'routine') return decision(event, 'would_stay_quiet', 'routine');
    if (completionClass !== 'attention') return decision(event, 'STOP', 'unknown_completion');
  }
  if (event === 'agent_settled' && (!plainObject(evidence) || evidence.fresh !== true || typeof evidence.id !== 'string' || evidence.id.length === 0)) return decision(event, 'STOP', 'stale_evidence');
  if (answers !== undefined) return score(event, answers);
  if (!liveEnabled(env)) return decision(event, 'STOP', 'shadow_no_answers');
  if (typeof post !== 'function') return decision(event, 'STOP', 'no_client');
  let response;
  try {
    response = post({ protocol: 'pi-foreman-offline-1', state: { event }, model: 'fixture', questions: QUESTIONS[event] });
  } catch {
    return decision(event, 'STOP', 'throw', 1);
  }
  const deadline = new Error('deadline');
  let body;
  try {
    const waitMs = Number.isFinite(dto.deadlineMs) && dto.deadlineMs > 0 ? dto.deadlineMs : HANDLE_DEADLINE_MS;
    body = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(deadline), waitMs);
      Promise.resolve(response).then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  } catch (error) {
    if (error === deadline || error?.name === 'TimeoutError' || error?.code === 'TIMEOUT') return decision(event, 'STOP', 'timeout', 1);
    return decision(event, 'STOP', 'throw', 1);
  }
  if (!plainObject(body)) return decision(event, 'STOP', 'bad_body', 1);
  return { ...score(event, body.answers), httpCalls: 1 };
}
