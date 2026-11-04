# Pull request

Closes #

## What changed, and why

Lead with the why. What a reviewer needs in order to understand the diff.

## Track

`track-a` / `track-b` / `shared`. If this touches a file the other track owns,
say which file, why, and tag them.

## Declare these explicitly

Delete the lines that do not apply. Leaving a line in means you are asserting it.

- [ ] **This changes who can see what.** Say so in those words, and name the
      resource and the rule. These pull requests get a different level of review
      and the reviewer needs to know to give it.
- [ ] **This contains a migration.** List the tables it touches. One migration
      per pull request, and you claimed the slot on #8 first.
- [ ] **This touches a seam between the tracks.** Which one, and the other track
      has agreed on #12.
- [ ] **I made a judgement call the design left open.** Name it in a sentence.
      `docs/design.md` section 13 lists what is deliberately yours.
- [ ] **This needs an ADR, and it is written.** Schema, authorization, API shape,
      or a product rule. Link it.
- [ ] **Something here is incomplete.** Say what and why. Known debt that is
      written down is manageable; known debt that is not is a trap for the next
      person.

## Verification

Paste the real output of `bun run build:api` and then `bun run check` below. Do
not assert a result you did not see — a green claim that was never verified costs
more than a red one that was. If you skipped a step or something failed, say
which.

```text

```

## Tests

- [ ] Denial paths covered, if this touches authorization: the reviewer without
      an assignment, the director of another committee, the revoked grant, the
      expired grant. A rule without a test proving the refusal is not finished.
- [ ] New tables added to the `TRUNCATE` list in **both**
      `apps/server/test/harness.ts` and `e2e/db.ts`
- [ ] New endpoints have MSW handlers in `apps/web/tests/msw/handlers.ts`

## Product rules

- [ ] No model, heuristic, or cutoff evaluates an applicant
- [ ] Every aggregate's derivation can be displayed
- [ ] No applicant content in logs, URLs, analytics, Sentry, or email payloads
- [ ] No real applicant data in fixtures or seeds
- [ ] No secret in this diff, this description, or any linked transcript
