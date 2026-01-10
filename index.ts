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

export type Schema<T = unknown> = $TonicType<$Tonic<T>>;
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

type Primitive = string | number | boolean;

type LiteralOutput<T extends Primitive> = T extends string
  ? T | (string & {})
  : T extends number
  ? T | (number & {})
  : T | (boolean & {});

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
          makeDiag("default", { schema: "literal", value: expected }),
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
          NO_DIAGNOSTICS
        );
      const b = base(value);
      if (b.diagnostics.some((d) => d.kind === "default"))
        return result(expected as LiteralOutput<T>, 0, false, false, [
          makeDiag("default", { schema: "literal", value: expected }),
        ]);
      return b;
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

export function field<T extends Schema>(
  inner: T,
  options?: { from?: string }
): FieldReturn<T> {
  if (options?.from) (inner as FieldSchema<T>)._from = options.from;
  return inner as unknown as FieldReturn<T>;
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
    else if (best.typeMatch) reason = "type match";
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

export function parse<T extends Schema>(schema: T, value: unknown): Infer<T> {
  return schema(value).value as Infer<T>;
}

export function parseWithDiagnostics<T extends Schema>(
  schema: T,
  value: unknown
): ParseResult<Infer<T>> {
  return schema(value);
}
