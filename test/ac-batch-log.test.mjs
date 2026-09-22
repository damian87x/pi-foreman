import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { HANDLE_DEADLINE_MS, QUESTIONS, formatLog, handle, score } from '../src/decide.mjs';

const env = { PI_FOREMAN_LIVE: '1' };
const answers = (event, winner) => QUESTIONS[event].map(({ id }) => ({ id, p: id === winner ? 0.95 : 0.1 }));

test('one request batch excludes evidence and validates response body', async () => {
  assert.equal(HANDLE_DEADLINE_MS, 50);
  let request;
  let completeCalls = 0;
  const complete = await handle({
    event: 'subagent:async-complete', completionClass: 'attention', env,
    post: (...args) => { completeCalls += 1; assert.equal(args.length, 1); request = args[0]; return { answers: answers('subagent:async-complete', 'stay_quiet') }; },
  });
  assert.deepEqual(request, { protocol: 'pi-foreman-offline-1', state: { event: 'subagent:async-complete' }, model: 'fixture', questions: QUESTIONS['subagent:async-complete'] });
  assert.equal(complete.disposition, 'would_stay_quiet');
  assert.equal(complete.httpCalls, 1);
  assert.equal(completeCalls, 1);
  assert.equal(complete.acted, false);
  assert.equal(complete.hookResult, null);

  let calls = 0;
  const badBody = await handle({ event: 'turn_end', env, post: () => { calls += 1; return []; } });
  assert.equal(badBody.disposition, 'STOP');
  assert.equal(badBody.reason, 'bad_body');
  assert.equal(badBody.httpCalls, 1);
  assert.equal(calls, 1);
  let settledRequest;
  const settled = await handle({ event: 'agent_settled', evidence: { fresh: true, id: 'EVIDENCE-SENTINEL' }, env, post: (body) => { settledRequest = body; return { answers: answers('agent_settled', 'note_pass') }; } });
  assert.deepEqual(settledRequest, { protocol: 'pi-foreman-offline-1', state: { event: 'agent_settled' }, model: 'fixture', questions: QUESTIONS.agent_settled });
  assert.equal(JSON.stringify(settledRequest).includes('EVIDENCE-SENTINEL'), false);
  assert.deepEqual(Object.keys(settled), ['event', 'disposition', 'acted', 'hookResult', 'reason', 'httpCalls']);
});

test('deadline and transport errors fail closed', { timeout: 1500 }, async () => {
  const started = Date.now();
  const timeout = await handle({ event: 'turn_end', env, post: () => new Promise(() => {}) });
  assert.equal(timeout.disposition, 'STOP');
  assert.equal(timeout.reason, 'timeout');
  assert.equal(timeout.httpCalls, 1);
  assert.equal(timeout.acted, false);
  assert.equal(timeout.hookResult, null);
  assert.ok(Date.now() - started < 1500);
  const delayed = await handle({ event: 'turn_end', env, post: () => new Promise((resolve) => setTimeout(() => resolve({ answers: answers('turn_end', 'note_healthy') }), 200)) });
  assert.equal(delayed.disposition, 'STOP');
  assert.equal(delayed.reason, 'timeout');
  for (const error of [Object.assign(new Error('Bearer SENTINEL-DO-NOT-LOG'), { name: 'TimeoutError' }), Object.assign(new Error('Bearer SENTINEL-DO-NOT-LOG'), { code: 'TIMEOUT' })]) {
    const timeoutClass = await handle({ event: 'turn_end', env, post: () => Promise.reject(error) });
    assert.equal(timeoutClass.disposition, 'STOP');
    assert.equal(timeoutClass.reason, 'timeout');
  }
  const thrown = await handle({ event: 'turn_end', env, post: () => Promise.reject(new Error('Bearer SENTINEL-DO-NOT-LOG')) });
  assert.equal(thrown.disposition, 'STOP');
  assert.equal(thrown.reason, 'throw');
  assert.equal('error' in thrown, false);
  assert.equal(formatLog(thrown).includes('SENTINEL-DO-NOT-LOG'), false);
});

test('log is exact allowlist and cannot replay choices', async () => {
  const nested = { event: 'tool_call', disposition: 'would_allow', acted: false, hookResult: null, reason: 'choice', httpCalls: 0, state: { nested: 'Bearer SENTINEL-DO-NOT-LOG' }, answers: [{ note: 'Bearer SENTINEL-DO-NOT-LOG' }], error: 'Bearer SENTINEL-DO-NOT-LOG', actor: 'a', task: 't', authority: 'u', evidence: 'e', authorization: 'Bearer SENTINEL-DO-NOT-LOG', bearer: 'b', token: 'k', key: 's' };
  assert.equal(formatLog(nested), '{"event":"tool_call","disposition":"would_allow","acted":false,"hookResult":null,"reason":"choice","httpCalls":0}');
  assert.equal(formatLog({ ...nested, disposition: 'would_allow Bearer SENTINEL-DO-NOT-LOG' }), '{"event":"tool_call","disposition":"STOP","acted":false,"hookResult":null,"reason":"choice","httpCalls":0}');
  assert.equal(formatLog(null), '{"event":"invalid","disposition":"STOP","acted":false,"hookResult":null,"reason":"bad_log","httpCalls":0}');
  const line = formatLog({ event: 'turn_end', disposition: 'would_note_healthy', acted: false, hookResult: null, reason: 'choice', httpCalls: 0 });
  const parsed = score('turn_end', JSON.parse(line));
  assert.equal(parsed.disposition, 'STOP');
  assert.equal(parsed.reason, 'malformed');
  assert.equal(parsed.acted, false);
  const raw = score(line);
  assert.equal(raw.disposition, 'STOP');
  assert.equal(raw.reason, 'unknown_event');
  assert.equal(raw.acted, false);
  const replay = await handle(JSON.parse(line));
  assert.equal(replay.disposition, 'STOP');
  assert.equal(replay.reason, 'shadow_no_answers');
  assert.equal(replay.acted, false);
});

test('offline kernel has no server, filesystem, or package surface', () => {
  const source = readFileSync(new URL('../src/decide.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['createServer', '.listen(', 'readFile', 'fetch(', 'node:http', 'node:fs']) assert.equal(source.includes(forbidden), false);
  assert.equal(existsSync(new URL('../package.json', import.meta.url)), false);
  assert.equal(existsSync(new URL('../extensions/', import.meta.url)), false);
});
