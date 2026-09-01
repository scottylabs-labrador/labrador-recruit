# Product Rules

These rules constrain what the platform is allowed to do. They are not style preferences.
A change that violates one of them is a defect regardless of how well it is implemented.

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
- Fetching, scraping, or crawling applicant-provided links (GitHub, LinkedIn, portfolios,
  personal sites). These render as inert external links and are never requested by the
  server or the browser on the applicant's behalf.
- Inferring protected or sensitive traits.
- Making an automatic accept or reject decision, including by numeric cutoff.

Final recruitment decisions are always made by ScottyLabs leadership.

## 2. Explainable math only

Every aggregate must be reproducible by hand from the raw human reviews. For any score the
interface must be able to show which reviews contributed, each rubric score, the weighting
applied, the applicant's submitted preference, and the resulting calculation.

There is never a score whose derivation the platform cannot display. No "AI score" exists.

## 3. Independent review

A reviewer must not see another reviewer's scores, recommendation, or rationale for a
candidacy before submitting their own review. This is enforced in SQL through the
access-control layer, not by hiding elements in the interface.

Admins and committee leads may hold aggregate visibility; ordinary reviewers stay blinded
until their own review is submitted.

## 4. Team-specific review

The unit of review is `Applicant x Committee x Reviewer`. An applicant may score
differently for Tech than for Labrador. Never collapse suitability into one global score.

## 5. Recruitment-cycle isolation

Every application, rubric, review, assignment, ranking, and decision belongs to a
recruitment cycle. Historical cycles stay inspectable without contaminating the current
one, and settings changes never retroactively mutate submitted review history.

## 6. Privacy

Application data is PII.

- Never commit real applicant exports to the repository. Fixtures are synthetic and
  structurally faithful.
- Never send applicant names, emails, or response text to PostHog.
- Keep applicant content out of Sentry breadcrumbs and error payloads.
- Do not log full application payloads.

## 7. Configuration, not code

Rubric criteria, weights, preference mapping, required review counts, disagreement
thresholds, candidacy generation rules, and committee capacities are database-backed
configuration. Changing recruitment policy must never require a code change.
