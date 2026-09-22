import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, veto } from '../src/decide.mjs';

const answers = [
  { id: 'allow', p: 0.99 },
  { id: 'deny', p: 0.01 },
  { id: 'ask', p: 0 },
];
const keys = ['event', 'disposition', 'acted', 'hookResult', 'reason', 'httpCalls'];

test('hard vetoes precede supplied answers and clients', async () => {
  assert.equal(veto('ls'), false);
  for (const haystack of ['plugins/pi-autonoxis', '.pi/agent/secrets', 'typesafe_api_key', 'git push', 'gh pr create', 'gh pr merge', 'deploy', 'Deploy', 'DEPLOY', 'pi-jev']) {
    let calls = 0;
    const result = await handle({ event: 'tool_call', haystack, answers, post: () => { calls += 1; } });
    assert.equal(result.disposition, 'STOP');
    assert.equal(result.reason, 'veto');
    assert.equal(result.httpCalls, 0);
    assert.deepEqual(Object.keys(result), keys);
    assert.equal(calls, 0);
  }
  const settled = await handle({ event: 'agent_settled', haystack: 'pi-jev', answers: [], evidence: undefined });
  assert.deepEqual(settled, {
    event: 'agent_settled', disposition: 'STOP', acted: false, hookResult: null,
    reason: 'veto', httpCalls: 0,
  });
});

test('invalid haystacks stop before any client call', async () => {
  for (const haystack of [undefined, '', null, 1, {}, []]) {
    let calls = 0;
    const result = await handle({ event: 'tool_call', haystack, env: { PI_FOREMAN_LIVE: '1' }, post: () => { calls += 1; } });
    assert.equal(result.disposition, 'STOP');
    assert.equal(result.reason, 'no_haystack');
    assert.equal(result.httpCalls, 0);
    assert.equal(calls, 0);
  }
  let turnEndCalls = 0;
  const turnEnd = await handle({ event: 'turn_end', haystack: [], env: { PI_FOREMAN_LIVE: '1' }, post: () => { turnEndCalls += 1; } });
  assert.deepEqual(turnEnd, {
    event: 'turn_end', disposition: 'STOP', acted: false, hookResult: null,
    reason: 'no_haystack', httpCalls: 0,
  });
  assert.equal(turnEndCalls, 0);
});
