import assert from 'node:assert/strict';
import test from 'node:test';
import { handle } from '../src/decide.mjs';
import { jevPost } from '../src/jev-post.mjs';

test('maps id-keyed noul answers back to the kernel', async () => {
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'fixture-not-a-real-key';
  const seen = [];
  const post = jevPost({
    fetchImpl: async (_url, init) => {
      seen.push(JSON.parse(init.body));
      assert.equal(init.headers.Authorization.startsWith('Bearer '), true);
      assert.equal(init.headers.Authorization.includes('\n'), false);
      return { ok: true, json: async () => ({ answers: { note_healthy: { type: 'noul', noul: 0.91 }, note_stuck: { type: 'noul', noul: 0.1 } } }) };
    },
  });
  const out = await handle({ event: 'turn_end', env: { PI_FOREMAN_LIVE: '1' }, post, deadlineMs: 1000 });
  assert.equal(out.disposition, 'would_note_healthy');
  assert.equal(out.reason, 'choice');
  assert.equal(out.httpCalls, 1);
  assert.equal(seen[0].questions.note_healthy.type, 'noul');
  assert.equal(typeof seen[0].state, 'object');
  if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = previous;
});

test('live Jev call', { skip: process.env.PI_FOREMAN_LIVE !== '1' }, async () => {
  const out = await handle({
    event: 'turn_end',
    env: { PI_FOREMAN_LIVE: '1' },
    post: jevPost(),
    deadlineMs: 8000,
  });
  assert.equal(out.httpCalls, 1);
  assert.equal(out.acted, false);
  assert.ok(out.reason === 'choice' || out.reason === 'ask', out.reason);
});
