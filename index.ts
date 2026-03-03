type Prettify<T> = T extends infer U ? { [K in keyof U]: U[K] } & {} : never;

type DeepPrettify<T> = T extends (infer U)[]
  ? DeepPrettify<U>[]
  : T extends object
  ? Prettify<{ [K in keyof T]: DeepPrettify<T[K]> }>
  : T;

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

export type Diagnostic =
  | { kind: "coercion"; path: (string | number)[]; details: CoercionDetails }
  | { kind: "default"; path: (string | number)[]; details: DefaultDetails }
  | {
      kind: "literal_mismatch";
      path: (string | number)[];
      details: LiteralDetails;
    }
  | {
      kind: "literal_coercion";
      path: (string | number)[];
      details: LiteralDetails;
    }
  | {
      kind: "literal_default";
      path: (string | number)[];
      details: LiteralDetails;
    }
  | {
      kind: "union_selection";
      path: (string | number)[];
      details: UnionSelectionDetails;
    }
  | {
      kind: "field_alias";
      path: (string | number)[];
      details: FieldAliasDetails;
    }
  | {
      kind: "array_wrap";
      path: (string | number)[];
      details: ArrayWrapDetails;
    };

export interface ParseResult<T> {
  value: T;
  diagnostics: Diagnostic[];
}

interface InternalResult<T> {
  value: T;
  score: number;
  exactMatch: boolean;
  typeMatch: boolean;
  diagnostics: Diagnostic[];
}

const NO_DIAGNOSTICS: Diagnostic[] = [];

function result<T>(
  v: T,
  s: number,
  e: boolean,
  t: boolean,
  d: Diagnostic[]
): InternalResult<T> {
  return { value: v, score: s, exactMatch: e, typeMatch: t, diagnostics: d };
}

const S_EXACT_TYPE = 100;
const S_LITERAL_EXACT = 200;
const S_LITERAL_TYPE = 100;
const S_NULL_MATCH = 150;
const S_ARRAY_MATCH = 80;
const S_COERCIBLE_STRING = 1;
const S_COERCIBLE_NUMBER = 5;
const S_COERCIBLE_BOOLEAN = 5;
const S_FIELD_PRESENT = 5;
const S_FIELD_TYPE_MATCH = 2;
const S_FIELD_MISSING = -10;
const S_FIELD_COVERAGE = 1;
const S_DISCRIMINATOR_EXACT = 50;
const S_DISCRIMINATOR_TYPE = 5;
const S_DISCRIMINATOR_MISMATCH = -50;
const S_UNIQUE_FIELD = 10;

function prependPath(diagnostics: Diagnostic[], segment: string | number) {
  for (let i = 0; i < diagnostics.length; i++)
    diagnostics[i]!.path.unshift(segment);
}

function makeDiag<K extends DiagnosticKind>(
  kind: K,
  details: DiagnosticDetailsByKind[K],
  path?: string | number
): Diagnostic {
  return { kind, path: path ? [path] : [], details } as Diagnostic;
}

interface $Tonic<O = unknown> {
  output: O;
  default: O;
}

export interface $TonicType<Internals extends $Tonic = $Tonic> {
  (value: unknown): InternalResult<any>;
  _tonic: Internals;
  _kind: string;
  _output: any;
  _default: any;
}

type $Output<T> = T extends $TonicObject<infer S>
  ? InferObjectOutput<S>
  : T extends $TonicArray<infer E>
  ? $Output<E>[]
  : T extends $TonicType<infer I>
  ? I["output"]
  : unknown;

/**
 * A schema definition that parses and coerces values to type `T`.
 *
 * Schemas are callable functions that return an internal result with the
 * coerced value, score (for union discrimination), and diagnostics.
 *
 * @template T - The output type this schema produces
 *
 * @example
 * ```ts
 * const mySchema: Schema<string> = string();
 * ```
 */
export type Schema<T = unknown> = $TonicType<$Tonic<T>>;

/**
 * Extracts the TypeScript type that a schema will produce after parsing.
 *
 * @template T - A schema type to infer from
 *
 * @example
 * ```ts
 * const UserSchema = object({
 *   id: number(),
 *   name: string(),
 *   tags: array(string()),
 * });
 *
 * type User = Infer<typeof UserSchema>;
 * // { id: number; name: string; tags: string[] }
 * ```
 */
export type Infer<T extends $TonicType> = DeepPrettify<$Output<T>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type NonEmptyArray<T> = [T, ...T[]];

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

/**
 * Creates a schema that coerces values to strings.
 *
 * Coercion rules:
 *
 * - `string` → passed through unchanged
 * - `number`, `boolean` → converted via `String()`
 * - `null`, `undefined` → returns default (`""`)
 * - `object`, `array` → JSON stringified
 *
 * @returns A schema that produces `string` values
 *
 * @example
 * ```ts
 * parse(string(), "hello");     // "hello"
 * parse(string(), 42);          // "42"
 * parse(string(), true);        // "true"
 * parse(string(), null);        // ""
 * parse(string(), { a: 1 });    // '{"a":1}'
 * ```
 */
export function string(): Schema<string> {
  const parse = (value: unknown): InternalResult<string> => {
    const d = (parse as Schema<string>)._default;
    const t = typeof value;
    if (t === "string")
      return result(value as string, S_EXACT_TYPE, false, true, NO_DIAGNOSTICS);
    if (value === undefined || value === null)
      return result(d, S_COERCIBLE_STRING, false, false, [
        makeDiag("default", { schema: "string", value: d }),
      ]);
    const r =
      isPlainObject(value) || Array.isArray(value)
        ? JSON.stringify(value)
        : String(value);
    return result(r, S_COERCIBLE_STRING, false, false, [
      makeDiag("coercion", { from: t, to: "string" }),
    ]);
  };
  return createSchema("string", "", parse);
}

/**
 * Creates a schema that coerces values to numbers.
 *
 * Coercion rules:
 * - `number` → passed through unchanged (except `NaN` → default)
 * - `string` → parsed via unary `+` (non-numeric strings → default)
 * - `boolean` → `true` becomes `1`, `false` becomes `0`
 * - `null`, `undefined` → returns default (`0`)
 *
 * @returns A schema that produces `number` values
 *
 * @example
 * ```ts
 * parse(number(), 42);        // 42
 * parse(number(), "123");     // 123
 * parse(number(), "3.14");    // 3.14
 * parse(number(), true);      // 1
 * parse(number(), "hello");   // 0 (non-numeric string)
 * parse(number(), null);      // 0
 * ```
 */
export function number(): Schema<number> {
  const parse = (value: unknown): InternalResult<number> => {
    const d = (parse as Schema<number>)._default;
    if (value === undefined || value === null)
      return result(d, 0, false, false, [
        makeDiag("default", { schema: "number", value: d }),
      ]);
    const t = typeof value;
    if (t === "number" && !Number.isNaN(value))
      return result(value as number, S_EXACT_TYPE, false, true, NO_DIAGNOSTICS);
    if (t === "string") {
      const p = +value;
      if (!Number.isNaN(p))
        return result(p, S_COERCIBLE_NUMBER, false, false, [
          makeDiag("coercion", { from: t, to: "number" }),
        ]);
      return result(d, 0, false, false, [
        makeDiag("default", { schema: "number", value: d }),
      ]);
    }
    if (t === "boolean")
      return result(+value, 0, false, false, [
        makeDiag("coercion", { from: t, to: "number" }),
      ]);
    return result(d, 0, false, false, [
      makeDiag("coercion", { from: t, to: "number" }),
    ]);
  };
  return createSchema("number", 0, parse);
}

/**
 * Creates a schema that coerces values to booleans.
 *
 * Coercion rules:
 *
 * - `boolean` → passed through unchanged
 * - `"false"` (string) → `false` (special case)
 * - `0` → `false`
 * - `null`, `undefined` → returns default (`false`)
 * - All other truthy values → `true`
 *
 * @returns A schema that produces `boolean` values
 *
 * @example
 * ```ts
 * parse(boolean(), true);      // true
 * parse(boolean(), false);     // false
 * parse(boolean(), "false");   // false (special case)
 * parse(boolean(), "true");    // true
 * parse(boolean(), 1);         // true
 * parse(boolean(), 0);         // false
 * parse(boolean(), null);      // false
 * ```
 */
export function boolean(): Schema<boolean> {
  const parse = (value: unknown): InternalResult<boolean> => {
    const d = (parse as Schema<boolean>)._default;
    if (value === undefined || value === null)
      return result(d, 0, false, false, [
        makeDiag("default", { schema: "boolean", value: d }),
      ]);
    const t = typeof value;
    if (t === "boolean")
      return result(
        value as boolean,
        S_EXACT_TYPE,
        false,
        true,
        NO_DIAGNOSTICS
      );
    let r: boolean;
    if (value === "false" || value === 0) r = false;
    else r = Boolean(value);
    return result(r, S_COERCIBLE_BOOLEAN, false, false, [
      makeDiag("coercion", { from: t, to: "boolean" }),
    ]);
  };
  return createSchema("boolean", false, parse);
}

type Primitive = string | number | boolean | null;

type LiteralOutput<T extends Primitive> = T extends string
  ? T | (string & {})
  : T extends number
  ? T | (number & {})
  : T extends null
  ? T | (null & {})
  : T | (boolean & {});

/**
 * Creates a schema for a specific literal value.
 *
 * Unlike strict validation, this schema accepts any value of the same base type
 * but tracks whether it was an exact match (used for union discrimination).
 * The output type is widened to allow other values of the same type to pass through.
 *
 * How it works:
 *
 * - Exact match → value passed through, high discrimination score
 * - Same type, different value → value passed through (e.g., `"other"` for `literal("expected")`)
 * - Different type → coerced via the base type schema
 * - `null`, `undefined` → returns the literal as default
 *
 * @template T - The literal primitive type (`string`, `number`, or `boolean`)
 * @param expected - The expected literal value
 * @returns A schema that produces the literal type (widened to base type)
 *
 * @example
 * ```ts
 * const Status = literal("active");
 *
 * parse(Status, "active");    // "active" (exact match)
 * parse(Status, "inactive");  // "inactive" (same type, preserved)
 * parse(Status, null);        // "active" (default)
 *
 * // Commonly used with union() for discriminated unions:
 * const Event = union(
 *   object({ type: literal("click"), x: number(), y: number() }),
 *   object({ type: literal("keypress"), key: string() })
 * );
 * ```
 */
export function literal<T extends Primitive>(
  expected: T
): Schema<LiteralOutput<T>> & { _literal: T } {
  const t = typeof expected;
  let base: Schema<LiteralOutput<T>>;
  if (t === "string") base = string() as Schema<LiteralOutput<T>>;
  else if (t === "number") base = number() as Schema<LiteralOutput<T>>;
  else if (t === "boolean") base = boolean() as Schema<LiteralOutput<T>>;
  else throw Error("literal(): unexpected primitive type");

  const schema = createSchema(
    "literal",
    expected as LiteralOutput<T>,
    (value): InternalResult<LiteralOutput<T>> => {
      if (value === undefined || value === null)
        return result(expected as LiteralOutput<T>, 0, false, false, [
          makeDiag("literal_default", { expected, received: value }),
        ]);
      if (value === expected)
        return result(
          expected as LiteralOutput<T>,
          S_LITERAL_EXACT,
          true,
          true,
          NO_DIAGNOSTICS
        );
      if (typeof value === typeof expected)
        return result(
          value as LiteralOutput<T>,
          S_LITERAL_TYPE,
          false,
          true,
          [makeDiag("literal_mismatch", { expected, received: value })]
        );
      const b = base(value);
      if (b.diagnostics.some((d) => d.kind === "default"))
        return result(expected as LiteralOutput<T>, 0, false, false, [
          makeDiag("literal_default", { expected, received: value }),
        ]);
      return result(b.value, b.score, b.exactMatch, b.typeMatch, [
        makeDiag("literal_coercion", { expected, received: value }),
      ]);
    }
  ) as Schema<LiteralOutput<T>> & { _literal: T };
  schema._literal = expected;
  return schema;
}

export interface $TonicArray<Element extends $TonicType = $TonicType> {
  (value: unknown): InternalResult<any>;
  _tonic: $Tonic;
  _kind: "array";
  _element: Element;
  _output: any;
  _default: any;
}

type ObjectShape = Record<string, any>;

// Detect readonly keys (getter-only properties) using type equality check
type IfEquals<X, Y, A, B> = (<T>() => T extends X ? 1 : 2) extends <
  T
>() => T extends Y ? 1 : 2
  ? A
  : B;

type ReadonlyKeys<T> = {
  [K in keyof T]-?: IfEquals<
    { [Q in K]: T[K] },
    { -readonly [Q in K]: T[K] },
    never,
    K
  >;
}[keyof T];

type IsOptionalKey<T extends ObjectShape, K extends keyof T> =
  | (T[K] extends OptionalSchema ? K : never)
  | (K extends ReadonlyKeys<T> ? K : never);

type InferObjectOutput<T extends ObjectShape> = {
  -readonly [K in keyof T as K extends IsOptionalKey<T, K>
    ? never
    : K]: $Output<T[K]>;
} & {
  -readonly [K in keyof T as K extends IsOptionalKey<T, K>
    ? K
    : never]?: $Output<T[K]>;
} & Record<string, unknown>;

export interface $TonicObject<Shape extends ObjectShape = ObjectShape> {
  (value: unknown): InternalResult<any>;
  _tonic: $Tonic;
  _kind: "object";
  _shape: Shape;
  _name?: string;
  _output: any;
  _default: any;
}

type InferObject<T extends ObjectShape> = InferObjectOutput<T>;

interface OptionalSchema<T = unknown> extends Schema<T | undefined> {
  _optional: true;
}

interface NullableSchema<T = unknown> extends Schema<T | null> {
  _nullable: true;
}

function isGetter<T>(obj: T, key: keyof T) {
  return typeof Object.getOwnPropertyDescriptor(obj, key)?.get === "function";
}

/**
 * Creates a schema for objects with a defined shape.
 *
 * How it works:
 *
 * - **Unknown keys preserved**: extra properties not in the shape pass through unchanged
 * - **Missing fields**: filled with each field's default value
 * - **Non-objects**: coerced to an object with all defaults
 * - **Recursive support**: use getter syntax for self-referential schemas
 *
 * For union discrimination, literal fields act as discriminators and influence
 * which union branch is selected.
 *
 * @template T - The shape definition (record of property names to schemas)
 * @param shape - An object mapping property names to their schemas
 * @param name - Optional name for debugging and union discrimination diagnostics
 * @returns A schema that produces objects matching the shape
 *
 * @example
 * ```ts
 * const User = object({
 *   id: number(),
 *   name: string(),
 *   email: optional(string()),
 * });
 *
 * parse(User, { id: 1, name: "Alice" });
 * // { id: 1, name: "Alice" }
 *
 * parse(User, { id: "123", name: "Bob", extra: true });
 * // { id: 123, name: "Bob", extra: true }  (coerced id, preserved extra)
 *
 * parse(User, null);
 * // { id: 0, name: "" }  (all defaults)
 * ```
 *
 * @example Recursive schemas
 * ```ts
 * type Category = { name: string; parent?: Category };
 *
 * const CategorySchema = typed<Category>(object({
 *   name: string(),
 *   get parent() { return optional(CategorySchema); }
 * }));
 * ```
 */
export function object<T extends ObjectShape>(
  shape: T,
  name?: string
): $TonicObject<T> {
  const getDefaultVal = (): InferObject<T> => {
    const defaultVal = {} as InferObject<T>;
    for (const key in shape) {
      // Skip getters - they're deferred for recursive schemas
      if (isGetter(shape, key)) continue;
      const propSchema = shape[key]!;
      if (!("_optional" in propSchema)) {
        (defaultVal as Record<string, unknown>)[key] = propSchema._default;
      }
    }
    return defaultVal;
  };

  function parseObject(value: unknown): InternalResult<InferObject<T>> {
    const isObj = isPlainObject(value);
    const {
      __proto__: _,
      prototype: __,
      constructor: ___,
      ...input
    } = isObj ? value : {};

    let totalScore = 0;
    let hasExactDiscriminator = false;
    const diagnostics: Diagnostic[] = [];

    // Process each field in the shape
    for (const key in shape) {
      const propSchema = shape[key]!;

      // Check for field alias (_from)
      const fromKey = (propSchema as { _from?: string })._from || key;
      const propValue = input[fromKey];

      // Delete the alias key if different from schema key
      if (fromKey !== key && fromKey in input) {
        diagnostics.push(makeDiag("field_alias", { from: fromKey }, key));
        delete input[fromKey];
      }

      // Getter-defined fields are treated as optional to prevent infinite recursion
      const isOptional = "_optional" in propSchema || isGetter(shape, key);

      if (isOptional && propValue === undefined) {
        delete input[key];
      } else {
        const fieldPresent = isObj && fromKey in value;

        if (fieldPresent) {
          totalScore += S_FIELD_PRESENT;
        } else if (!isOptional) {
          totalScore += S_FIELD_MISSING;
        }

        const fieldResult = propSchema(propValue);
        input[key] = fieldResult.value;

        // Add field type match bonus
        if (fieldResult.typeMatch && fieldPresent) {
          totalScore += S_FIELD_TYPE_MATCH;
        }

        // Only accumulate nested scores when field was present in input
        if (
          fieldPresent &&
          (propSchema._kind === "object" || propSchema._kind === "array")
        ) {
          totalScore += fieldResult.score;
        }

        if ("_literal" in propSchema) {
          const literalSchema = propSchema as unknown as Schema & {
            _literal: Primitive;
          };
          if (propValue === literalSchema._literal) {
            totalScore += S_DISCRIMINATOR_EXACT;
            hasExactDiscriminator = true;
          } else if (typeof propValue === typeof literalSchema._literal) {
            totalScore += S_DISCRIMINATOR_TYPE;
          } else if (fieldPresent) {
            totalScore += S_DISCRIMINATOR_MISMATCH;
          }
        }

        prependPath(fieldResult.diagnostics, key);
        for (let j = 0; j < fieldResult.diagnostics.length; j++)
          diagnostics.push(fieldResult.diagnostics[j]!);
      }
    }

    for (const key in input) if (key in shape) totalScore += S_FIELD_COVERAGE;
    return result(
      input as InferObject<T>,
      totalScore,
      hasExactDiscriminator && isObj,
      isObj,
      diagnostics
    );
  }

  const schema = parseObject as unknown as $TonicObject<T>;
  schema._output = null as unknown as InferObjectOutput<T>;
  schema._kind = "object";
  schema._shape = shape;
  schema._name = name;
  schema._default = getDefaultVal();
  return schema;
}

/**
 * Creates a schema for arrays where each element matches the given schema.
 *
 * Coercion rules:
 *
 * - `array` → each element parsed through the element schema
 * - `null`, `undefined` → returns empty array `[]`
 * - Any other value → wrapped in a single-element array and parsed
 *
 * This "wrap single values" behavior is useful for APIs that sometimes return
 * a single item instead of an array.
 *
 * @template T - The element schema type
 * @param element - Schema to apply to each array element
 * @returns A schema that produces arrays of the element type
 *
 * @example
 * ```ts
 * const Tags = array(string());
 *
 * parse(Tags, ["a", "b", "c"]);  // ["a", "b", "c"]
 * parse(Tags, "single");         // ["single"] (wrapped)
 * parse(Tags, [1, 2, 3]);        // ["1", "2", "3"] (coerced)
 * parse(Tags, null);             // []
 *
 * // Nested arrays
 * const Matrix = array(array(number()));
 * parse(Matrix, [[1, 2], [3, 4]]);  // [[1, 2], [3, 4]]
 * ```
 */
export function array<T extends $TonicType>(element: T): $TonicArray<T> {
  type ElementOutput = $Output<T>;
  function parseArray(value: unknown): InternalResult<ElementOutput[]> {
    if (!Array.isArray(value)) {
      if (value === undefined || value === null)
        return result([] as ElementOutput[], 0, false, false, [
          makeDiag("default", { schema: "array", value: [] }),
        ]);
      const e = element(value);
      prependPath(e.diagnostics, 0);
      const d: Diagnostic[] = [
        makeDiag("array_wrap", { valueType: typeof value }),
      ];
      for (let j = 0; j < e.diagnostics.length; j++) d.push(e.diagnostics[j]!);
      return result([e.value as ElementOutput], e.score, false, false, d);
    }
    let s = S_ARRAY_MATCH,
      x = true;
    const d: Diagnostic[] = [];
    const r = value.map((v, i) => {
      const e = element(v);
      s += e.score;
      if (!e.exactMatch) x = false;
      prependPath(e.diagnostics, i);
      for (let j = 0; j < e.diagnostics.length; j++) d.push(e.diagnostics[j]!);
      return e.value as ElementOutput;
    });
    return result(r, s, x, true, d);
  }

  const schema = parseArray as unknown as $TonicArray<T>;
  schema._kind = "array";
  schema._output = null as unknown as ElementOutput[];
  schema._default = [] as ElementOutput[];
  schema._element = element;
  return schema;
}

/**
 * Wraps a schema to make its field optional (`T | undefined`).
 *
 * When used in an object schema, the key is **omitted from the output**
 * when the value is `undefined`. This differs from `nullable()` which
 * keeps the key with a `null` value.
 *
 * @template T - The inner schema type
 * @param inner - The schema to wrap
 * @returns An optional schema that allows `undefined`
 *
 * @example
 * ```ts
 * const Profile = object({
 *   name: string(),
 *   bio: optional(string()),
 * });
 *
 * parse(Profile, { name: "Alice" });
 * // { name: "Alice" }  (bio key omitted)
 *
 * parse(Profile, { name: "Alice", bio: "Hello" });
 * // { name: "Alice", bio: "Hello" }
 *
 * parse(Profile, { name: "Alice", bio: undefined });
 * // { name: "Alice" }  (bio key omitted)
 * ```
 */
export function optional<T extends Schema>(inner: T): OptionalSchema<Infer<T>> {
  function parseOptional(value: unknown): InternalResult<Infer<T> | undefined> {
    if (value === undefined)
      return result(undefined, S_EXACT_TYPE, false, true, NO_DIAGNOSTICS);
    return inner(value) as InternalResult<Infer<T> | undefined>;
  }
  const schema = createSchema(
    "optional",
    undefined,
    parseOptional
  ) as OptionalSchema<Infer<T>>;
  schema._optional = true;
  return schema;
}

/**
 * Wraps a schema to make its field nullable (`T | null`).
 *
 * When the value is `null` or `undefined`, returns `null`.
 * Unlike `optional()`, the key is always **present in the output** with
 * either the parsed value or `null`.
 *
 * @template T - The inner schema type
 * @param inner - The schema to wrap
 * @returns A nullable schema that allows `null`
 *
 * @example
 * ```ts
 * const Profile = object({
 *   name: string(),
 *   avatar: nullable(string()),
 * });
 *
 * parse(Profile, { name: "Alice" });
 * // { name: "Alice", avatar: null }  (key present)
 *
 * parse(Profile, { name: "Alice", avatar: "pic.jpg" });
 * // { name: "Alice", avatar: "pic.jpg" }
 *
 * parse(Profile, { name: "Alice", avatar: null });
 * // { name: "Alice", avatar: null }
 * ```
 */
export function nullable<T extends Schema>(inner: T): NullableSchema<Infer<T>> {
  function parseNullable(value: unknown): InternalResult<Infer<T> | null> {
    if (value === null || value === undefined)
      return result(null, S_NULL_MATCH, value === null, true, NO_DIAGNOSTICS);
    return inner(value) as InternalResult<Infer<T> | null>;
  }
  const schema = createSchema(
    "nullable",
    null,
    parseNullable
  ) as NullableSchema<Infer<T>>;
  schema._nullable = true;
  return schema;
}

interface FieldSchema<T = unknown> extends Schema<T> {
  _from?: string;
}

type FieldReturn<T extends Schema> = FieldSchema<Infer<T>> &
  (T extends OptionalSchema ? { _optional: true } : {});

/**
 * Wraps a schema with field-level options, primarily for key aliasing.
 *
 * Use the `from` option to read from a different input key than the output key.
 * This is useful for mapping snake_case API responses to camelCase properties,
 * or handling renamed/legacy field names.
 *
 * @template T - The inner schema type
 * @param inner - The schema to wrap
 * @param options - Field options
 * @param options.from - Input key name to read from (output uses the object's key)
 * @returns The wrapped schema with field options applied
 *
 * @example
 * ```ts
 * const User = object({
 *   firstName: field(string(), { from: "first_name" }),
 *   lastName: field(string(), { from: "last_name" }),
 *   createdAt: field(string(), { from: "created_at" }),
 * });
 *
 * parse(User, {
 *   first_name: "Alice",
 *   last_name: "Smith",
 *   created_at: "2024-01-01"
 * });
 * // { firstName: "Alice", lastName: "Smith", createdAt: "2024-01-01" }
 * ```
 *
 * @example With optional fields
 * ```ts
 * const Profile = object({
 *   displayName: field(string(), { from: "display_name" }),
 *   avatarUrl: field(optional(string()), { from: "avatar_url" }),
 * });
 * ```
 */
export function field<T extends Schema>(
  inner: T,
  options?: { from?: string }
): FieldReturn<T> {
  // Create an independent wrapper to avoid mutating/re-aliasing shared schema instances.
  const wrapped = ((value: unknown) => inner(value)) as FieldSchema<T>;
  Object.assign(wrapped, inner);
  if (options?.from) wrapped._from = options.from;
  return wrapped as unknown as FieldReturn<T>;
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

/**
 * Creates a schema for discriminated unions that selects the best-matching branch.
 *
 * Unlike strict union validation, tonic's union uses a scoring system to find
 * the best structural match. This allows graceful handling of:
 *
 * - New enum values the client doesn't know about
 * - Partial matches when API responses change
 * - Polymorphic types without exact discriminator matches
 *
 * **Scoring system** (higher = better match):
 *
 * - Exact literal match: +200
 * - Nullable schema + null value: +150
 * - Type match (string/number/boolean/array): +80 to +100
 * - Discriminator field matches exactly: +50
 * - Required property present: +5
 * - Property value matches expected type: +2
 * - Input key exists in schema: +1
 * - Required property missing: -10
 * - Discriminator field has wrong type: -50
 *
 * @template T - Tuple of schema types in the union
 * @param schemas - Two or more schemas to form the union
 * @returns A schema that produces one of the union member types
 *
 * @example
 * ```ts
 * // Discriminated union with literal types
 * const Event = union(
 *   object({ type: literal("click"), x: number(), y: number() }),
 *   object({ type: literal("keypress"), key: string() })
 * );
 *
 * parse(Event, { type: "click", x: 10, y: 20 });
 * // { type: "click", x: 10, y: 20 }
 *
 * parse(Event, { type: "keypress", key: "Enter" });
 * // { type: "keypress", key: "Enter" }
 *
 * // Unknown type still works - picks best structural match
 * parse(Event, { type: "scroll", x: 0, y: 100 });
 * // { type: "scroll", x: 0, y: 100 }  (matches click structure)
 * ```
 *
 * @example Open enums (union of literals)
 * ```ts
 * const Status = union(
 *   literal("pending"),
 *   literal("active"),
 *   literal("archived")
 * );
 *
 * parse(Status, "active");     // "active"
 * parse(Status, "suspended");  // "suspended" (unknown value preserved)
 * ```
 */
export function union<T extends NonEmptyArray<Schema>>(
  ...schemas: T
): Schema<Infer<T[number]>> & { _schemas: T } {
  if (!schemas.length)
    return createSchema("union", undefined, () =>
      result(undefined, 0, false, false, NO_DIAGNOSTICS)
    ) as Schema<Infer<T[number]>> & { _schemas: T };
  const keyCounts = computeKeyCounts(schemas);
  const defaultVal = schemas[0]!._default as Infer<T[number]>;

  function parseUnion(value: unknown): InternalResult<Infer<T[number]>> {
    let best: InternalResult<Infer<T[number]>> | undefined,
      idx = 0,
      name: string | undefined;
    for (let i = 0; i < schemas.length; i++) {
      const s = schemas[i]!,
        r = s(value) as InternalResult<Infer<T[number]>>;
      if (s._kind === "object" && isPlainObject(value)) {
        const o = s as Schema & { _shape: ObjectShape; _name?: string };
        for (const k in value)
          if (k in o._shape && keyCounts[k] === 1) r.score += S_UNIQUE_FIELD;
      }
      if (
        !best ||
        (r.exactMatch && !best.exactMatch) ||
        (!best.exactMatch && r.score > best.score)
      ) {
        best = r;
        idx = i;
        if (s._kind === "object")
          name = (s as Schema & { _name?: string })._name;
      }
      if (r.exactMatch) break;
    }
    if (!best) best = schemas[0]!(value) as InternalResult<Infer<T[number]>>;
    let reason: "exact match" | "type match" | "best score";
    if (best.exactMatch) reason = "exact match";
    else if (
      best.typeMatch &&
      schemas[idx]!._kind !== "object" &&
      schemas[idx]!._kind !== "array"
    )
      reason = "type match";
    else reason = "best score";
    const d: Diagnostic[] = [
      makeDiag("union_selection", {
        chosenIndex: idx,
        chosenName: name,
        reason,
      }),
    ];
    for (let j = 0; j < best.diagnostics.length; j++)
      d.push(best.diagnostics[j]!);
    return result(best.value, best.score, best.exactMatch, best.typeMatch, d);
  }

  const schema = createSchema("union", defaultVal, parseUnion) as Schema<
    Infer<T[number]>
  > & { _schemas: T };
  schema._schemas = schemas;
  return schema;
}

/**
 * A schema type alias that preserves an explicit type annotation.
 * Used as the return type of {@link typed}.
 *
 * @template T - The explicit output type
 */
export type TypedSchema<T> = Schema<T>;

/**
 * Explicitly types a schema, breaking TypeScript's circular inference.
 *
 * Use this helper when defining recursive/self-referential schemas where
 * TypeScript cannot infer the type due to circular references. Combine with
 * getter syntax in object shapes to defer schema resolution.
 *
 * @template T - The explicit type to assign to the schema
 * @param schema - The schema to type (typically an `object()` call)
 * @returns The same schema with the explicit type `T`
 *
 * @example
 * ```ts
 * // Define the recursive type first
 * type TreeNode = {
 *   value: string;
 *   children: TreeNode[];
 * };
 *
 * // Use typed<T>() with getter to break circular inference
 * const TreeNodeSchema = typed<TreeNode>(object({
 *   value: string(),
 *   get children() { return array(TreeNodeSchema); }
 * }));
 *
 * parse(TreeNodeSchema, {
 *   value: "root",
 *   children: [
 *     { value: "child1", children: [] },
 *     { value: "child2", children: [] }
 *   ]
 * });
 * ```
 *
 * @example Optional self-reference
 * ```ts
 * type User = { id: string; manager?: User };
 *
 * const UserSchema = typed<User>(object({
 *   id: string(),
 *   get manager() { return optional(UserSchema); }
 * }));
 * ```
 */
export function typed<T>(schema: unknown): TypedSchema<T> {
  return schema as TypedSchema<T>;
}

/**
 * Creates a schema that accepts any value and passes it through unchanged.
 *
 * Use for dynamic data, metadata fields, or parts of an API response where
 * you don't want to define a strict schema. The value is not coerced or
 * validated in any way.
 *
 * @returns A schema that produces `unknown` (accepts anything)
 *
 * @example
 * ```ts
 * const Event = object({
 *   type: string(),
 *   payload: unknown(),  // accept any shape
 * });
 *
 * parse(Event, { type: "click", payload: { x: 10, y: 20 } });
 * // { type: "click", payload: { x: 10, y: 20 } }
 *
 * parse(Event, { type: "data", payload: [1, 2, 3] });
 * // { type: "data", payload: [1, 2, 3] }
 *
 * parse(Event, { type: "simple", payload: "just a string" });
 * // { type: "simple", payload: "just a string" }
 * ```
 */
export function unknown(): Schema<unknown> {
  const parse = (value: unknown): InternalResult<unknown> => {
    return result(value, S_EXACT_TYPE, false, true, NO_DIAGNOSTICS);
  };
  return createSchema("unknown", undefined, parse);
}

/**
 * Parses a value using the given schema and returns the coerced result.
 *
 * This function **never throws**. Invalid or missing data is coerced to
 * valid defaults, making it safe to use with unpredictable API responses.
 *
 * @template T - The schema type
 * @param schema - The schema to parse with
 * @param value - The value to parse (typically from `JSON.parse` or API response)
 * @returns The coerced value matching the schema's output type
 *
 * @example
 * ```ts
 * const User = object({ id: number(), name: string() });
 *
 * // Normal usage
 * const user = parse(User, await res.json());
 *
 * // Handles type mismatches
 * parse(User, { id: "123", name: "Alice" });
 * // { id: 123, name: "Alice" }
 *
 * // Handles missing data
 * parse(User, {});
 * // { id: 0, name: "" }
 *
 * // Handles complete garbage
 * parse(User, null);
 * // { id: 0, name: "" }
 * ```
 */
export function parse<T extends Schema>(schema: T, value: unknown): Infer<T> {
  return schema(value).value as Infer<T>;
}

/**
 * Parses a value and returns both the coerced result and diagnostics.
 *
 * Use this when you need visibility into what coercions or defaults were applied.
 * Useful for logging, debugging, or detecting when API responses don't match
 * your expected schema.
 *
 * @template T - The schema type
 * @param schema - The schema to parse with
 * @param value - The value to parse
 * @returns An object with `value` (the coerced result) and `diagnostics` (array of issues)
 *
 * @example
 * ```ts
 * const User = object({ id: number(), name: string() });
 *
 * const { value, diagnostics } = parseWithDiagnostics(User, {
 *   id: "123",
 *   name: null
 * });
 *
 * // value: { id: 123, name: "" }
 *
 * // diagnostics:
 * // [
 * //   { kind: "coercion", path: ["id"], details: { from: "string", to: "number" } },
 * //   { kind: "default", path: ["name"], details: { schema: "string", value: "" } }
 * // ]
 *
 * // Log warnings for mismatches
 * for (const d of diagnostics) {
 *   if (d.kind === "coercion") {
 *     console.warn(`Type mismatch at ${d.path.join(".")}`);
 *   }
 * }
 * ```
 */
export function parseWithDiagnostics<T extends Schema>(
  schema: T,
  value: unknown
): ParseResult<Infer<T>> {
  return schema(value);
}
