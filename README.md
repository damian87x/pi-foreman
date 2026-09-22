# pi-foreman

Offline shadow decision kernel for a Pi supervisor. It scores one batched yes/no fixture and returns a would-be decision. It does not act.

## Not Jev

This has not been tested against TypeSafe Jev. It is not a Jev client.

Jev/Nimble sends id-keyed questions and reads `answers[id].noul`. This module expects `{id, text}` questions and `{id, p}` answers. A real Jev body is rejected as malformed.

No network. No API key. `acted` is always false.

## Test

```bash
node --test --test-timeout=5000 test/ac-*.test.mjs
```

MIT. Not a port of thruwire/foreman.
