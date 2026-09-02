import type { RecruitmentUser } from "@labrador/access-control";
import { canReadApplicantIdentity, canReadLeadershipContext } from "@labrador/access-control";
import { candidacyVisibilityWhere } from "@labrador/access-control/visibility";
import {
  applicant,
  application,
  applicationAnswer,
  committee,
  committeeCandidacy,
  committeePreference,
  questionDefinition,
  reviewAssignment,
} from "@labrador/db/schema";
import { and, asc, eq, exists, inArray } from "drizzle-orm";

import { db } from "../lib/db.ts";
import { HttpError } from "../middlewares/errorHandler.ts";

export interface ApplicationListItem {
  applicationId: string;
  applicantName: string | null;
  email: string | null;
  year: string;
  major: string | null;
  committees: Array<{ committeeId: string; name: string; rank: number; hasCandidacy: boolean }>;
}

export interface AnswerSection {
  section: string;
  committeeId: string | null;
  committeeName: string | null;
  answers: Array<{
    key: string;
    questionText: string;
    answerText: string | null;
    answerType: string;
    displayOrder: number;
  }>;
}

export interface ApplicationDetail {
  applicationId: string;
  cycleId: string;
  applicantName: string | null;
  email: string | null;
  year: string;
  rawYear: string | null;
  major: string | null;
  rankingExplanation: string | null;
  /**
   * Shown to leadership for context. Deliberately excluded from every scoring
   * path: who an applicant wants to sit with must not influence their score.
   */
  friendRequest: string | null;
  heardAboutScottylabs: string | null;
  preferences: Array<{ committeeId: string; name: string; rank: number }>;
  sections: AnswerSection[];
}

/**
 * Applications the caller may see.
 *
 * A reviewer reaches an application only through an assignment, expressed here
 * as an EXISTS subquery rather than a join so an applicant with several
 * assignments still yields one row. Leads and admins see their committees'
 * whole pool via the candidacy predicate.
 */
function visibleApplicationWhere(acUser: RecruitmentUser, cycleId: string) {
  const isReviewerOnly = acUser.recruitment.memberships.every((m) => m.role === "reviewer");

  const candidacyScope = exists(
    db
      .select({ one: committeeCandidacy.id })
      .from(committeeCandidacy)
      .where(
        and(
          eq(committeeCandidacy.applicationId, application.id),
          candidacyVisibilityWhere(acUser, committeeCandidacy),
          isReviewerOnly
            ? exists(
                db
                  .select({ one: reviewAssignment.id })
                  .from(reviewAssignment)
                  .where(
                    and(
                      eq(reviewAssignment.candidacyId, committeeCandidacy.id),
                      eq(reviewAssignment.reviewerUserId, acUser.id),
                    ),
                  ),
              )
            : undefined,
        ),
      ),
  );

  return and(eq(application.cycleId, cycleId), candidacyScope);
}

export const applicantService = {
  listApplications: async (
    acUser: RecruitmentUser,
    cycleId: string,
    options?: { committeeId?: string; limit?: number; offset?: number },
  ): Promise<ApplicationListItem[]> => {
    if (acUser.id === "" || acUser.recruitment.memberships.length === 0) {
      throw new HttpError(403, "You have no recruitment role in this cycle");
    }

    const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
    const offset = Math.max(0, options?.offset ?? 0);
    const showIdentity = canReadApplicantIdentity({ user: acUser, cycleId });

    const rows = await db
      .select({
        applicationId: application.id,
        applicantName: applicant.fullName,
        email: applicant.email,
        year: application.year,
        major: application.major,
      })
      .from(application)
      .innerJoin(applicant, eq(application.applicantId, applicant.id))
      .where(visibleApplicationWhere(acUser, cycleId))
      .orderBy(asc(applicant.fullName))
      .limit(limit)
      .offset(offset);

    if (rows.length === 0) {
      return [];
    }

    const applicationIds = rows.map((row) => row.applicationId);

    const preferences = await db
      .select({
        applicationId: committeePreference.applicationId,
        committeeId: committee.id,
        name: committee.name,
        rank: committeePreference.rank,
      })
      .from(committeePreference)
      .innerJoin(committee, eq(committeePreference.committeeId, committee.id))
      .where(inArray(committeePreference.applicationId, applicationIds))
      .orderBy(asc(committeePreference.rank));

    const candidacies = await db
      .select({
        applicationId: committeeCandidacy.applicationId,
        committeeId: committeeCandidacy.committeeId,
      })
      .from(committeeCandidacy)
      .where(
        and(
          inArray(committeeCandidacy.applicationId, applicationIds),
          eq(committeeCandidacy.active, true),
        ),
      );

    const candidacyKeys = new Set(
      candidacies.map((row) => `${row.applicationId}:${row.committeeId}`),
    );

    return rows.map((row) => ({
      applicationId: row.applicationId,
      applicantName: showIdentity ? row.applicantName : null,
      email: showIdentity ? row.email : null,
      year: row.year,
      major: row.major,
      committees: preferences
        .filter((p) => p.applicationId === row.applicationId)
        .map((p) => ({
          committeeId: p.committeeId,
          name: p.name,
          rank: p.rank,
          hasCandidacy: candidacyKeys.has(`${row.applicationId}:${p.committeeId}`),
        })),
    }));
  },

  /**
   * One application, with answers grouped into sections rather than returned as
   * a flat sixty-six-column row, so a reviewer reads what is relevant first.
   */
  getApplication: async (
    acUser: RecruitmentUser,
    applicationId: string,
  ): Promise<ApplicationDetail> => {
    const [row] = await db
      .select({
        applicationId: application.id,
        cycleId: application.cycleId,
        applicantName: applicant.fullName,
        email: applicant.email,
        year: application.year,
        rawYear: application.rawYear,
        major: application.major,
        rankingExplanation: application.rankingExplanation,
        friendRequest: application.friendRequest,
        heardAboutScottylabs: application.heardAboutScottylabs,
      })
      .from(application)
      .innerJoin(applicant, eq(application.applicantId, applicant.id))
      .where(eq(application.id, applicationId));

    if (!row) {
      throw new HttpError(404, "Application not found");
    }

    // Re-check visibility for this specific application. Absent, not forbidden.
    const [visible] = await db
      .select({ id: application.id })
      .from(application)
      .where(and(eq(application.id, applicationId), visibleApplicationWhere(acUser, row.cycleId)));

    if (!visible) {
      throw new HttpError(404, "Application not found");
    }

    const showIdentity = canReadApplicantIdentity({ user: acUser, cycleId: row.cycleId });
    // The friend request is context for a placement conversation, never an
    // input to a score. Withheld at the server rather than merely unrendered,
    // so an ordinary reviewer never receives it at all.
    const showLeadershipContext = canReadLeadershipContext({
      user: acUser,
      application: { cycleId: row.cycleId },
    });

    const preferences = await db
      .select({ committeeId: committee.id, name: committee.name, rank: committeePreference.rank })
      .from(committeePreference)
      .innerJoin(committee, eq(committeePreference.committeeId, committee.id))
      .where(eq(committeePreference.applicationId, applicationId))
      .orderBy(asc(committeePreference.rank));

    const answers = await db
      .select({
        key: questionDefinition.key,
        section: questionDefinition.section,
        committeeId: questionDefinition.committeeId,
        committeeName: committee.name,
        questionText: questionDefinition.questionText,
        answerType: questionDefinition.answerType,
        displayOrder: questionDefinition.displayOrder,
        isSensitive: questionDefinition.isSensitive,
        answerText: applicationAnswer.answerText,
      })
      .from(applicationAnswer)
      .innerJoin(
        questionDefinition,
        eq(applicationAnswer.questionDefinitionId, questionDefinition.id),
      )
      .leftJoin(committee, eq(questionDefinition.committeeId, committee.id))
      .where(eq(applicationAnswer.applicationId, applicationId))
      .orderBy(asc(questionDefinition.displayOrder));

    const sections = new Map<string, AnswerSection>();
    for (const answer of answers) {
      // A sensitive question is withheld entirely while identity is hidden,
      // rather than blanked, so a reviewer is not told what they cannot see.
      if (answer.isSensitive && !showIdentity) {
        continue;
      }

      const key = `${answer.section}:${answer.committeeId ?? ""}`;
      const existing = sections.get(key) ?? {
        section: answer.section,
        committeeId: answer.committeeId,
        committeeName: answer.committeeName,
        answers: [],
      };

      existing.answers.push({
        key: answer.key,
        questionText: answer.questionText,
        answerText: answer.answerText,
        answerType: answer.answerType,
        displayOrder: answer.displayOrder,
      });
      sections.set(key, existing);
    }

    return {
      applicationId: row.applicationId,
      cycleId: row.cycleId,
      applicantName: showIdentity ? row.applicantName : null,
      email: showIdentity ? row.email : null,
      year: row.year,
      rawYear: row.rawYear,
      major: row.major,
      rankingExplanation: row.rankingExplanation,
      friendRequest: showLeadershipContext ? row.friendRequest : null,
      heardAboutScottylabs: row.heardAboutScottylabs,
      preferences,
      sections: [...sections.values()],
    };
  },
};
