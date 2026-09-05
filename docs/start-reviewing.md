# Start reviewing

For everyone on a recruitment committee. It takes about five minutes to get in
and about ten minutes per application after that.

The person running the cycle should read [part one](#for-whoever-runs-the-cycle)
first — nothing below works until they have done it.

## Signing in

1. Open the deployment URL your recruitment admin gave you.
2. **Sign In**, then your **Andrew ID** and the temporary password you were
   sent. (You can type `jdoe` or `jdoe@andrew.cmu.edu`; both work.)
3. You are asked to choose your own password before you can go any further —
   at least 12 characters, and not the temporary one. This is not optional: an
   administrator issued that password and it very likely travelled through a
   chat message, and this cycle holds real applicants' names, essays and
   contact details. Replacing it signs every other session out.
4. You land on **Recruitment**. Pick the cycle.

If you have no account, or the password does not work, ask your recruitment
admin to issue you a new one. There is no self-service reset and no sign-up
form: accounts are granted, never claimed, so nobody can assert an Andrew ID
that is not theirs.

If you can sign in but see "you have no standing in this cycle", the account
exists and the membership does not. That is a one-line fix for your admin.

## Reviewing

**My Queue** is your work, and only your work. You reach an applicant through an
assignment; there is no way to browse into somebody else's.

The queue is ordered so the applicants who matter most to your committee come
first, and the **Priority** column says why:

| Label                      | Meaning                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `#1 + wrote`               | Ranked you first **and** answered your committee's questions |
| `#2 + wrote`, `#3 + wrote` | Ranked you second or third, and answered                     |
| `no response`              | Everyone else, ordered by the rank they gave you             |

Open one and you get the application on the left, the rubric on the right.

1. **Score each criterion 1–5.** The rubric your committee published says what
   each criterion means. One criterion — the applicant's own committee
   preference — is filled in for you from their ranking; you cannot score it,
   and trying is rejected.
2. **Pick a recommendation** (Strong Yes → Strong No) **and a confidence.**
3. **Write a rationale.** This one is required. Other reviewers and your
   committee lead read it, and a score with no reasoning cannot be discussed.

Drafts save as you type, so you can stop halfway and come back.

**Submit** is explicit and locks the review. Only a recruitment admin can reopen
one, so read it back before you press it.

### Two things worth knowing

- **You cannot see anyone else's review of an applicant until you have
  submitted your own.** This is enforced in the database, not by hiding buttons.
  It is there so nobody anchors on a colleague's number.
- **If you know the applicant, declare a conflict.** One button, one
  confirmation, and you are never asked why — requiring a reason would push you
  to disclose a personal relationship. Your draft is discarded, the applicant is
  not penalised, and somebody else is assigned in your place.

### External links

GitHub, LinkedIn and portfolio links appear as plain links. The platform never
fetches them and never scores them. If you want to look, click and look — that
judgement is yours, and it belongs in your rationale.

## For committee leads

You see everything a reviewer sees, plus your committee's whole pool.

- **Assignments** — fill your committee's queues. Set how many reviewers each
  applicant should get, **Preview**, check the plan, then confirm. Safe to
  re-run: it only ever adds, never undoes a conflict, and never touches a review
  anyone has started. See
  [`running-a-cycle.md` §4](running-a-cycle.md#4-assign-reviewers).
- **Ranking** — the arithmetic beside every applicant: how many reviews, mean,
  median, spread, the spread of recommendations, and any disagreement flag with
  its reason in words. Record a decision per row, or select several.
- **Disagreements** — where reviewers diverged, and why it was flagged. It is a
  prompt to talk, not a verdict.

Nothing is ever decided for you. If the cycle has admit or reject lines
configured they are drawn on the ranking and can select rows in one click, but a
person still confirms every decision, and the audit log records who.

## For whoever runs the cycle

The order matters: an account, then a membership, then an assignment. Skip one
and the person signs in to an empty screen.

1. **Create the cycle** (a global admin does this once) and grant yourself a
   `recruitment_admin` membership under **Settings → Who may review**. Holding
   an infrastructure role gives you no applicant data until you enrol yourself,
   and that enrolment is audited.
2. **Settings → Committees.** Each committee's slug must match what the
   application form's column headers use.
3. **Settings → Sign-in accounts.** One row per teammate: Andrew ID, name,
   role. The temporary password is shown **once** and never stored in readable
   form — copy it before you close the box. If it is lost, issue a new one.
   (This section disappears once single sign-on is configured; people then
   provision themselves on first login.)
4. **Settings → Who may review.** Grant each person a role and a committee.
   Creating the account in step 3 is enough for this to resolve — they do not
   need to have signed in first.
   - `reviewer` — one committee: their queue, reviewing, conflicts.
   - `committee_lead` — one committee: the above, plus the pool, aggregates,
     assignments and decisions.
   - `recruitment_admin` — the whole cycle: the above, plus import, settings,
     memberships, exports, reopening reviews and final placement.
   - Somebody on two committees needs two memberships. Assignment never
     silently widens access.
5. **Rubric.** Publish one per committee _before_ reviewing starts. A submitted
   review stays pinned to the version it was scored under, so publishing a new
   one never rewrites history.
6. **Import** the applications, or connect the sheet under **Settings →
   Application source**. Preview first; nothing is written until you commit.
   Re-importing the same file is safe — identity is cycle plus normalised
   email, so it updates rather than duplicates and never touches a review.
7. **Assignments.** Preview, check, confirm. Now everyone has a queue.

Then send your team the deployment URL, their Andrew ID, and their temporary
password.

### Where the data lives

Nothing is in the browser and nothing is in a spreadsheet. Every application,
score, rationale, assignment, decision and audit entry is a row in the
**Postgres database** the deployment is configured against — `DATABASE_URL`, a
Neon instance today. The interface holds no state of its own: two people on two
laptops are reading the same rows, and closing a tab loses nothing but an
unsaved keystroke or two.

Drafts are rows too, saved as you type, so a closed laptop does not lose a
half-finished review.

## Getting the data out

**Exports** (leadership only) has three, each previewed on screen before you
download anything:

| Export            | Rows              | Contains                                                                                                                                                                                                      |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ranking**       | one per candidacy | Rank, name, email, year, major, committee, their own ranking of it, review count, mean, median, spread, standard deviation, the recommendation distribution, disagreement flags and reasons, and the decision |
| **Decisions**     | one per candidacy | Name, email, year, committee, their ranking, the committee's proposal and notes, and the final placement                                                                                                      |
| **Reviewer load** | one per reviewer  | Reviewer, role, committee, assigned, submitted, conflicted, outstanding                                                                                                                                       |

All three download as CSV, which opens in Sheets or Excel directly.

The ranking and decision exports carry applicant names and emails, so they are
restricted to committee leads and recruitment admins, and every download is
recorded in the audit log with who and when. **Reviewer load deliberately
contains no applicant data at all**, so it can be circulated to the whole team
to chase coverage without leaking anything.

For a full dump beyond these three, the database is ordinary Postgres — any SQL
client against `DATABASE_URL` will do it.

## What the platform will never do

Worth knowing, because a few of the choices above look strange until you see the
reason. The full list is [`product-rules.md`](product-rules.md).

- **No AI or model evaluates an applicant.** Nothing is scored from essay text;
  no trait is inferred from anything anyone wrote. Every subjective number in
  the system was typed by a named human.
- **No link an applicant supplied is ever fetched.** They render as inert text.
- **No automatic accept or reject**, including by numeric cutoff. A cutoff can
  select rows; a person confirms them.
- **The friend-placement answer is shown for context and excluded from every
  scoring path.**

Every number on screen can be reproduced by hand from the reviews it summarises.
If one cannot, that is a bug worth reporting.
