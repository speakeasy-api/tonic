type Prettify<T> = T extends infer U ? { [K in keyof U]: U[K] } & {} : never;

type DeepPrettify<T> = T extends (infer U)[]
  ? DeepPrettify<U>[]
  : T extends object
  ? Prettify<{ [K in keyof T]: DeepPrettify<T[K]> }>
  : T;

export type Schema<T = unknown> = {
  (value: unknown): T;
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
  parse: (value: unknown) => T
): Schema<T> {
  const schema = parse as Schema<T>;
  schema._output = null as unknown as T;
  schema._kind = kind;
  schema._default = defaultValue;
  return schema;
}

export function string(): Schema<string> {
  return createSchema("string", "", (value) => {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (isPlainObject(value) || Array.isArray(value)) {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

export function number(): Schema<number> {
  return createSchema("number", 0, (value) => {
    if (typeof value === "number" && !Number.isNaN(value)) return value;
    if (value === undefined || value === null) return 0;
    if (typeof value === "string") {
      const parsed = parseFloat(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (typeof value === "boolean") return value ? 1 : 0;
    return 0;
  });
}

export function boolean(): Schema<boolean> {
  return createSchema("boolean", false, (value) => {
    if (typeof value === "boolean") return value;
    if (value === undefined || value === null) return false;
    if (value === "true" || value === 1) return true;
    if (value === "false" || value === 0) return false;
    if (typeof value === "string") return value.length > 0;
    if (typeof value === "number") return value !== 0;
    return Boolean(value);
  });
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
  const schema = createSchema(
    "literal",
    defaultVal,
    (value): LiteralOutput<T> => {
      if (value === undefined || value === null) {
        return expected as LiteralOutput<T>;
      }

      if (value === expected) {
        return expected as LiteralOutput<T>;
      }

      if (typeof expected === "string") {
        if (typeof value === "string") {
          return value as LiteralOutput<T>;
        }
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
          if (!Number.isNaN(parsed)) {
            return parsed as LiteralOutput<T>;
          }
        }
        if (typeof value === "boolean") {
          return (value ? 1 : 0) as LiteralOutput<T>;
        }
        return expected as LiteralOutput<T>;
      }

      if (typeof expected === "boolean") {
        if (typeof value === "boolean") {
          return value as LiteralOutput<T>;
        }
        if (value === "true" || value === 1) {
          return true as LiteralOutput<T>;
        }
        if (value === "false" || value === 0) {
          return false as LiteralOutput<T>;
        }
        if (typeof value === "string") {
          return (value.length > 0) as LiteralOutput<T>;
        }
        if (typeof value === "number") {
          return (value !== 0) as LiteralOutput<T>;
        }
        return expected as LiteralOutput<T>;
      }

      return expected as LiteralOutput<T>;
    }
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

  const schema = createSchema("object", defaultVal, (value) => {
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
        delete input[fromKey];
      }

      if ("_optional" in propSchema && propValue === undefined) {
        delete input[key];
      } else {
        input[key] = propSchema(propValue);
      }
    }

    return input as InferObject<T>;
  }) as Schema<InferObject<T>> & { _shape: T; _name?: string };

  schema._shape = shape;
  schema._name = name;
  return schema;
}

export function array<T extends Schema>(element: T): Schema<Infer<T>[]> {
  return createSchema("array", [] as Infer<T>[], (value): Infer<T>[] => {
    if (!Array.isArray(value)) {
      if (value === undefined || value === null) return [];
      return [element(value) as Infer<T>];
    }
    return value.map((v) => element(v) as Infer<T>);
  });
}

export function optional<T extends Schema>(inner: T): OptionalSchema<Infer<T>> {
  const schema = createSchema("optional", undefined, (value) => {
    if (value === undefined) return undefined;
    return inner(value);
  }) as OptionalSchema<Infer<T>>;

  schema._optional = true;
  (schema as unknown as { _inner: T })._inner = inner;
  return schema;
}

export function nullable<T extends Schema>(inner: T): NullableSchema<Infer<T>> {
  const schema = createSchema("nullable", null, (value) => {
    if (value === null || value === undefined) return null;
    return inner(value);
  }) as NullableSchema<Infer<T>>;

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
  const schema = ((value: unknown) => inner(value)) as FieldReturn<T>;
  Object.assign(schema, inner);
  if (options?.from) {
    schema._from = options.from;
  }
  return schema;
}

interface ParseMeta {
  chosenIndex: number;
  chosenName?: string;
  candidates: CandidateScore[];
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

  const schema = createSchema("union", defaultVal, (value) => {
    const { best } = pickUnion(schemas, value, false);
    const chosenIndex = best?.index ?? 0;
    return schemas[chosenIndex]!(value);
  }) as Schema<Infer<T[number]>> & { _schemas: T };

  schema._schemas = schemas;
  return schema;
}

export function parse<T extends Schema>(schema: T, value: unknown): Infer<T> {
  return schema(value) as Infer<T>;
}

export function parseWithMeta<T extends Schema>(
  schema: T,
  value: unknown
): { value: Infer<T>; meta: ParseMeta } {
  if (schema._kind === "union") {
    const unionSchema = schema as unknown as Schema & { _schemas: Schema[] };
    const schemas = unionSchema._schemas;

    if (!isNonEmptyArray(schemas)) {
      return {
        value: undefined as Infer<T>,
        meta: {
          chosenIndex: 0,
          candidates: [],
        },
      };
    }

    const { best, candidates } = pickUnion(schemas, value, true);

    const chosenIndex = best?.index ?? 0;
    const result = schemas[chosenIndex]!(value);

    return {
      value: result as Infer<T>,
      meta: {
        chosenIndex,
        chosenName: best?.name,
        candidates,
      },
    };
  }

  return {
    value: schema(value) as Infer<T>,
    meta: {
      chosenIndex: 0,
      candidates: [],
    },
  };
}
