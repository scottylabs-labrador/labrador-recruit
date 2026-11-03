# Worker

Drains the notification outbox and owns everything that runs on a schedule.

Owned by **workstream L**; see [`docs/workstreams.md`](../../docs/workstreams.md).
`src/index.ts` is currently a shell that runs, logs, and shuts down cleanly, so
the deployment wiring can be proved before the delivery logic lands.

## Why it is a separate process

A failing email provider must not be able to fail an application submission. A
service writes `notification_outbox` rows inside the same transaction as the
event that caused them; this process delivers them out of band.

It also owns scheduled work. **Do not add a `setInterval` to `apps/server`** —
the previous version did, and those timers silently assume a single replica.

## Running it

```bash
bun run dev:local     # reads ../../.env.local
bun run dev           # resolves secrets through secretspec
```

## Contract

See [`docs/architecture.md`](../../docs/architecture.md) section 6 and
[`docs/data-model.md`](../../docs/data-model.md) section 7. The requirements most
easily lost in a refactor:

- Claim rows atomically, so two replicas never double-send.
- Respect `available_at` for backoff.
- Record every attempt and its error; mark undeliverable rows `dead`.
- Never log `payload_json`.
