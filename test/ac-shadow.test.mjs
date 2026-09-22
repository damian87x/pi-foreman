import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle, liveEnabled } from '../src/decide.mjs';

const answers = [
  { id: 'note_healthy', p: 0.9 },
  { id: 'note_stuck', p: 0.1 },
];
const shadow = [undefined, null, [], {}, { PI_FOREMAN_LIVE: '' }, { PI_FOREMAN_LIVE: '0' }, { PI_FOREMAN_LIVE: 'true' }, { PI_FOREMAN_LIVE: 'yes' }, { PI_FOREMAN_LIVE: '1 ' }];

test('live switch is exact and shadow never posts', async () => {
  for (const env of shadow) {
    assert.equal(liveEnabled(env), false);
    let calls = 0;
    assert.deepEqual(await handle({ event: 'turn_end', env, live: true, post: () => { calls += 1; } }), {
      event: 'turn_end', disposition: 'STOP', acted: false, hookResult: null,
      reason: 'shadow_no_answers', httpCalls: 0,
    });
    assert.equal(calls, 0);
  }
  assert.equal(liveEnabled({ PI_FOREMAN_LIVE: '1' }), true);

  let calls = 0;
  const result = await handle({
    event: 'turn_end', live: false, env: { PI_FOREMAN_LIVE: '1' },
    post: () => { calls += 1; return { answers }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.disposition, 'would_note_healthy');

  const choice = await handle({ event: 'turn_end', env: { PI_FOREMAN_LIVE: '1' }, answers, post: () => { throw new Error('must not post'); } });
  assert.deepEqual(choice, {
    event: 'turn_end', disposition: 'would_note_healthy', acted: false, hookResult: null,
    reason: 'choice', httpCalls: 0,
  });

  assert.deepEqual(await handle({ event: 'turn_end', env: { PI_FOREMAN_LIVE: '1' } }), {
    event: 'turn_end', disposition: 'STOP', acted: false, hookResult: null,
    reason: 'no_client', httpCalls: 0,
  });
});

test('live post remains a shadow decision without host APIs', async () => {
  let calls = 0;
  const result = await handle({
    event: 'turn_end',
    env: { PI_FOREMAN_LIVE: '1' },
    post: () => {
      calls += 1;
      return { answers };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.disposition, 'would_note_healthy');
  assert.equal(result.acted, false);
  assert.equal(result.hookResult, null);

  const source = readFileSync(new URL('../src/decide.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['sendMessage', 'triggerTurn', 'process.env']) assert.equal(source.includes(forbidden), false);
});
