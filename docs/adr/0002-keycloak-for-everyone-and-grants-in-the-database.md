# 2. Keycloak for everyone, with authorization in the database

Date: 2026-11-03

## Status

Accepted

## Context

The previous version is an internal review tool. It gates **sign-in** on
membership of the `labrador-recruit` Keycloak group, thrown as a `FORBIDDEN`
error from the `genericOAuth` provider's `mapProfileToUser`. Goldador —
ScottyLabs' permission-as-code repository — is therefore the register of who can
use the system at all, and `AUTH_ALLOWED_GROUPS` names the groups allowed in.

That gate exists for a specific reason, recorded in the code: the
`idp.scottylabs.org/realms/labrador` realm has **no local login form**. Its
authorize endpoint redirects straight to a single CMU SAML provider, so every
Andrew ID at Carnegie Mellon authenticates successfully. Without the gate, any
CMU student could have got an account on a system holding applicant essays.

ScottyLabs Recruit inverts the requirement. Applicants are CMU students, and they
are the primary users. Gating sign-in on a Goldador group is impossible: the
Design Director is not in Labrador's team, and an applicant is in nobody's team.

The proposal, section 3.1, suggests students sign in with a verified CMU email,
staff use the organization's existing system, OIDC where available, and
email-based verification or magic links as an alternative.

## Decision

**One door: Keycloak, for everyone.** The sign-in group gate is removed.

Any CMU account authenticates, gets a `user` row, and holds **zero**
permissions. They can apply to things. They can see nothing internal.

All staff authority comes from `permission_grant` rows in our own database,
issued through an invitation that an authorized person sent and the recipient
accepted. Three independent gates protect applicant data: authentication, a live
grant for the team and cycle, and — for reviewers — a per-application
assignment.

Goldador keeps exactly one job: **bootstrap.** Membership of
`labrador-recruit-admins` derives the global `admin` role, which can create the
first cycle, the first teams, and the first grants. It is the root of trust and
nothing else. A global admin still cannot read applicant data without issuing
themselves an `org_admin` grant, which writes an audit event with their name on
it.

We rejected the magic-link alternative. It would mean two identity paths, two
session models, and `auth_identities` doing real work on day one — and it would
lose the SAML-verified CMU identity that makes an Andrew ID trustworthy as a
primary key.

## Consequences

Good:

- Applicants and staff share one account, which is what the proposal's section
  2.6 requires. No second identity system.
- Identity is SAML-verified. `user.id` is the Andrew ID, which is what every
  grant, assignment, and review points at.
- Adding a reviewer is an invitation inside the product, not a pull request
  against Goldador. The committee director does it themselves.
- Grants carry `granted_by`, `expires_at`, and `revoked_at`, so permission
  history is reconstructable and revocation is immediate.

Bad, or at least demanding:

- **Authentication now proves almost nothing.** It says the caller is some CMU
  affiliate. Authorization becomes the entire security boundary. Every endpoint
  has to be correct on its own, and `docs/authorization.md` exists because of
  this decision.
- The previous version's sign-in-time refusal was a single cheap chokepoint. We
  have traded it for per-resource enforcement, which is more powerful and more
  places to get wrong. The mitigation is that visibility compiles to SQL and is
  `and()`-ed into every query rather than being a check somebody remembers.
- Anybody at CMU can create an account by signing in. Rows will accumulate for
  people who looked once and left. That is acceptable; an empty account is not a
  capability.
- Revalidating an inviter's authority at acceptance time is an easy requirement
  to miss and has no visible symptom when missed. It is called out in
  `docs/authorization.md` section 6 and is part of workstream C's definition of
  done.
