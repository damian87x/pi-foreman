import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, handle, score, formatLog } from '../src/decide.mjs';

const all = (event, winner, probability = 0.9) => QUESTIONS[event].map(({ id }) => ({ id, p: id === winner ? probability : 0.1 }));
const keys = ['event', 'disposition', 'acted', 'hookResult', 'reason', 'httpCalls'];

test('question table and threshold scoring are closed', async () => {
  assert.deepEqual(QUESTIONS, {
    'before_agent_start': [{ id: 'keep_tier', text: 'Keep the current tier?' }, { id: 'note_tier_change', text: 'Note a tier change?' }],
    tool_call: [{ id: 'allow', text: 'Allow this tool call?' }, { id: 'deny', text: 'Deny this tool call?' }, { id: 'ask', text: 'Ask about this tool call?' }],
    'subagent:async-complete': [{ id: 'wake', text: 'Wake the parent?' }, { id: 'stay_quiet', text: 'Stay quiet?' }],
    agent_settled: [{ id: 'note_pass', text: 'Note pass?' }, { id: 'note_fail', text: 'Note fail?' }],
    turn_end: [{ id: 'note_healthy', text: 'Note healthy?' }, { id: 'note_stuck', text: 'Note stuck?' }],
  });
  const choice = score('tool_call', all('tool_call', 'allow', 0.8));
  assert.equal(choice.disposition, 'would_allow');
  assert.equal(choice.reason, 'choice');
  assert.deepEqual(Object.keys(choice), keys);
  assert.equal(score('tool_call', all('tool_call', 'allow', 0.79)).disposition, 'ASK');
  const conflict = score('tool_call', [{ id: 'allow', p: 0.8 }, { id: 'deny', p: 0.8 }, { id: 'ask', p: 0.1 }]);
  assert.equal(conflict.disposition, 'STOP');
  assert.equal(conflict.reason, 'conflict');
  for (const answers of [
    [{ id: 'allow', p: NaN }, { id: 'deny', p: 0.1 }, { id: 'ask', p: 0.1 }],
    [{ id: 'allow', p: '0.9' }, { id: 'deny', p: 0.1 }, { id: 'ask', p: 0.1 }],
    [{ id: 'allow', p: 'yes' }, { id: 'deny', p: 0.1 }, { id: 'ask', p: 0.1 }],
    [{ id: 'allow', p: 1.1 }, { id: 'deny', p: 0.1 }, { id: 'ask', p: 0.1 }],
    [{ p: 0.9 }, { id: 'deny', p: 0.1 }, { id: 'ask', p: 0.1 }],
    [{ id: 'yes', p: 0.9 }, { id: 'deny', p: 0.1 }, { id: 'ask', p: 0.1 }],
    [{ id: 'DISPATCH', p: 0.9 }, { id: 'deny', p: 0.1 }, { id: 'ask', p: 0.1 }],
    [{ id: 'ACCEPT', p: 0.9 }, { id: 'deny', p: 0.1 }, { id: 'ask', p: 0.1 }],
    [{ id: 'allow', p: 0.9 }, { id: 'allow', p: 0.1 }, { id: 'deny', p: 0.1 }, { id: 'ask', p: 0.1 }],
    { allow: { type: 'noul', noul: 0.91 } },
  ]) {
    const malformed = score('tool_call', answers);
    assert.equal(malformed.disposition, 'STOP');
    assert.equal(malformed.reason, 'malformed');
  }
  for (const id of ['DISPATCH', 'ACCEPT']) assert.equal(formatLog(score('tool_call', [{ id, p: 0.9 }, { id: 'deny', p: 0.1 }, { id: 'ask', p: 0.1 }])).includes(id), false);
  for (const event of Object.keys(QUESTIONS)) assert.equal(score(event, all(event, QUESTIONS[event][0].id)).disposition, `would_${QUESTIONS[event][0].id}`);
  for (const event of ['model_select', 'agent_end', '', null]) {
    const expected = { event: 'invalid', disposition: 'STOP', acted: false, hookResult: null, reason: 'unknown_event', httpCalls: 0 };
    assert.deepEqual(score(event, all('tool_call', 'allow')), expected);
    let calls = 0;
    assert.deepEqual(await handle({ event, env: { PI_FOREMAN_LIVE: '1' }, post: () => { calls += 1; } }), expected);
    assert.equal(calls, 0);
  }
});

test('completion and evidence are fail closed before answers', async () => {
  let calls = 0;
  const post = () => { calls += 1; };
  const env = { PI_FOREMAN_LIVE: '1' };
  const routine = await handle({ event: 'subagent:async-complete', completionClass: 'routine', answers: all('subagent:async-complete', 'wake'), env, post });
  assert.equal(routine.disposition, 'would_stay_quiet');
  assert.equal(routine.reason, 'routine');
  for (const completionClass of [undefined, 'unknown', 'attention ']) {
    const unknownCompletion = await handle({ event: 'subagent:async-complete', completionClass, answers: all('subagent:async-complete', 'wake'), env, post });
    assert.equal(unknownCompletion.disposition, 'STOP');
    assert.equal(unknownCompletion.reason, 'unknown_completion');
  }
  for (const evidence of [undefined, {}, { fresh: false, id: 'x' }, { fresh: 'true', id: 'x' }, { fresh: true, id: '' }, { fresh: true }]) {
    const staleEvidence = await handle({ event: 'agent_settled', evidence, answers: all('agent_settled', 'note_pass', 0.99), env, post });
    assert.equal(staleEvidence.disposition, 'STOP');
    assert.equal(staleEvidence.reason, 'stale_evidence');
  }
  assert.equal(calls, 0);
});
