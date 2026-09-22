# pi-foreman

Shadow decision kernel. It can call TypeSafe Jev and still does not act.

## Live check

Set `TYPESAFE_API_KEY`, or put it in `~/.pi/agent/secrets/typesafe_api_key`. Then:

```bash
PI_FOREMAN_LIVE=1 node --test --test-timeout=12000 test/live-jev.test.mjs
```

One live call against `jev-1.13.0` passed on 2026-09-22. The kernel maps `answers[id].noul` into its scorer. `acted` stays false. The key is never logged.

Offline tests do not use the network:

```bash
node --test --test-timeout=5000 test/ac-*.test.mjs
```

MIT. Not a port of thruwire/foreman.
