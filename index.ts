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

// Internal result returned by all schema parse functions
interface InternalResult<T> {
  value: T;
  score: number;
  exactMatch: boolean;
  typeMatch: boolean;
  diagnostics: Diagnostic[];
}

// Scoring constants
const SCORE = {
  EXACT_TYPE: 100,
  LITERAL_EXACT: 200,
  LITERAL_TYPE: 100,
  NULL_MATCH: 150,
  ARRAY_MATCH: 80,
  COERCIBLE_STRING: 1,
  COERCIBLE_NUMBER: 5,
  COERCIBLE_BOOLEAN: 5,
  FIELD_PRESENT: 5,
  FIELD_TYPE_MATCH: 2,
  FIELD_MISSING: -10,
  FIELD_COVERAGE: 1,
  DISCRIMINATOR_EXACT: 50,
  DISCRIMINATOR_TYPE: 5,
  DISCRIMINATOR_MISMATCH: -50,
  UNIQUE_FIELD: 10,
} as const;

function formatPath(segments: (string | number)[]): string {
  if (segments.length === 0) return "";
  return segments.reduce<string>((acc, segment, i) => {
    if (typeof segment === "number") {
      return `${acc}[${segment}]`;
    }
    return i === 0 ? segment : `${acc}.${segment}`;
  }, "");
}

// Prepend path segment to all diagnostics
function prependPath(
  diagnostics: Diagnostic[],
  segment: string | number
): Diagnostic[] {
  return diagnostics.map((d) => ({
    ...d,
    path: d.path ? `${formatPath([segment])}.${d.path}` : formatPath([segment]),
  }));
}

function makeDiag<K extends DiagnosticKind>(
  kind: K,
  path: string,
  details?: DiagnosticDetailsByKind[K]
): Diagnostic<K> {
  return { kind, path, details } as Diagnostic<K>;
}

export type Schema<T = unknown> = {
  (value: unknown): InternalResult<T>;
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
  parse: (value: unknown) => InternalResult<T>
): Schema<T> {
  const schema = parse as Schema<T>;
  schema._output = null as unknown as T;
  schema._kind = kind;
  schema._default = defaultValue;
  return schema;
}

export function string(): Schema<string> {
  const parse = (value: unknown): InternalResult<string> => {
    const defaultVal = (parse as Schema<string>)._default;
    const type = typeof value;

    if (type === "string") {
      return {
        value: value as string,
        score: SCORE.EXACT_TYPE,
        exactMatch: false, // Type match, not exact discriminator match
        typeMatch: true,
        diagnostics: [],
      };
    }

    if (value === undefined || value === null) {
      return {
        value: defaultVal,
        score: SCORE.COERCIBLE_STRING,
        exactMatch: false,
        typeMatch: false,
        diagnostics: [
          makeDiag("default", "", { schema: "string", value: defaultVal }),
        ],
      };
    }

    let result: string;
    if (isPlainObject(value) || Array.isArray(value)) {
      result = JSON.stringify(value);
    } else {
      result = String(value);
    }

    return {
      value: result,
      score: SCORE.COERCIBLE_STRING,
      exactMatch: false,
      typeMatch: false,
      diagnostics: [makeDiag("coercion", "", { from: type, to: "string" })],
    };
  };
  return createSchema("string", "", parse);
}

export function number(): Schema<number> {
  const parse = (value: unknown): InternalResult<number> => {
    const defaultVal = (parse as Schema<number>)._default;

    if (value === undefined || value === null) {
      return {
        value: defaultVal,
        score: 0,
        exactMatch: false,
        typeMatch: false,
        diagnostics: [
          makeDiag("default", "", { schema: "number", value: defaultVal }),
        ],
      };
    }

    const type = typeof value;
    if (type === "number" && !Number.isNaN(value)) {
      return {
        value: value as number,
        score: SCORE.EXACT_TYPE,
        exactMatch: false, // Type match, not exact discriminator match
        typeMatch: true,
        diagnostics: [],
      };
    }

    if (type === "string") {
      const parsed = +value;
      if (!Number.isNaN(parsed)) {
        return {
          value: parsed,
          score: SCORE.COERCIBLE_NUMBER,
          exactMatch: false,
          typeMatch: false,
          diagnostics: [makeDiag("coercion", "", { from: type, to: "number" })],
        };
      }
      return {
        value: defaultVal,
        score: 0,
        exactMatch: false,
        typeMatch: false,
        diagnostics: [
          makeDiag("default", "", { schema: "number", value: defaultVal }),
        ],
      };
    }

    if (type === "boolean") {
      const parsed = +value;
      return {
        value: parsed,
        score: 0, // No bonus for boolean coercion - string should win
        exactMatch: false,
        typeMatch: false,
        diagnostics: [makeDiag("coercion", "", { from: type, to: "number" })],
      };
    }

    return {
      value: defaultVal,
      score: 0,
      exactMatch: false,
      typeMatch: false,
      diagnostics: [makeDiag("coercion", "", { from: type, to: "number" })],
    };
  };
  return createSchema("number", 0, parse);
}

export function boolean(): Schema<boolean> {
  const parse = (value: unknown): InternalResult<boolean> => {
    const defaultVal = (parse as Schema<boolean>)._default;

    if (value === undefined || value === null) {
      return {
        value: defaultVal,
        score: 0,
        exactMatch: false,
        typeMatch: false,
        diagnostics: [
          makeDiag("default", "", { schema: "boolean", value: defaultVal }),
        ],
      };
    }

    const type = typeof value;
    if (type === "boolean") {
      return {
        value: value as boolean,
        score: SCORE.EXACT_TYPE,
        exactMatch: false, // Type match, not exact discriminator match
        typeMatch: true,
        diagnostics: [],
      };
    }

    let result: boolean;
    if (value === "false" || value === 0) result = false;
    else result = Boolean(value);

    // Higher score for boolean-like values
    let score = SCORE.COERCIBLE_BOOLEAN;
    if (value === "true" || value === "false" || value === 0 || value === 1) {
      score = SCORE.COERCIBLE_BOOLEAN;
    }

    return {
      value: result,
      score,
      exactMatch: false,
      typeMatch: false,
      diagnostics: [makeDiag("coercion", "", { from: type, to: "boolean" })],
    };
  };
  return createSchema("boolean", false, parse);
}

type Primitive = string | number | boolean;

type LiteralOutput<T extends Primitive> = T extends string
  ? T | (string & {})
  : T extends number
  ? T | (number & {})
  : T | (boolean & {});

export function literal<T extends Primitive>(
  expected: T
): Schema<LiteralOutput<T>> & { _literal: T } {
  const type = typeof expected;
  let baseSchema: Schema<LiteralOutput<T>>;

  if (type === "string") {
    baseSchema = string() as Schema<LiteralOutput<T>>;
  } else if (type === "number") {
    baseSchema = number() as Schema<LiteralOutput<T>>;
  } else if (type === "boolean") {
    baseSchema = boolean() as Schema<LiteralOutput<T>>;
  } else {
    throw "unexpected";
  }

  const parse = (value: unknown): InternalResult<LiteralOutput<T>> => {
    // For undefined/null, return the literal's expected value as default
    if (value === undefined || value === null) {
      return {
        value: expected as LiteralOutput<T>,
        score: 0,
        exactMatch: false,
        typeMatch: false,
        diagnostics: [
          makeDiag("default", "", { schema: "literal", value: expected }),
        ],
      };
    }

    // Exact literal match
    if (value === expected) {
      return {
        value: expected as LiteralOutput<T>,
        score: SCORE.LITERAL_EXACT,
        exactMatch: true,
        typeMatch: true,
        diagnostics: [],
      };
    }

    // Type matches but value doesn't (open enum behavior)
    if (typeof value === typeof expected) {
      return {
        value: value as LiteralOutput<T>,
        score: SCORE.LITERAL_TYPE,
        exactMatch: false,
        typeMatch: true,
        diagnostics: [],
      };
    }

    // Need coercion - parse through base schema
    const baseResult = baseSchema(value);

    // If base schema returns default (coercion failed), use literal's expected value instead
    if (baseResult.diagnostics.some((d) => d.kind === "default")) {
      return {
        value: expected as LiteralOutput<T>,
        score: 0,
        exactMatch: false,
        typeMatch: false,
        diagnostics: [
          makeDiag("default", "", { schema: "literal", value: expected }),
        ],
      };
    }

    return baseResult;
  };

  const schema = createSchema(
    "literal",
    expected as LiteralOutput<T>,
    parse
  ) as Schema<LiteralOutput<T>> & { _literal: T };
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

  const parse = (value: unknown): InternalResult<InferObject<T>> => {
    const {
      __proto__: _,
      prototype: __,
      constructor: ___,
      ...input
    } = isPlainObject(value) ? value : {};

    let totalScore = 0;
    let hasTypeMatch = isPlainObject(value);
    let hasExactDiscriminator = false; // Track if ANY field has exact discriminator match
    const diagnostics: Diagnostic[] = [];

    // Process each field in the shape
    for (const key in shape) {
      const propSchema = shape[key]!;

      // Check for field alias (_from)
      const fromKey = getInputKey(propSchema, key);
      const propValue = input[fromKey];

      // Delete the alias key if different from schema key
      if (fromKey !== key && fromKey in input) {
        diagnostics.push(makeDiag("field_alias", key, { from: fromKey }));
        delete input[fromKey];
      }

      if ("_optional" in propSchema && propValue === undefined) {
        delete input[key];
        // Optional field missing doesn't affect score negatively
      } else {
        // Check if field is present in input
        const fieldPresent = fromKey in (isPlainObject(value) ? value : {});

        if (fieldPresent) {
          totalScore += SCORE.FIELD_PRESENT;
        } else if (!("_optional" in propSchema)) {
          totalScore += SCORE.FIELD_MISSING;
          diagnostics.push(
            makeDiag("default", key, {
              schema: propSchema._kind,
              value: propSchema._default,
            })
          );
        }

        // Parse the field
        const fieldResult = propSchema(propValue);
        input[key] = fieldResult.value;

        // Add field type match bonus
        if (fieldResult.typeMatch && fieldPresent) {
          totalScore += SCORE.FIELD_TYPE_MATCH;
        }

        // Only accumulate nested scores when field was present in input
        // (don't penalize deeply for defaulted nested structures)
        if (
          fieldPresent &&
          (propSchema._kind === "object" || propSchema._kind === "array")
        ) {
          totalScore += fieldResult.score;
        }

        // Check for literal discriminators
        if ("_literal" in propSchema) {
          const literalSchema = propSchema as Schema & { _literal: Primitive };
          if (propValue === literalSchema._literal) {
            totalScore += SCORE.DISCRIMINATOR_EXACT;
            hasExactDiscriminator = true; // Found exact discriminator match
          } else if (typeof propValue === typeof literalSchema._literal) {
            totalScore += SCORE.DISCRIMINATOR_TYPE;
          } else if (fieldPresent) {
            totalScore += SCORE.DISCRIMINATOR_MISMATCH;
          }
        }

        // Prepend path to nested diagnostics
        diagnostics.push(...prependPath(fieldResult.diagnostics, key));
      }
    }

    // Field coverage bonus
    for (const key in input) {
      if (key in shape) {
        totalScore += SCORE.FIELD_COVERAGE;
      }
    }

    return {
      value: input as InferObject<T>,
      score: totalScore,
      exactMatch: hasExactDiscriminator && hasTypeMatch, // Exact match only with discriminator
      typeMatch: hasTypeMatch,
      diagnostics,
    };
  };

  const schema = createSchema("object", defaultVal, parse) as Schema<
    InferObject<T>
  > & { _shape: T; _name?: string };

  schema._shape = shape;
  schema._name = name;
  return schema;
}

export function array<T extends Schema>(element: T): Schema<Infer<T>[]> {
  const parse = (value: unknown): InternalResult<Infer<T>[]> => {
    if (!Array.isArray(value)) {
      if (value === undefined || value === null) {
        return {
          value: [],
          score: 0,
          exactMatch: false,
          typeMatch: false,
          diagnostics: [
            makeDiag("default", "", { schema: "array", value: [] }),
          ],
        };
      }

      // Wrap single value in array
      const elemResult = element(value);
      return {
        value: [elemResult.value as Infer<T>],
        score: elemResult.score,
        exactMatch: false,
        typeMatch: false,
        diagnostics: [
          makeDiag("array_wrap", "", { valueType: typeof value }),
          ...prependPath(elemResult.diagnostics, 0),
        ],
      };
    }

    let totalScore = SCORE.ARRAY_MATCH;
    let allExact = true;
    const diagnostics: Diagnostic[] = [];

    const result = value.map((v, i) => {
      const elemResult = element(v);
      totalScore += elemResult.score;
      if (!elemResult.exactMatch) allExact = false;
      diagnostics.push(...prependPath(elemResult.diagnostics, i));
      return elemResult.value as Infer<T>;
    });

    return {
      value: result,
      score: totalScore,
      exactMatch: allExact,
      typeMatch: true,
      diagnostics,
    };
  };

  return createSchema("array", [] as Infer<T>[], parse);
}

export function optional<T extends Schema>(inner: T): OptionalSchema<Infer<T>> {
  const parse = (value: unknown): InternalResult<Infer<T> | undefined> => {
    if (value === undefined) {
      return {
        value: undefined,
        score: SCORE.EXACT_TYPE,
        exactMatch: false, // Not a discriminator match
        typeMatch: true,
        diagnostics: [],
      };
    }
    const innerResult = inner(value);
    return {
      value: innerResult.value as Infer<T>,
      score: innerResult.score,
      exactMatch: innerResult.exactMatch,
      typeMatch: innerResult.typeMatch,
      diagnostics: innerResult.diagnostics,
    };
  };

  const schema = createSchema("optional", undefined, parse) as OptionalSchema<
    Infer<T>
  >;
  schema._optional = true;
  (schema as unknown as { _inner: T })._inner = inner;
  return schema;
}

export function nullable<T extends Schema>(inner: T): NullableSchema<Infer<T>> {
  const parse = (value: unknown): InternalResult<Infer<T> | null> => {
    if (value === null || value === undefined) {
      return {
        value: null,
        score: SCORE.NULL_MATCH,
        exactMatch: value === null,
        typeMatch: true,
        diagnostics: [],
      };
    }
    const innerResult = inner(value);
    return {
      value: innerResult.value as Infer<T>,
      score: innerResult.score,
      exactMatch: innerResult.exactMatch,
      typeMatch: innerResult.typeMatch,
      diagnostics: innerResult.diagnostics,
    };
  };

  const schema = createSchema("nullable", null, parse) as NullableSchema<
    Infer<T>
  >;
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
  const parse = (value: unknown): InternalResult<Infer<T>> => {
    return inner(value) as InternalResult<Infer<T>>;
  };

  const schema = createSchema(
    inner._kind,
    inner._default,
    parse
  ) as FieldReturn<T>;

  // Copy over properties from inner schema
  if ("_optional" in inner) {
    (schema as { _optional?: true })._optional = true;
  }
  if ("_literal" in inner) {
    (schema as { _literal?: Primitive })._literal = (
      inner as { _literal: Primitive }
    )._literal;
  }

  if (options?.from) {
    schema._from = options.from;
  }

  return schema;
}

// Compute unique field counts for union discrimination
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

export function union<T extends NonEmptyArray<Schema>>(
  ...schemas: T
): Schema<Infer<T[number]>> & { _schemas: T } {
  if (!isNonEmptyArray(schemas)) {
    const schema = createSchema("union", undefined as Infer<T[number]>, () => {
      return {
        value: undefined as Infer<T[number]>,
        score: 0,
        exactMatch: false,
        typeMatch: false,
        diagnostics: [],
      };
    }) as Schema<Infer<T[number]>> & { _schemas: T };
    schema._schemas = schemas;
    return schema;
  }

  const keyCounts = computeKeyCounts(schemas);
  const defaultVal = schemas[0]!._default as Infer<T[number]>;

  const parse = (value: unknown): InternalResult<Infer<T[number]>> => {
    let bestResult: InternalResult<Infer<T[number]>> | undefined;
    let bestIndex = 0;
    let bestName: string | undefined;

    for (let i = 0; i < schemas.length; i++) {
      const schema = schemas[i]!;
      const result = schema(value) as InternalResult<Infer<T[number]>>;

      // Add unique field bonus for objects
      if (schema._kind === "object" && isPlainObject(value)) {
        const objSchema = schema as Schema & {
          _shape: ObjectShape;
          _name?: string;
        };
        for (const key in value) {
          if (key in objSchema._shape && keyCounts[key] === 1) {
            result.score += SCORE.UNIQUE_FIELD;
          }
        }
      }

      const shouldReplace =
        !bestResult ||
        (result.exactMatch && !bestResult.exactMatch) ||
        (!bestResult.exactMatch && result.score > bestResult.score);

      if (shouldReplace) {
        bestResult = result;
        bestIndex = i;
        if (schema._kind === "object") {
          bestName = (schema as Schema & { _name?: string })._name;
        }
      }

      // Early exit on exact match
      if (result.exactMatch) {
        break;
      }
    }

    if (!bestResult) {
      bestResult = schemas[0]!(value) as InternalResult<Infer<T[number]>>;
    }

    // Determine selection reason
    let reason: "exact match" | "type match" | "best score";
    if (bestResult.exactMatch) {
      reason = "exact match";
    } else if (bestResult.typeMatch) {
      reason = "type match";
    } else {
      reason = "best score";
    }

    // Add union selection diagnostic
    const unionDiag = makeDiag("union_selection", "", {
      chosenIndex: bestIndex,
      chosenName: bestName,
      reason,
    });

    return {
      value: bestResult.value,
      score: bestResult.score,
      exactMatch: bestResult.exactMatch,
      typeMatch: bestResult.typeMatch,
      diagnostics: [unionDiag, ...bestResult.diagnostics],
    };
  };

  const schema = createSchema("union", defaultVal, parse) as Schema<
    Infer<T[number]>
  > & { _schemas: T };

  schema._schemas = schemas;
  return schema;
}

export function parse<T extends Schema>(schema: T, value: unknown): Infer<T> {
  return schema(value).value as Infer<T>;
}

export function parseWithDiagnostics<T extends Schema>(
  schema: T,
  value: unknown
): ParseResult<Infer<T>> {
  const result = schema(value);
  return {
    value: result.value as Infer<T>,
    diagnostics: result.diagnostics,
  };
}
