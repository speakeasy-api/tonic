// ============================================================================
// TYPES
// ============================================================================

/** Forces TypeScript to expand intersections into readable flat types */
type Prettify<T> = T extends infer U ? { [K in keyof U]: U[K] } & {} : never;

/** Recursively prettify nested object types */
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

// ============================================================================
// HELPERS
// ============================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createSchema<T>(
  kind: string,
  defaultValue: T,
  parse: (value: unknown) => T
): Schema<T> {
  const schema = parse as Schema<T>;
  schema._output = undefined as T;
  schema._kind = kind;
  schema._default = defaultValue;
  return schema;
}

// ============================================================================
// PRIMITIVE SCHEMAS
// ============================================================================

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

type LiteralOutput<T extends string | number | boolean> = T extends string
  ? T | string
  : T extends number
  ? T | number
  : T | boolean;

export function literal<T extends string | number | boolean>(
  expected: T
): Schema<LiteralOutput<T>> & { _literal: T } {
  const defaultVal = expected as LiteralOutput<T>;
  const schema = createSchema(
    "literal",
    defaultVal,
    (value): LiteralOutput<T> => {
      // Nullish -> use literal as default
      if (value === undefined || value === null) {
        return expected as LiteralOutput<T>;
      }

      // Exact match
      if (value === expected) {
        return expected as LiteralOutput<T>;
      }

      // Coerce to same base type
      if (typeof expected === "string") {
        // Accept any string, or coerce to string
        if (typeof value === "string") {
          return value as LiteralOutput<T>;
        }
        if (typeof value === "number" || typeof value === "boolean") {
          return String(value) as LiteralOutput<T>;
        }
        return expected as LiteralOutput<T>;
      }

      if (typeof expected === "number") {
        // Accept any number, or coerce to number
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
        // Accept any boolean, or coerce to boolean
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

// ============================================================================
// COMPOSITE SCHEMAS
// ============================================================================

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

  // Build default object
  for (const [key, propSchema] of Object.entries(shape)) {
    if (!("_optional" in propSchema)) {
      (defaultVal as Record<string, unknown>)[key] = propSchema._default;
    }
  }

  const schema = createSchema("object", defaultVal, (value) => {
    const input = isPlainObject(value) ? value : {};
    const result: Record<string, unknown> = { ...input };

    for (const [key, propSchema] of Object.entries(shape)) {
      const propValue = input[key];

      if ("_optional" in propSchema && propValue === undefined) {
        // Skip optional undefined
        delete result[key];
      } else {
        result[key] = propSchema(propValue);
      }
    }

    return result as InferObject<T>;
  }) as Schema<InferObject<T>> & { _shape: T; _name?: string };

  schema._shape = shape;
  schema._name = name;
  return schema;
}

export function array<T extends Schema>(element: T): Schema<Infer<T>[]> {
  return createSchema("array", [] as Infer<T>[], (value): Infer<T>[] => {
    if (!Array.isArray(value)) {
      if (value === undefined || value === null) return [];
      // Wrap single value in array
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

  (schema as unknown as { _optional: true })._optional = true;
  (schema as unknown as { _inner: T })._inner = inner;
  return schema;
}

export function nullable<T extends Schema>(inner: T): NullableSchema<Infer<T>> {
  const schema = createSchema("nullable", null, (value) => {
    if (value === null || value === undefined) return null;
    return inner(value);
  }) as NullableSchema<Infer<T>>;

  (schema as unknown as { _nullable: true })._nullable = true;
  (schema as unknown as { _inner: T })._inner = inner;
  return schema;
}

// ============================================================================
// UNION SCHEMAS
// ============================================================================

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
}

function scoreCandidate(
  schema: Schema,
  value: unknown,
  index: number,
  allSchemas: Schema[]
): CandidateScore {
  const candidate: CandidateScore = {
    index,
    score: 0,
    typeMatch: false,
  };

  // Type-level matching (highest priority)
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
      candidate.score += 200; // Exact literal match is highest
      candidate.typeMatch = true;
    } else if (typeof value === typeof litSchema._literal) {
      // Same base type - still a good match
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

    // Score based on property matching
    const shape = objSchema._shape;
    const inputKeys = new Set(Object.keys(value));

    // Check for literal/discriminator matches (very high priority)
    for (const [key, propSchema] of Object.entries(shape)) {
      if (propSchema._kind === "literal") {
        const litSchema = propSchema as Schema & {
          _literal: string | number | boolean;
        };
        const expected = litSchema._literal;
        if (key in value) {
          if (value[key] === expected) {
            candidate.score += 50; // Exact discriminator match
          } else if (typeof value[key] === typeof expected) {
            // Same type but different value - small bonus (literal accepts any of same type)
            candidate.score += 5;
          } else {
            // Different type - penalty
            candidate.score -= 50;
          }
        }
      }
    }

    // Score required properties present with correct types
    for (const [key, propSchema] of Object.entries(shape)) {
      if ("_optional" in propSchema) continue;

      if (key in value) {
        candidate.score += 5; // Required property present

        // Bonus for type match
        const propValue = value[key];
        const innerKind = propSchema._kind;
        if (innerKind === "string" && typeof propValue === "string") {
          candidate.score += 2;
        } else if (innerKind === "number" && typeof propValue === "number") {
          candidate.score += 2;
        } else if (innerKind === "boolean" && typeof propValue === "boolean") {
          candidate.score += 2;
        } else if (innerKind === "object" && isPlainObject(propValue)) {
          candidate.score += 2;
        } else if (innerKind === "array" && Array.isArray(propValue)) {
          candidate.score += 2;
        }
      } else {
        candidate.score -= 10; // Missing required property
      }
    }

    // Unique property bonus
    const allObjectSchemas = allSchemas.filter(
      (s) => s._kind === "object"
    ) as (Schema & { _shape: ObjectShape })[];
    for (const key of inputKeys) {
      if (!(key in shape)) continue;
      const keyInOtherSchemas = allObjectSchemas.filter(
        (s) => s !== schema && key in s._shape
      ).length;
      if (keyInOtherSchemas === 0) {
        candidate.score += 10; // Unique property
      }
    }
  }

  // Coercibility scoring (lower priority than type match)
  if (!candidate.typeMatch) {
    if (schema._kind === "string") {
      // Everything can become a string
      candidate.score += 1;
    } else if (schema._kind === "number" && typeof value === "string") {
      const parsed = parseFloat(value);
      if (!Number.isNaN(parsed)) {
        candidate.score += 5; // Valid number coercion
      }
    } else if (schema._kind === "boolean") {
      if (value === "true" || value === "false" || value === 0 || value === 1) {
        candidate.score += 5;
      }
    }
  }

  return candidate;
}

export function oneOf<T extends Schema[]>(
  schemas: T
): Schema<Infer<T[number]>> & { _schemas: T } {
  const defaultVal = schemas[0]?._default as Infer<T[number]>;

  const schema = createSchema("oneOf", defaultVal, (value) => {
    // Score all candidates
    const candidates = schemas.map((s, i) =>
      scoreCandidate(s, value, i, schemas)
    );

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Use the best match
    const best = candidates[0];
    if (best) {
      return schemas[best.index]!(value);
    }

    // Fallback to first schema
    return schemas[0]!(value);
  }) as Schema<Infer<T[number]>> & { _schemas: T };

  schema._schemas = schemas;
  return schema;
}

export function union<T extends Schema[]>(
  ...schemas: T
): Schema<Infer<T[number]>> {
  // union is just oneOf with rest params
  return oneOf(schemas);
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function parse<T extends Schema>(schema: T, value: unknown): Infer<T> {
  return schema(value) as Infer<T>;
}

export function parseWithMeta<T extends Schema>(
  schema: T,
  value: unknown
): { value: Infer<T>; meta: ParseMeta } {
  if (schema._kind === "oneOf") {
    const oneOfSchema = schema as unknown as Schema & { _schemas: Schema[] };
    const candidates = oneOfSchema._schemas.map((s, i) =>
      scoreCandidate(s, value, i, oneOfSchema._schemas)
    );
    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0];
    const chosenIndex = best?.index ?? 0;
    const result = oneOfSchema._schemas[chosenIndex]!(value);

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
