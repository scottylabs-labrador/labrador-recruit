# Product Rules

These rules constrain what the platform is allowed to do. They are not style preferences.
A change that violates one of them is a defect regardless of how well it is implemented.

They were adopted for the single-committee version and carry over to ScottyLabs Recruit
unchanged in substance, because they are ScottyLabs recruitment policy rather than a
property of one implementation. Section 8 is new, and is the rule the multi-committee
platform adds.

## 1. No automated applicant evaluation

The platform must not judge, analyse, summarise, classify, rank, or score applicants using
an LLM or any other ML model.

### Permitted

- Import application data and display submitted answers verbatim.
- Derive an applicant's committee preference from the ranking they themselves submitted.
- Store ratings entered by a named human reviewer.
- Compute deterministic arithmetic over human-entered ratings: mean, median, minimum,
  maximum, spread, standard deviation, completion percentage.
- Flag reviewer disagreement using transparent, configured thresholds.
- Sort and rank candidates using configured formulas over human review data.
- Assign additional human reviewers.

### Forbidden

- Generating applicant scores from essay text.
- Inferring passion, competence, or fit from written responses.
- Fetching, scraping, or crawling applicant-provided links (LinkedIn, portfolios, personal
  sites). These render as inert external links and are never requested by the server or the
  browser on the applicant's behalf. GitHub is the one exception, narrowly drawn below.
- Inferring protected or sensitive traits.
- Making an automatic accept or reject decision, including by numeric cutoff.

Final recruitment decisions are always made by ScottyLabs leadership.

### Exception: verbatim GitHub facts

Decided 4 September 2026 by ScottyLabs recruitment leadership, on the request that reviewers
be able to see what an applicant has actually built without leaving the review page.

The platform may fetch `github.com` for an applicant who supplied a GitHub link, and may
display only facts as GitHub states them:

- repository name
- the description the applicant wrote themselves
- primary language
- star count
- last-push date
- the repository URL
- how many public repositories use each language, counted across all of them
- commits in the public events GitHub still retains, roughly the last ninety days

The last two were added on 8 September 2026, on the request that a reviewer be
able to see at a glance what somebody works in and whether they are active. Both
are counts of what GitHub itself states. The language tally is arithmetic over
the primary-language field already listed above; the commit figure is labelled
as recent activity wherever it appears, because a number that looks like a
lifetime total and is not would mislead a reviewer more than showing nothing.

Detecting which tools an applicant used to write their code - AI assistants
among them - was considered and refused. There is no such field for GitHub to
state: it could only be inferred from commit trailers and code shape, which is
inference about a person from artifacts and is what section 1 forbids. It is
also a poor signal, largely measuring whether somebody squashes commits, and
using it would penalise applicants for ordinary modern tooling.

Everything else in section 1 stands unchanged, and applies to this data specifically:

- No summary, characterisation, or paraphrase of a repository is generated.
- No score, ranking, or signal is derived from it. It is not an input to any aggregate.
- No inference is drawn from it about skill, passion, competence, or fit. A reviewer reads
  it and forms their own view, exactly as with a submitted answer.
- The carve-out is `github.com` only. No other host is fetched, and a link to anywhere else
  stays an inert anchor.

The data is cached, labelled on screen as fetched from GitHub with the time it was fetched,
so a reviewer can tell it apart from what the applicant submitted to us. It is never
requested while a page is being rendered.

## 2. Explainable math only

Every aggregate must be reproducible by hand from the raw human reviews. For any score the
interface must be able to show which reviews contributed, each rubric score, the weighting
applied, the applicant's submitted preference, and the resulting calculation.

There is never a score whose derivation the platform cannot display. No "AI score" exists.

## 3. Independent review

A reviewer must not see another reviewer's scores, recommendation, or rationale for an
application before submitting their own review. This is enforced in SQL through the
access-control layer, not by hiding elements in the interface.

Only a _submitted_ review unblinds. A draft does not.

Admins and committee directors may hold aggregate visibility; ordinary reviewers stay
blinded until their own review is submitted.

## 4. Team-specific review

The unit of review is `Applicant x Committee x Reviewer`. An applicant may score
differently for Tech than for Labrador. Never collapse suitability into one global score.

Each committee runs its own rubric, its own reviewers, and its own decisions. There is no
cross-committee score, no platform-wide ranking of applicants, and no shared verdict.

## 5. Recruitment-cycle isolation

Every application, rubric, review, assignment, ranking, and decision belongs to a
recruitment cycle. Historical cycles stay inspectable without contaminating the current
one, and settings changes never retroactively mutate submitted review history.

Two mechanisms make this concrete, and both are load-bearing: a published form version is
immutable, and a rubric locks once the first review has been submitted against it. A
question's meaning and a criterion's definition cannot change after somebody answered or
scored against them.

## 6. Privacy

Application data is PII.

- Never commit real applicant exports to the repository. Fixtures are synthetic and
  structurally faithful.
- Never send applicant names, emails, or response text to PostHog.
- Keep applicant content out of Sentry breadcrumbs and error payloads.
- Do not log full application payloads.

## 7. Configuration, not code

Application questions, rubric criteria, weights, required review counts, disagreement
thresholds, application limits, and committee capacities are database-backed
configuration. Changing recruitment policy must never require a code change.

A committee director changes their application form without a pull request, a deploy, or
asking an engineer. If they cannot, that is a defect in this platform's reason for
existing.

## 8. Committee isolation

A committee sees its own applicants and nobody else's.

Carnegie Mellon students submit essays about themselves to a specific committee. A
Design director has no business reading what somebody wrote for Tech, and a Tech reviewer
has no business reading Design's evaluations. This is the rule whose violation would end
the platform's standing with the committees that agreed to use it.

### Required

- Every query that reaches applicant data is narrowed by a compiled access-control
  predicate, in SQL, including the reads that precede an update or a delete.
- A resource the caller may not see returns **404, not 403**. Existence is never leaked.
- A team, cycle, or application identifier supplied by the client is an untrusted input.
  Authorization resolves the caller's grants for the requested resource from the database.
- A reviewer needs **both** a live grant for the committee **and** an assignment to the
  specific application. Neither alone is sufficient.
- A grant on a parent team conveys nothing about a subteam, and a grant on a subteam
  conveys nothing about its parent.
- Revoking a grant takes effect on the next request. Permissions are not cached.

### Forbidden

- Hand-written ownership checks. A rule expressed twice is a rule that will drift, and
  this one decides who reads an applicant's essays.
- Loading rows the caller may not see and filtering them in application code. They reach
  memory, logs, and error payloads on the way.
- Any shared aggregate, ranking, or export that spans committees without an
  organization-scope grant.
- Treating a hidden interface element as the enforcement mechanism. It is a courtesy to
  the user; the server is what makes it true.

Because the Keycloak realm brokers straight to CMU SAML, every Andrew ID at the
university authenticates successfully. Authentication proves only that the caller is some
CMU affiliate. **Authorization is the entire security boundary**, which is why this rule
sits alongside the ones about applicant evaluation rather than in a style guide.

Full model in [`authorization.md`](authorization.md). Every access-control rule needs a
test proving the _denial_ path, not only the happy one.
