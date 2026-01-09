type Prettify<T> = T extends infer U ? { [K in keyof U]: U[K] } & {} : never;

type DeepPrettify<T> = T extends (infer U)[]
  ? DeepPrettify<U>[]
  : T extends object
  ? Prettify<{ [K in keyof T]: DeepPrettify<T[K]> }>
  : T;

// Diagnostic types for parseWithDiagnostics
export type DiagnosticKind =
  | "coercion"
  | "default"
  | "literal_mismatch"
  | "literal_coercion"
  | "literal_default"
  | "union_selection"
  | "field_alias"
  | "array_wrap";

export interface CoercionDetails {
  from: string;
  to: string;
}

export interface DefaultDetails {
  schema: string;
  value: unknown;
}

export interface LiteralDetails {
  expected: unknown;
  received: unknown;
}

export interface UnionSelectionDetails {
  chosenIndex: number;
  chosenName?: string;
  reason: "exact match" | "type match" | "best score";
}

export interface FieldAliasDetails {
  from: string;
}

export interface ArrayWrapDetails {
  valueType: string;
}

// Strongly typed details by kind
export type DiagnosticDetailsByKind = {
  coercion: CoercionDetails;
  default: DefaultDetails;
  literal_mismatch: LiteralDetails;
  literal_coercion: LiteralDetails;
  literal_default: LiteralDetails;
  union_selection: UnionSelectionDetails;
  field_alias: FieldAliasDetails;
  array_wrap: ArrayWrapDetails;
};

export interface Diagnostic<K extends DiagnosticKind = DiagnosticKind> {
  kind: K;
  path: string;
  details?: DiagnosticDetailsByKind[K];
}

export interface ParseResult<T> {
  value: T;
  diagnostics: Diagnostic[];
}

interface ParseContext {
  diagnostics: Diagnostic[];
  path: (string | number)[];
}

function formatPath(segments: (string | number)[]): string {
  if (segments.length === 0) return "";
  return segments.reduce<string>((acc, segment, i) => {
    if (typeof segment === "number") {
      return `${acc}[${segment}]`;
    }
    return i === 0 ? segment : `${acc}.${segment}`;
  }, "");
}

// Helper to add diagnostic only if context is present
function diag<K extends DiagnosticKind>(
  ctx: ParseContext | undefined,
  kind: K,
  details?: DiagnosticDetailsByKind[K]
): void {
  if (!ctx) return;
  ctx.diagnostics.push({
    kind,
    path: formatPath(ctx.path),
    details,
  } as Diagnostic);
}

export type Schema<T = unknown> = {
  (value: unknown, ctx?: ParseContext): T;
  _output: T;
  _kind: string;
  _default: T;
};

export type Infer<T extends Schema> = DeepPrettify<T["_output"]>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type NonEmptyArray<T> = [T, ...T[]];

function isNonEmptyArray<T>(value: T[]): value is NonEmptyArray<T> {
  return value.length > 0;
}

function createSchema<T>(
  kind: string,
  defaultValue: T,
  parse: (value: unknown, ctx?: ParseContext) => T
): Schema<T> {
  const schema = parse as Schema<T>;
  schema._output = null as unknown as T;
  schema._kind = kind;
  schema._default = defaultValue;
  return schema;
}

export function string(): Schema<string> {
  return createSchema(
    "string",
    "",
    (value: unknown, ctx?: ParseContext): string => {
      const type = typeof value;
      if (type === "string") return value as string;

      if (value === undefined || value === null) {
        diag(ctx, "default", { schema: "string", value: "" });
        return "";
      }

      let result: string;
      if (isPlainObject(value) || Array.isArray(value)) {
        result = JSON.stringify(value);
      } else {
        result = String(value);
      }

      diag(ctx, "coercion", { from: type, to: "string" });
      return result;
    }
  );
}

export function number(): Schema<number> {
  return createSchema(
    "number",
    0,
    (value: unknown, ctx?: ParseContext): number => {
      if (value === undefined || value === null) {
        diag(ctx, "default", { schema: "number", value: 0 });
        return 0;
      }

      const type = typeof value;
      if (type === "number" && !Number.isNaN(value)) return value as number;

      if (type === "string" || type === "boolean") {
        const parsed = +value;
        if (!Number.isNaN(parsed)) {
          diag(ctx, "coercion", { from: type, to: "number" });
          return parsed;
        }
        diag(ctx, "default", { schema: "number", value: 0 });
        return 0;
      }

      diag(ctx, "coercion", { from: type, to: "number" });
      return 0;
    }
  );
}

export function boolean(): Schema<boolean> {
  return createSchema(
    "boolean",
    false,
    (value: unknown, ctx?: ParseContext): boolean => {
      if (value === undefined || value === null) {
        diag(ctx, "default", { schema: "boolean", value: false });
        return false;
      }
      const type = typeof value;
      if (type === "boolean") return value as boolean;

      let result: boolean;
      if (value === "false" || value === 0) result = false;
      else result = Boolean(value);

      diag(ctx, "coercion", { from: typeof value, to: "boolean" });
      return result;
    }
  );
}

type LiteralOutput<T> = T extends string
  ? T | (string & {})
  : T extends number
  ? T | (number & {})
  : T extends boolean
  ? T | (boolean & {})
  : T;

export function literal<T>(
  expected: T
): Schema<LiteralOutput<T>> & { _literal: T } {
  const defaultVal = expected as LiteralOutput<T>;

  // Helper to coerce value to expected type
  const coerceValue = (value: unknown): LiteralOutput<T> => {
    if (typeof expected === "string") {
      if (typeof value === "string") return value as LiteralOutput<T>;
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value) as LiteralOutput<T>;
      }
      return expected as LiteralOutput<T>;
    }

    if (typeof expected === "number") {
      if (typeof value === "number" && !Number.isNaN(value)) {
        return value as LiteralOutput<T>;
      }
      if (typeof value === "string") {
        const parsed = parseFloat(value);
        if (!Number.isNaN(parsed)) return parsed as LiteralOutput<T>;
      }
      if (typeof value === "boolean") {
        return (value ? 1 : 0) as LiteralOutput<T>;
      }
      return expected as LiteralOutput<T>;
    }

    if (typeof expected === "boolean") {
      if (typeof value === "boolean") return value as LiteralOutput<T>;
      if (value === "true" || value === 1) return true as LiteralOutput<T>;
      if (value === "false" || value === 0) return false as LiteralOutput<T>;
      if (typeof value === "string")
        return (value.length > 0) as LiteralOutput<T>;
      if (typeof value === "number") return (value !== 0) as LiteralOutput<T>;
      return expected as LiteralOutput<T>;
    }

    return expected as LiteralOutput<T>;
  };

  const parse = (value: unknown, ctx?: ParseContext): LiteralOutput<T> => {
    // Null/undefined -> literal default
    if (value === undefined || value === null) {
      diag(ctx, "literal_default", { expected, received: value });
      return expected as LiteralOutput<T>;
    }

    // Exact match -> no diagnostic
    if (value === expected) {
      return expected as LiteralOutput<T>;
    }

    // Same type, different value -> literal_mismatch
    if (typeof value === typeof expected) {
      if (typeof expected === "number" && Number.isNaN(value as number)) {
        diag(ctx, "literal_default", { expected, received: value });
        return expected as LiteralOutput<T>;
      }
      diag(ctx, "literal_mismatch", { expected, received: value });
      return value as LiteralOutput<T>;
    }

    // Different type -> try coercion
    const result = coerceValue(value);
    if (result === expected) {
      diag(ctx, "literal_default", { expected, received: value });
    } else {
      diag(ctx, "literal_coercion", { expected, received: value });
    }
    return result;
  };

  const schema = createSchema("literal", defaultVal, parse) as Schema<
    LiteralOutput<T>
  > & { _literal: T };

  schema._literal = expected;
  return schema;
}

type ObjectShape = Record<string, Schema>;
type InferObject<T extends ObjectShape> = {
  [K in keyof T as T[K] extends OptionalSchema ? never : K]: Infer<T[K]>;
} & {
  [K in keyof T as T[K] extends OptionalSchema ? K : never]?: Infer<T[K]>;
} & Record<string, unknown>;

interface OptionalSchema<T = unknown> extends Schema<T | undefined> {
  _optional: true;
}

interface NullableSchema<T = unknown> extends Schema<T | null> {
  _nullable: true;
}

export function object<T extends ObjectShape>(
  shape: T,
  name?: string
): Schema<InferObject<T>> & { _shape: T; _name?: string } {
  const defaultVal = {} as InferObject<T>;

  for (const key in shape) {
    const propSchema = shape[key]!;
    if (!("_optional" in propSchema)) {
      (defaultVal as Record<string, unknown>)[key] = propSchema._default;
    }
  }

  const parse = (value: unknown, ctx?: ParseContext): InferObject<T> => {
    const {
      __proto__: _,
      prototype: __,
      constructor: ___,
      ...input
    } = isPlainObject(value) ? value : {};

    for (const key in shape) {
      const propSchema = shape[key]!;

      // Check for field alias (_from)
      const fromKey =
        "_from" in propSchema && typeof propSchema._from === "string"
          ? propSchema._from
          : key;
      const propValue = input[fromKey];

      // Delete the alias key if different from schema key
      if (fromKey !== key && fromKey in input) {
        ctx?.path.push(key);
        diag(ctx, "field_alias", { from: fromKey });
        ctx?.path.pop();
        delete input[fromKey];
      }

      if ("_optional" in propSchema && propValue === undefined) {
        delete input[key];
      } else {
        ctx?.path.push(key);
        if (propValue === undefined && !("_optional" in propSchema)) {
          diag(ctx, "default", {
            schema: propSchema._kind,
            value: propSchema._default,
          });
        }
        input[key] = propSchema(propValue, ctx);
        ctx?.path.pop();
      }
    }

    return input as InferObject<T>;
  };

  const schema = createSchema("object", defaultVal, parse) as Schema<
    InferObject<T>
  > & { _shape: T; _name?: string };

  schema._shape = shape;
  schema._name = name;
  return schema;
}

export function array<T extends Schema>(element: T): Schema<Infer<T>[]> {
  return createSchema(
    "array",
    [] as Infer<T>[],
    (value: unknown, ctx?: ParseContext): Infer<T>[] => {
      if (!Array.isArray(value)) {
        if (value === undefined || value === null) {
          diag(ctx, "default", { schema: "array", value: [] });
          return [];
        }
        diag(ctx, "array_wrap", { valueType: typeof value });
        ctx?.path.push(0);
        const result = element(value, ctx) as Infer<T>;
        ctx?.path.pop();
        return [result];
      }
      return value.map((v, i) => {
        ctx?.path.push(i);
        const result = element(v, ctx) as Infer<T>;
        ctx?.path.pop();
        return result;
      });
    }
  );
}

export function optional<T extends Schema>(inner: T): OptionalSchema<Infer<T>> {
  const schema = createSchema(
    "optional",
    undefined,
    (value: unknown, ctx?: ParseContext): Infer<T> | undefined => {
      if (value === undefined) return undefined;
      return inner(value, ctx) as Infer<T>;
    }
  ) as OptionalSchema<Infer<T>>;

  schema._optional = true;
  (schema as unknown as { _inner: T })._inner = inner;
  return schema;
}

export function nullable<T extends Schema>(inner: T): NullableSchema<Infer<T>> {
  const schema = createSchema(
    "nullable",
    null,
    (value: unknown, ctx?: ParseContext): Infer<T> | null => {
      if (value === null || value === undefined) return null;
      return inner(value, ctx) as Infer<T>;
    }
  ) as NullableSchema<Infer<T>>;

  schema._nullable = true;
  (schema as unknown as { _inner: T })._inner = inner;
  return schema;
}

interface FieldSchema<T = unknown> extends Schema<T> {
  _from?: string;
}

type FieldReturn<T extends Schema> = FieldSchema<Infer<T>> &
  (T extends OptionalSchema ? { _optional: true } : {});

export function field<T extends Schema>(
  inner: T,
  options?: { from?: string }
): FieldReturn<T> {
  const schema = ((value: unknown, ctx?: ParseContext) =>
    inner(value, ctx)) as FieldReturn<T>;
  Object.assign(schema, inner);
  if (options?.from) {
    schema._from = options.from;
  }
  return schema;
}

interface CandidateScore {
  index: number;
  name?: string;
  score: number;
  typeMatch: boolean;
  exactMatch: boolean;
}

// Helper to get the input key for a schema (handles _from alias)
function getInputKey(propSchema: Schema, schemaKey: string): string {
  if (
    "_from" in propSchema &&
    typeof (propSchema as { _from?: string })._from === "string"
  ) {
    return (propSchema as { _from: string })._from;
  }
  return schemaKey;
}

function scoreNestedObject(
  rootSchema: Schema & { _shape: ObjectShape },
  rootValue: Record<string, unknown>
): { score: number; hasExactDiscriminator: boolean } {
  let totalScore = 0;
  let hasExactDiscriminator = false;
  let hasLiteralMismatch = false;

  const stack: Array<{
    schema: Schema & { _shape: ObjectShape };
    value: Record<string, unknown>;
    isRoot: boolean;
  }> = [{ schema: rootSchema, value: rootValue, isRoot: true }];

  while (stack.length > 0) {
    const { schema, value, isRoot } = stack.pop()!;
    const shape = schema._shape;

    for (const key in shape) {
      const propSchema = shape[key]!;
      const inputKey = getInputKey(propSchema, key);

      // Check for literal in propSchema or in inner schema (for field wrapper)
      const literalSchema =
        propSchema._kind === "literal"
          ? propSchema
          : "_literal" in propSchema
          ? propSchema
          : null;

      if (literalSchema && "_literal" in literalSchema) {
        const litSchema = literalSchema as Schema & {
          _literal: string | number | boolean;
        };
        const expected = litSchema._literal;
        if (inputKey in value) {
          if (value[inputKey] === expected) {
            totalScore += 50;
            if (isRoot) {
              hasExactDiscriminator = true;
            }
          } else if (typeof value[inputKey] === typeof expected) {
            totalScore += 5;
            if (isRoot) {
              hasLiteralMismatch = true;
            }
          } else {
            totalScore -= 50;
            if (isRoot) {
              hasLiteralMismatch = true;
            }
          }
        }
      }
    }

    for (const key in shape) {
      const propSchema = shape[key]!;
      if ("_optional" in propSchema) continue;

      const inputKey = getInputKey(propSchema, key);

      if (inputKey in value) {
        totalScore += 5;

        const propValue = value[inputKey];
        const innerKind = propSchema._kind;
        if (innerKind === "string" && typeof propValue === "string") {
          totalScore += 2;
        } else if (innerKind === "number" && typeof propValue === "number") {
          totalScore += 2;
        } else if (innerKind === "boolean" && typeof propValue === "boolean") {
          totalScore += 2;
        } else if (innerKind === "object" && isPlainObject(propValue)) {
          totalScore += 2;
          const nestedObjSchema = propSchema as Schema & {
            _shape: ObjectShape;
          };
          if (nestedObjSchema._shape) {
            stack.push({
              schema: nestedObjSchema,
              value: propValue,
              isRoot: false,
            });
          }
        } else if (innerKind === "array" && Array.isArray(propValue)) {
          totalScore += 2;
        }
      } else {
        totalScore -= 10;
      }
    }

    for (const key in value) {
      if (key in shape) {
        totalScore += 1;
      }
    }
  }

  return {
    score: totalScore,
    hasExactDiscriminator: hasExactDiscriminator && !hasLiteralMismatch,
  };
}

function scoreCandidate(
  schema: Schema,
  value: unknown,
  index: number,
  keyCounts?: Record<string, number>
): CandidateScore {
  const candidate: CandidateScore = {
    index,
    score: 0,
    typeMatch: false,
    exactMatch: false,
  };

  if (schema._kind === "string" && typeof value === "string") {
    candidate.score += 100;
    candidate.typeMatch = true;
  } else if (
    schema._kind === "number" &&
    typeof value === "number" &&
    !Number.isNaN(value)
  ) {
    candidate.score += 100;
    candidate.typeMatch = true;
  } else if (schema._kind === "boolean" && typeof value === "boolean") {
    candidate.score += 100;
    candidate.typeMatch = true;
  } else if (schema._kind === "literal") {
    const litSchema = schema as Schema & {
      _literal: string | number | boolean;
    };
    if (value === litSchema._literal) {
      candidate.score += 200;
      candidate.typeMatch = true;
      candidate.exactMatch = true;
    } else if (typeof value === typeof litSchema._literal) {
      candidate.score += 100;
      candidate.typeMatch = true;
    }
  } else if (schema._kind === "nullable") {
    if (value === null) {
      candidate.score += 150;
      candidate.typeMatch = true;
    }
  } else if (schema._kind === "array" && Array.isArray(value)) {
    candidate.score += 80;
    candidate.typeMatch = true;
  } else if (schema._kind === "object" && isPlainObject(value)) {
    candidate.typeMatch = true;
    const objSchema = schema as Schema & {
      _shape: ObjectShape;
      _name?: string;
    };
    candidate.name = objSchema._name;

    const nested = scoreNestedObject(objSchema, value);
    candidate.score += nested.score;
    candidate.exactMatch = nested.hasExactDiscriminator;

    if (keyCounts) {
      const shape = objSchema._shape;
      for (const key in value) {
        if (!(key in shape)) continue;
        if (keyCounts[key] === 1) {
          candidate.score += 10;
        }
      }
    }
  }

  if (!candidate.typeMatch) {
    if (schema._kind === "string") {
      candidate.score += 1;
    } else if (schema._kind === "number" && typeof value === "string") {
      const parsed = parseFloat(value);
      if (!Number.isNaN(parsed)) {
        candidate.score += 5;
      }
    } else if (schema._kind === "boolean") {
      if (value === "true" || value === "false" || value === 0 || value === 1) {
        candidate.score += 5;
      }
    }
  }

  return candidate;
}

function computeKeyCounts(schemas: Schema[]): Record<string, number> {
  const keyCounts: Record<string, number> = Object.create(null);
  for (let i = 0; i < schemas.length; i++) {
    const s = schemas[i]!;
    if (s._kind === "object") {
      const shape = (s as Schema & { _shape: ObjectShape })._shape;
      for (const key in shape) {
        keyCounts[key] = (keyCounts[key] ?? 0) + 1;
      }
    }
  }
  return keyCounts;
}

function pickUnion(
  schemas: NonEmptyArray<Schema>,
  value: unknown,
  collectCandidates: boolean = false
): { best: CandidateScore | undefined; candidates: CandidateScore[] } {
  const keyCounts = computeKeyCounts(schemas);

  let best: CandidateScore | undefined;
  const candidates: CandidateScore[] = [];

  for (let i = 0; i < schemas.length; i++) {
    const c = scoreCandidate(schemas[i]!, value, i, keyCounts);
    if (collectCandidates) {
      candidates.push(c);
    }
    const shouldReplace =
      !best ||
      (c.exactMatch && !best.exactMatch) ||
      (!best.exactMatch && c.score > best.score);
    if (shouldReplace) {
      best = c;
    }
    if (c.exactMatch && !collectCandidates) {
      break;
    }
  }

  if (collectCandidates && candidates.length > 1) {
    candidates.sort((a, b) => b.score - a.score);
  }

  return { best, candidates };
}

export function union<T extends Schema[]>(
  ...schemas: T
): Schema<Infer<T[number]>> & { _schemas: T } {
  if (!isNonEmptyArray(schemas)) {
    const schema = createSchema("union", undefined as Infer<T[number]>, () => {
      return undefined as Infer<T[number]>;
    }) as Schema<Infer<T[number]>> & { _schemas: T };
    schema._schemas = schemas;
    return schema;
  }

  const defaultVal = schemas[0]!._default as Infer<T[number]>;

  const parse = (value: unknown, ctx?: ParseContext): Infer<T[number]> => {
    const { best } = pickUnion(schemas, value, false);
    const chosenIndex = best?.index ?? 0;
    const chosenSchema = schemas[chosenIndex]!;

    // Determine selection reason
    let reason: "exact match" | "type match" | "best score";
    if (best?.exactMatch) {
      reason = "exact match";
    } else if (best?.typeMatch) {
      reason = "type match";
    } else {
      reason = "best score";
    }

    diag(ctx, "union_selection", {
      chosenIndex,
      chosenName: best?.name,
      reason,
    });

    return chosenSchema(value, ctx) as Infer<T[number]>;
  };

  const schema = createSchema("union", defaultVal, parse) as Schema<
    Infer<T[number]>
  > & { _schemas: T };

  schema._schemas = schemas;
  return schema;
}

export function parse<T extends Schema>(schema: T, value: unknown): Infer<T> {
  return schema(value) as Infer<T>;
}

export function parseWithDiagnostics<T extends Schema>(
  schema: T,
  value: unknown
): ParseResult<Infer<T>> {
  const ctx: ParseContext = {
    diagnostics: [],
    path: [],
  };

  const result = schema(value, ctx) as Infer<T>;

  return {
    value: result,
    diagnostics: ctx.diagnostics,
  };
}
