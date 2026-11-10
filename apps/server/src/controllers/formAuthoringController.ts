import type { QuestionConfig, VisibilityRule } from "@recruit/common";
import { form, formVersion, question } from "@recruit/db/schema";
import { eq } from "drizzle-orm";
import type { Request as ExpressRequest } from "express";
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Path,
  Post,
  Request,
  Route,
  Security,
  SuccessResponse,
} from "tsoa";

import { getAcUserFromRequest } from "../lib/accessControl.ts";
import { BEARER_AUTH, OIDC_AUTH } from "../lib/authentication.ts";
import { getAbilityFor } from "../lib/authorize.ts";
import { db } from "../lib/db.ts";
import { AuthenticationError, NotFoundError } from "../middlewares/errorHandler.ts";
import type { DraftView } from "../services/formAuthoringService.ts";
import { formAuthoringService } from "../services/formAuthoringService.ts";

interface QuestionBody {
  questionKey: string;
  type: string;
  label: string;
  description?: string | null;
  required?: boolean;
  config?: QuestionConfig | null;
  /**
   * May reference only an **earlier** question in the same version.
   *
   * Accepted here and checked at publish, where the whole set is visible. A
   * rule depending on a later answer can never be satisfied, because
   * `evaluateVisibility` is a single pass in position order.
   */
  visibilityRule?: VisibilityRule | null;
}

interface FormMetadataBody {
  title?: string;
  description?: string | null;
}

interface ReorderBody {
  /** Every question in the draft, in the order they should appear. */
  questionIds: string[];
}

async function callerId(req: ExpressRequest): Promise<string> {
  const user = await getAcUserFromRequest(req);
  if (user.id === "") {
    throw new AuthenticationError();
  }
  return user.id;
}

/**
 * The cycle a form belongs to, before any authority is resolved.
 *
 * Grants are per cycle, so the ability cannot be built without knowing which
 * cycle the caller is acting in — and the form is what says. Looking the form
 * up first is therefore unavoidable; what matters is that **nothing is
 * returned** from it until `assertCan` has run inside the service.
 */
async function cycleOf(formId: string): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(formId)) {
    throw new NotFoundError();
  }
  const [row] = await db.select({ cycleId: form.cycleId }).from(form).where(eq(form.id, formId));
  if (!row) {
    throw new NotFoundError();
  }
  return row.cycleId;
}

/**
 * Form authoring: drafts, questions, and publishing.
 *
 * Every route is authorized by the **ability**, never by a role string. The
 * distinction that matters most: `publish` is a separate action from `update`
 * in the vocabulary, so a `question_editor` reaching the publish route is
 * refused by the same mechanism that lets them edit — and refused with 404,
 * because a route they may not use should not confirm it exists.
 *
 * Common and committee forms share these routes entirely. A common form is the
 * organization's (`team_id IS NULL`, enforced by a check constraint) and a
 * committee form is its director's; the authority differs and the code path
 * does not.
 */
@Route("")
export class FormAuthoringController extends Controller {
  /** Every form in a cycle the caller may edit. */
  @Get("cycles/{cycleId}/forms")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async listForms(@Request() req: ExpressRequest, @Path() cycleId: string) {
    const ability = await getAbilityFor(req, cycleId);
    return await formAuthoringService.listForms(ability, cycleId);
  }

  /**
   * The draft, created on demand and pre-filled from the last published
   * version.
   *
   * A GET that may create a row, deliberately. A form with no version is the
   * ordinary starting state of every new committee, and making the builder
   * POST a version before it can render anything would be ceremony with a
   * failure mode — a director who refreshes mid-setup would have two.
   */
  @Get("forms/{formId}/draft")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async getDraft(@Request() req: ExpressRequest, @Path() formId: string): Promise<DraftView> {
    const userId = await callerId(req);
    const ability = await getAbilityFor(req, await cycleOf(formId));
    return await formAuthoringService.getDraft(ability, formId, userId);
  }

  @Patch("forms/{formId}/draft")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async updateForm(
    @Request() req: ExpressRequest,
    @Path() formId: string,
    @Body() body: FormMetadataBody,
  ) {
    const ability = await getAbilityFor(req, await cycleOf(formId));
    return await formAuthoringService.updateForm(ability, formId, body);
  }

  @Post("forms/{formId}/questions")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(201)
  async addQuestion(
    @Request() req: ExpressRequest,
    @Path() formId: string,
    @Body() body: QuestionBody,
  ) {
    const userId = await callerId(req);
    const ability = await getAbilityFor(req, await cycleOf(formId));
    const created = await formAuthoringService.addQuestion(ability, formId, userId, body);
    this.setStatus(201);
    return created;
  }

  @Post("forms/{formId}/reorder")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async reorder(@Request() req: ExpressRequest, @Path() formId: string, @Body() body: ReorderBody) {
    const ability = await getAbilityFor(req, await cycleOf(formId));
    return await formAuthoringService.reorder(ability, formId, body.questionIds);
  }

  /**
   * Freezes the draft. **A director power.**
   *
   * There is no editor route for this, and an editor who finds it is answered
   * 404 by `assertCan`. Gated on the `publish` action rather than on a role
   * comparison, which is the whole reason `publish` is its own action.
   */
  @Post("forms/{formId}/publish")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async publish(@Request() req: ExpressRequest, @Path() formId: string) {
    const ability = await getAbilityFor(req, await cycleOf(formId));
    return await formAuthoringService.publish(ability, formId);
  }
}

/**
 * Question-level routes, which address a question rather than its form.
 *
 * Separate only because the path is `/v1/questions/:id` per `docs/api.md`
 * section 4. The authority resolution is identical and lives in the service,
 * which refuses anything belonging to a published version.
 */
@Route("questions")
export class QuestionsController extends Controller {
  @Patch("{questionId}")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(200)
  async updateQuestion(
    @Request() req: ExpressRequest,
    @Path() questionId: string,
    @Body() body: Partial<QuestionBody>,
  ) {
    const ability = await getAbilityFor(req, await cycleOfQuestion(questionId));
    return await formAuthoringService.updateQuestion(ability, questionId, body);
  }

  @Delete("{questionId}")
  @Security(OIDC_AUTH)
  @Security(BEARER_AUTH)
  @SuccessResponse(204)
  async deleteQuestion(@Request() req: ExpressRequest, @Path() questionId: string): Promise<void> {
    const ability = await getAbilityFor(req, await cycleOfQuestion(questionId));
    await formAuthoringService.deleteQuestion(ability, questionId);
    this.setStatus(204);
  }
}

/** The cycle a question's form belongs to. See `cycleOf` for why this is needed. */
async function cycleOfQuestion(questionId: string): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(questionId)) {
    throw new NotFoundError();
  }
  const [row] = await db
    .select({ cycleId: form.cycleId })
    .from(question)
    .innerJoin(formVersion, eq(question.formVersionId, formVersion.id))
    .innerJoin(form, eq(formVersion.formId, form.id))
    .where(eq(question.id, questionId));
  if (!row) {
    throw new NotFoundError();
  }
  return row.cycleId;
}
