# UI

Every route, what is on it, and the shared component inventory.

Routing is TanStack Router with file-based routes under `apps/web/src/routes/`.
`routeTree.gen.ts` is generated — never edit it. TanStack Router relies on
function hoisting, which is why the style guide requires `function foo() {}` over
`const foo = () => {}`.

**Route guards improve navigation. They are not the security boundary.** Every
one of these pages is backed by an endpoint that refuses the request on its own.
A hidden button and a guarded route are courtesies to the user; the server is
what makes them true. See [`authorization.md`](authorization.md).

---

## 1. Student routes

| Route                  | Page                     | Auth        |
| ---------------------- | ------------------------ | ----------- |
| `/recruit`             | recruitment landing page | public      |
| `/signin`              | authentication           | public      |
| `/app/dashboard`       | student dashboard        | any account |
| `/app/profile`         | applicant profile        | any account |
| `/app/committees`      | committee selection      | any account |
| `/app/apply/common`    | common application       | any account |
| `/app/apply/:teamSlug` | committee application    | any account |
| `/app/review`          | pre-submission review    | any account |
| `/app/submissions`     | application history      | any account |
| `/app/submissions/:id` | submission detail        | owner only  |

### `/recruit` — landing page

ScottyLabs Recruit header; the cycle name and deadline; a description of
ScottyLabs; a `CommitteeCard` per participating committee with its name, short
description, and availability; application instructions; an FAQ.

**If applications have not opened, the card shows the upcoming opening date
rather than an active Apply button.** A button that leads to a closed form is
worse than no button.

Public, so it renders from `/v1/cycles/current` and `/v1/openings` only. No
applicant data, no counts.

### `/signin`

ScottyLabs branding; one sign-in action against the identity provider;
verification instructions; a privacy and data-use notice; a support contact.
After authentication, redirect to the destination the user was trying to reach,
not unconditionally to the dashboard.

### `/app/dashboard`

Header: student name, current cycle, deadline, profile menu. Body: welcome,
progress summary ("2 of 3 applications submitted"), `ApplicationCard` per
application, and an Apply to Another Committee action.

Each `ApplicationCard` shows the committee name, draft or submitted status, the
last-saved timestamp, the submission timestamp where applicable, and a Continue,
View, or Withdraw action.

### `/app/committees`

Browse and select. Multiple selection; recruitment descriptions; per-committee
requirements; the application limit if the cycle sets one; optional preference
ranking if the cycle requires it. **Prevent a duplicate application to the same
opening** in the UI, and rely on the unique constraint behind it.

Selecting Labrador and Design creates two `application` rows against one
`candidate_profile`.

### `/app/apply/common` and `/app/apply/:teamSlug`

Both render through `DynamicFormRenderer` from a published form version. Same
component, same validation, same conditional evaluation — the only difference is
which form is loaded and what the response attaches to.

Autosave after a short idle period, plus a manual Save Draft, plus an
`AutosaveIndicator` showing the last-saved time. A 409 from a stale revision
**tells the user their other tab is ahead**; it does not discard their work and
does not silently overwrite.

Conditional questions appear and disappear via `evaluateVisibility` from
`packages/common` — the same function the server uses to validate. A hidden
question is not required and its stale answer is not submitted.

Once `common_locked_at` is set, the common form renders read-only with an
explanation of why and who to ask for a correction.

### `/app/review`

Before submitting: the completed common questions; the selected committees; each
committee's completed questions; uploaded attachments; **missing required fields,
listed explicitly and linked**; the deadline.

Submit validates every section, then calls `POST /v1/me/submissions`. The
confirmation page appears only after the server confirms the commit.

### `/app/submissions` and `/app/submissions/:id`

History and detail, showing the projected status only — `Draft | Submitted |
Under Review | Interview | Decision Available | Withdrawn`. **No score, no
shortlist position, no reviewer identity, no internal note, ever.** Decisions
appear only after an organization admin has released them.

---

## 2. Committee and reviewer routes

| Route                                | Page                 | Minimum grant         |
| ------------------------------------ | -------------------- | --------------------- |
| `/admin/teams/:teamId`               | committee dashboard  | reviewer              |
| `/admin/teams/:teamId/forms`         | form builder         | question_editor       |
| `/admin/teams/:teamId/applicants`    | applicant list       | committee_director    |
| `/admin/applications/:applicationId` | applicant detail     | committee_director    |
| `/admin/teams/:teamId/reviews`       | review overview      | committee_director    |
| `/admin/teams/:teamId/members`       | team management      | committee_director    |
| `/admin/teams/:teamId/settings`      | recruitment settings | committee_director    |
| `/review`                            | reviewer dashboard   | reviewer              |
| `/review/applications/:assignmentId` | assigned review      | reviewer + assignment |

### `/admin/teams/:teamId` — committee dashboard

Sidebar: Overview, Application Form, Applicants, Reviews, Team Members,
Recruitment Settings. Body: committee name, current cycle, recruitment status,
`StatsCard`s for submitted / awaiting review / reviewed / shortlisted, upcoming
deadlines. Quick actions: Edit Questions, Preview Application, Invite Reviewer,
View Applicants, Manage Decisions.

**Every quick action is gated by a `can*` predicate**, so a reviewer opening this
page sees the counts and none of the director actions.

### `/admin/teams/:teamId/forms` — form builder

The three-panel editor. Left: question toolbox — short answer, long answer,
multiple choice, checkboxes, dropdown, number, URL, file upload, section
heading, description. Centre: form title, description, the ordered question list,
Add Question, reorder handles, required indicators, duplicate and delete. Right:
settings for the selected question — title, help text, placeholder, required,
min and max length, answer choices, allowed file types, conditional visibility.

`dnd-kit` for reordering. React Hook Form plus Zod for the settings panel.

Two requirements that are easy to get wrong:

- **Preview Mode renders `DynamicFormRenderer`** — the actual student component,
  imported from `components/forms/`. Not a lookalike built for the builder. A
  preview that can diverge from the real renderer misleads the person relying on
  it most.
- **`ConditionalRuleEditor` produces structured data** that round-trips through
  `visibility_rule_json`, and the preview evaluates it with
  `evaluateVisibility`. You do not write a second evaluator.

A question editor sees drafts and has no Publish affordance. Desktop-first is
acceptable here; it must still not be broken on a tablet.

### `/admin/teams/:teamId/applicants`

A searchable `ApplicantTable`. Columns: applicant name, submission date,
application status, completed review count, assigned reviewers, review progress,
final decision where available. Filters: Submitted, Awaiting Review, In Review,
Shortlisted, Interview, Accepted/Offered, Rejected, Waitlisted. Search by name;
sort by submission date or review progress.

**Filters persist when you navigate into an application and back.** Put them in
typed search params — this is a large part of why we kept TanStack Router. A
director who filters to 40 shortlisted applicants, opens one, and comes back to
an unfiltered list of 400 will not forgive it.

### `/admin/applications/:applicationId`

Applicant name and profile; common answers; committee-specific answers;
authorized uploaded files; submission metadata; assigned reviewers; review
completion; internal comments; decision status.

**The applicant's own submitted material and the internal evaluation notes are
structurally separated**, not merely styled differently — distinct regions with
distinct headings, so a reviewer is never unsure which is which. Internal notes
never appear in the student portal, and the endpoint does not return them there.

### `/admin/teams/:teamId/members`

Current directors, question editors, reviewers, pending invitations, and each
grant's scope and expiry. Actions: Invite Member, Assign Permissions, Revoke
Permissions, Resend or Revoke Invitation, View Invitation History.

A committee director manages helpers and **cannot appoint another director** —
there is no affordance, and no endpoint.

### `/review` — reviewer dashboard

Assigned committee, current cycle, total assigned, completed, pending, review
deadline, and a `ReviewProgressIndicator` showing the caller's count against the
cycle's target. A `ReviewAssignmentCard` per assignment linking to the review.

### `/review/applications/:assignmentId`

Left or top: the applicant's submitted answers, read-only. Right or bottom: the
`ReviewRubric` with a `ScoreInput` per criterion, a recommendation, a confidence,
and a `ReviewCommentEditor`.

**Peer reviews are not on this page until the caller has submitted their own.**
After submitting, the page shows what other reviewers said. A draft does not
unblind. This is enforced server-side; the UI must not attempt to show it
optimistically.

---

## 3. Organization admin routes

| Route               | Page                   |
| ------------------- | ---------------------- |
| `/admin/overview`   | organization dashboard |
| `/admin/cycles`     | recruitment cycles     |
| `/admin/cycles/new` | create a cycle         |
| `/admin/cycles/:id` | cycle configuration    |
| `/admin/committees` | committee management   |
| `/admin/directors`  | director invitations   |
| `/admin/analytics`  | organization analytics |
| `/admin/audit`      | audit history          |

`/admin/cycles/:id` is where the status machine is driven. Each transition is an
explicit, confirmed action showing what it will change —
`Draft → Scheduled → Open → Closed → Reviewing → Decisions Released → Archived`.

**Decision release is a distinct, confirmed, irreversible-feeling action** on its
own screen, not a toggle in a settings list. It is the moment applicants find
out, and the interface should feel like it.

`/admin/analytics` shows aggregates only. Counts, rates, distributions. No names,
no emails, no response text.

---

## 4. Role switching

A person may be an applicant and staff at once. One account, and a switcher in
the profile menu between the student surface and whichever staff surfaces their
grants reach.

`GET /v1/me` returns which surfaces this account can see, so the switcher is
driven by the server rather than by the client guessing from a role string. A
person with no grants never sees the switcher at all.

A director applying to another committee reads their own application through
`/app/*`. The staff surface has no path to it.

---

## 5. Shared components

### Application

`CommitteeCard`, `ApplicationCard`, `ApplicationProgress`,
`DynamicFormRenderer`, `FormSection`, `QuestionField`, `AutosaveIndicator`,
`SubmissionSummary`, `FileUploader`, `StatusBadge`

`DynamicFormRenderer` and `QuestionField` are the most reused components in the
project — the student application, the common form, and the builder preview all
go through them. Their props are a shared interface; change them by agreement,
not unilaterally.

### Director

`DirectorSidebar`, `StatsCard`, `FormBuilderCanvas`, `QuestionEditor`,
`QuestionSettingsPanel`, `QuestionTypeSelector`, `ConditionalRuleEditor`,
`FormPreview`, `ApplicantTable`, `ApplicantDetail`, `InvitationDialog`,
`PermissionSelector`, `RecruitmentCycleSelector`

### Reviewer

`ReviewQueue`, `ReviewAssignmentCard`, `ReviewRubric`, `ScoreInput`,
`ReviewCommentEditor`, `ReviewProgressIndicator`

### Shared

Navigation, buttons, dialogs, tables, search and filters, dropdowns, toast
notifications, loading skeletons, empty states, error pages, confirmation modals.

shadcn/ui is the base. Extend it rather than hand-rolling a primitive that
already exists.

---

## 6. Quality bar

- **Consistent ScottyLabs branding** across all three surfaces.
- **Accessible colour contrast.** Not "looks fine" — meets the ratio.
- **Keyboard navigation throughout.** The whole student flow must be completable
  without a mouse. This is also the cheapest way to catch a dozen other
  problems.
- **Clearly labelled form fields.** A placeholder is not a label.
- **The student experience is fully usable on mobile.** Non-negotiable; students
  will apply on a phone between classes.
- The form builder and review dashboard may prioritize desktop layouts while
  staying basically accessible on small screens.
- **Loading states are skeletons, not spinners**, where the shape of the content
  is known. Empty states say what to do next, not just that there is nothing.
- **Error states say what happened and what to do.** "Something went wrong" is a
  placeholder, not a message.
