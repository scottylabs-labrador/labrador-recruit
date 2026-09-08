import type { MongoAbility } from "@casl/ability";
import { rulesToAST } from "@casl/ability/extra";
import { CompoundCondition, type Condition, FieldCondition } from "@ucast/core";
import {
  and,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { PgTableWithColumns, TableConfig } from "drizzle-orm/pg-core";

/**
 * Thrown when the caller holds no rule at all for an action on a subject.
 *
 * There is nothing to compile into a `WHERE` clause in that case - the answer
 * is not "no rows", it is "you may not ask". Owning the error rather than
 * re-throwing CASL's own is what lets the server map it to a 403: CASL's
 * `ForbiddenError` is an ordinary `Error` whose class is not reliably
 * identifiable across bundles, so it reached the handler as an unexpected
 * failure and every such refusal was reported as a 500 - with CASL's internal
 * wording ("Cannot execute \"read\" on \"Candidacy\"") in the response body.
 *
 * This package still knows nothing about HTTP. It names the condition; the
 * server decides what status that condition deserves.
 */
export class NotPermittedError extends Error {
  readonly action: string;
  readonly subject: string;

  constructor(action: string, subject: string) {
    super(`Not permitted to ${action} ${subject}`);
    this.name = "NotPermittedError";
    this.action = action;
    this.subject = subject;
  }
}

export function drizzleWhere<T extends TableConfig>(
  ability: MongoAbility,
  action: string,
  subject: string,
  table: PgTableWithColumns<T>,
): SQL | undefined {
  const condition = rulesToAST(ability, action, subject);

  if (!condition) {
    if (ability.can(action, subject)) {
      return undefined;
    }
    throw new NotPermittedError(action, subject);
  }

  return getConditionSql(condition, table);
}

function getConditionSql<T extends TableConfig>(
  condition: Condition,
  table: PgTableWithColumns<T>,
): SQL | undefined {
  if (condition instanceof CompoundCondition) {
    const conditions = condition.value.map((child) => getConditionSql(child, table));

    switch (condition.operator) {
      case "and":
        return and(...conditions);
      case "or":
        return conditions.includes(undefined) ? undefined : or(...conditions);
      case "not": {
        const inner = and(...conditions);
        return inner ? not(inner) : sql<boolean>`false`;
      }
      default:
        throw new Error(`Unsupported compound condition operator: ${condition.operator}`);
    }
  }

  if (condition instanceof FieldCondition) {
    return getFieldConditionSql(condition, table);
  }

  throw new Error(`Unsupported condition operator: ${condition.operator}`);
}

function getFieldConditionSql<T extends TableConfig>(
  condition: FieldCondition,
  table: PgTableWithColumns<T>,
): SQL {
  const column = getTableColumns(table)[condition.field];
  if (!column) {
    throw new Error(`Unknown column in permission condition: ${condition.field}`);
  }

  switch (condition.operator) {
    case "eq":
      return condition.value === null ? isNull(column) : eq(column, condition.value as never);
    case "ne":
      return condition.value === null ? isNotNull(column) : ne(column, condition.value as never);
    case "gt":
      return gt(column, condition.value as never);
    case "gte":
      return gte(column, condition.value as never);
    case "lt":
      return lt(column, condition.value as never);
    case "lte":
      return lte(column, condition.value as never);
    case "in": {
      const values = getArrayValue(condition);
      return values.length === 0 ? sql<boolean>`false` : inArray(column, values);
    }
    case "nin": {
      const values = getArrayValue(condition);
      return values.length === 0 ? sql<boolean>`true` : notInArray(column, values);
    }
    default:
      throw new Error(`Unsupported field condition operator: ${condition.operator}`);
  }
}

function getArrayValue(condition: FieldCondition): unknown[] {
  if (!Array.isArray(condition.value)) {
    throw new Error(`Permission condition "${condition.operator}" requires an array`);
  }

  return condition.value;
}
