import { expect, test, describe } from "bun:test";

import {
  string,
  number,
  boolean,
  object,
  array,
  optional,
  nullable,
  literal,
  union,
  parse,
  parseWithMeta,
  type Infer,
} from "./index";

// ============================================================================
// PRIMITIVE SCHEMAS
// ============================================================================

describe("string schema", () => {
  test("parses valid string", () => {
    const schema = string();
    expect(parse(schema, "hello")).toBe("hello");
  });

  test("coerces number to string", () => {
    const schema = string();
    expect(parse(schema, 123)).toBe("123");
  });

  test("coerces boolean to string", () => {
    const schema = string();
    expect(parse(schema, true)).toBe("true");
  });

  test("returns empty string for undefined", () => {
    const schema = string();
    expect(parse(schema, undefined)).toBe("");
  });

  test("returns empty string for null", () => {
    const schema = string();
    expect(parse(schema, null)).toBe("");
  });

  test("coerces object to JSON string", () => {
    const schema = string();
    expect(parse(schema, { a: 1 })).toBe('{"a":1}');
  });

  test("coerces array to JSON string", () => {
    const schema = string();
    expect(parse(schema, [1, 2, 3])).toBe("[1,2,3]");
  });
});

describe("number schema", () => {
  test("parses valid number", () => {
    const schema = number();
    expect(parse(schema, 42)).toBe(42);
  });

  test("parses float", () => {
    const schema = number();
    expect(parse(schema, 3.14)).toBe(3.14);
  });

  test("coerces string to number", () => {
    const schema = number();
    expect(parse(schema, "42")).toBe(42);
  });

  test("coerces float string to number", () => {
    const schema = number();
    expect(parse(schema, "3.14")).toBe(3.14);
  });

  test("returns 0 for invalid string", () => {
    const schema = number();
    expect(parse(schema, "not a number")).toBe(0);
  });

  test("returns 0 for undefined", () => {
    const schema = number();
    expect(parse(schema, undefined)).toBe(0);
  });

  test("returns 0 for null", () => {
    const schema = number();
    expect(parse(schema, null)).toBe(0);
  });

  test("returns 0 for NaN", () => {
    const schema = number();
    expect(parse(schema, NaN)).toBe(0);
  });

  test("coerces boolean to number", () => {
    const schema = number();
    expect(parse(schema, true)).toBe(1);
    expect(parse(schema, false)).toBe(0);
  });
});

describe("boolean schema", () => {
  test("parses true", () => {
    const schema = boolean();
    expect(parse(schema, true)).toBe(true);
  });

  test("parses false", () => {
    const schema = boolean();
    expect(parse(schema, false)).toBe(false);
  });

  test("coerces string 'true' to true", () => {
    const schema = boolean();
    expect(parse(schema, "true")).toBe(true);
  });

  test("coerces string 'false' to false", () => {
    const schema = boolean();
    expect(parse(schema, "false")).toBe(false);
  });

  test("coerces 1 to true", () => {
    const schema = boolean();
    expect(parse(schema, 1)).toBe(true);
  });

  test("coerces 0 to false", () => {
    const schema = boolean();
    expect(parse(schema, 0)).toBe(false);
  });

  test("returns false for undefined", () => {
    const schema = boolean();
    expect(parse(schema, undefined)).toBe(false);
  });

  test("returns false for null", () => {
    const schema = boolean();
    expect(parse(schema, null)).toBe(false);
  });

  test("coerces non-empty string to true", () => {
    const schema = boolean();
    expect(parse(schema, "hello")).toBe(true);
  });

  test("coerces empty string to false", () => {
    const schema = boolean();
    expect(parse(schema, "")).toBe(false);
  });
});

// ============================================================================
// LITERAL SCHEMA
// ============================================================================

describe("literal schema", () => {
  test("parses matching string literal", () => {
    const schema = literal("hello");
    expect(parse(schema, "hello")).toBe("hello");
  });

  test("parses matching number literal", () => {
    const schema = literal(42);
    expect(parse(schema, 42)).toBe(42);
  });

  test("parses matching boolean literal", () => {
    const schema = literal(true);
    expect(parse(schema, true)).toBe(true);
  });

  test("accepts any string for string literal", () => {
    const schema = literal("hello");
    expect(parse(schema, "world")).toBe("world");
  });

  test("accepts any number for number literal", () => {
    const schema = literal(42);
    expect(parse(schema, 100)).toBe(100);
  });

  test("accepts any boolean for boolean literal", () => {
    const schema = literal(true);
    expect(parse(schema, false)).toBe(false);
  });

  test("coerces number to string for string literal", () => {
    const schema = literal("hello");
    expect(parse(schema, 123)).toBe("123");
  });

  test("coerces string to number for number literal", () => {
    const schema = literal(42);
    expect(parse(schema, "100")).toBe(100);
  });

  test("coerces to boolean for boolean literal", () => {
    const schema = literal(true);
    expect(parse(schema, "false")).toBe(false);
    expect(parse(schema, 0)).toBe(false);
    expect(parse(schema, 1)).toBe(true);
  });

  test("defaults to literal value for undefined", () => {
    const schema = literal("hello");
    expect(parse(schema, undefined)).toBe("hello");
  });

  test("defaults to literal value for null", () => {
    const schema = literal(42);
    expect(parse(schema, null)).toBe(42);
  });

  test("type is literal | base type", () => {
    const strLit = literal("hello");
    type StrType = Infer<typeof strLit>;
    const s: StrType = "any string works";
    expect(s).toBe("any string works");

    const numLit = literal(42);
    type NumType = Infer<typeof numLit>;
    const n: NumType = 999;
    expect(n).toBe(999);

    const boolLit = literal(true);
    type BoolType = Infer<typeof boolLit>;
    const b: BoolType = false;
    expect(b).toBe(false);
  });
});

// ============================================================================
// OBJECT SCHEMA
// ============================================================================

describe("object schema", () => {
  test("parses valid object", () => {
    const schema = object({ name: string(), age: number() });
    const result = parse(schema, { name: "John", age: 30 });
    expect(result).toEqual({ name: "John", age: 30 });
  });

  test("passes through unknown keys", () => {
    const schema = object({ name: string() });
    const result = parse(schema, { name: "John", extra: "value" });
    expect(result).toEqual({ name: "John", extra: "value" });
  });

  test("provides defaults for missing properties", () => {
    const schema = object({ name: string(), age: number() });
    const result = parse(schema, { name: "John" });
    expect(result).toEqual({ name: "John", age: 0 });
  });

  test("provides defaults for non-object input", () => {
    const schema = object({ name: string(), age: number() });
    const result = parse(schema, "not an object");
    expect(result).toEqual({ name: "", age: 0 });
  });

  test("provides defaults for array input", () => {
    const schema = object({ name: string() });
    const result = parse(schema, ["not", "an", "object"]);
    expect(result).toEqual({ name: "" });
  });

  test("coerces nested properties", () => {
    const schema = object({
      user: object({ name: string() }),
    });
    const result = parse(schema, { user: { name: 123 } });
    expect(result).toEqual({ user: { name: "123" } });
  });

  test("handles empty object schema", () => {
    const schema = object({});
    expect(parse(schema, {})).toEqual({});
  });

  test("preserves unknown keys in nested objects", () => {
    const schema = object({
      user: object({ name: string() }),
    });
    const result = parse(schema, { user: { name: "John", extra: "data" } });
    expect(result.user.extra).toBe("data");
  });
});

// ============================================================================
// ARRAY SCHEMA
// ============================================================================

describe("array schema", () => {
  test("parses array of strings", () => {
    const schema = array(string());
    expect(parse(schema, ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("parses array of numbers", () => {
    const schema = array(number());
    expect(parse(schema, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  test("parses array of objects", () => {
    const schema = array(object({ id: number() }));
    expect(parse(schema, [{ id: 1 }, { id: 2 }])).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  test("coerces elements", () => {
    const schema = array(string());
    expect(parse(schema, [1, 2, 3])).toEqual(["1", "2", "3"]);
  });

  test("returns empty array for undefined", () => {
    const schema = array(string());
    expect(parse(schema, undefined)).toEqual([]);
  });

  test("returns empty array for null", () => {
    const schema = array(string());
    expect(parse(schema, null)).toEqual([]);
  });

  test("wraps single value in array", () => {
    const schema = array(string());
    expect(parse(schema, "hello")).toEqual(["hello"]);
  });

  test("handles empty array", () => {
    const schema = array(string());
    expect(parse(schema, [])).toEqual([]);
  });
});

// ============================================================================
// OPTIONAL AND NULLABLE
// ============================================================================

describe("optional schema", () => {
  test("returns undefined for undefined", () => {
    const schema = optional(string());
    expect(parse(schema, undefined)).toBeUndefined();
  });

  test("parses defined value", () => {
    const schema = optional(string());
    expect(parse(schema, "hello")).toBe("hello");
  });

  test("in object context - omits undefined", () => {
    const schema = object({ name: string(), age: optional(number()) });
    const result = parse(schema, { name: "John" });
    expect(result).toEqual({ name: "John" });
    expect("age" in result).toBe(false);
  });

  test("in object context - includes value when present", () => {
    const schema = object({ name: string(), age: optional(number()) });
    const result = parse(schema, { name: "John", age: 30 });
    expect(result).toEqual({ name: "John", age: 30 });
  });
});

describe("nullable schema", () => {
  test("returns null for null", () => {
    const schema = nullable(string());
    expect(parse(schema, null)).toBeNull();
  });

  test("returns null for undefined", () => {
    const schema = nullable(string());
    expect(parse(schema, undefined)).toBeNull();
  });

  test("parses non-null value", () => {
    const schema = nullable(string());
    expect(parse(schema, "hello")).toBe("hello");
  });

  test("in object context", () => {
    const schema = object({ name: nullable(string()) });
    expect(parse(schema, { name: null })).toEqual({ name: null });
  });
});

// ============================================================================
// ONEOF - PRIMITIVE HANDLING
// ============================================================================

describe("oneOf - primitive handling", () => {
  test("selects string branch for string input", () => {
    const schema = union(string(), number());
    expect(parse(schema, "hello")).toBe("hello");
  });

  test("selects number branch for number input", () => {
    const schema = union(string(), number());
    expect(parse(schema, 42)).toBe(42);
  });

  test("selects boolean branch for boolean input", () => {
    const schema = union(string(), boolean());
    expect(parse(schema, true)).toBe(true);
  });

  test("selects literal branch for matching value", () => {
    const schema = union(literal("active"), literal("inactive"));
    expect(parse(schema, "active")).toBe("active");
  });

  test("handles null with nullable", () => {
    const schema = union(nullable(string()), number());
    expect(parse(schema, null)).toBeNull();
  });

  test("primitives first - string over object", () => {
    const schema = union(string(), object({ value: string() }));
    expect(parse(schema, "hello")).toBe("hello");
  });

  test("primitives first - number over object", () => {
    const schema = union(number(), object({ value: number() }));
    expect(parse(schema, 42)).toBe(42);
  });

  test("coerces when best match requires it", () => {
    const schema = union(string(), number());
    // boolean -> should coerce to string (first viable)
    expect(parse(schema, true)).toBe("true");
  });
});

// ============================================================================
// ONEOF - OBJECT SCORING
// ============================================================================

describe("oneOf - object scoring", () => {
  test("scores by discriminator match", () => {
    const Card = object({ kind: literal("card"), number: string() }, "Card");
    const Bank = object({ kind: literal("bank"), iban: string() }, "Bank");

    const schema = union(Card, Bank);

    const result = parseWithMeta(schema, { kind: "card", number: "4242" });
    expect(result.value).toEqual({ kind: "card", number: "4242" });
    expect(result.meta.chosenName).toBe("Card");
  });

  test("scores by unique property", () => {
    const TypeA = object({ common: string(), uniqueA: string() });
    const TypeB = object({ common: string(), uniqueB: string() });

    const schema = union(TypeA, TypeB);

    const result1 = parseWithMeta(schema, { common: "x", uniqueA: "y" });
    expect(result1.meta.chosenIndex).toBe(0);

    const result2 = parseWithMeta(schema, { common: "x", uniqueB: "y" });
    expect(result2.meta.chosenIndex).toBe(1);
  });

  test("literal accepts any value of same type", () => {
    const A = object({ kind: literal("a"), value: string() });
    const B = object({ kind: literal("b"), value: string() });

    const schema = union(A, B);
    // Neither discriminator matches exactly, but "c" is still a valid string
    const result = parse(schema, { kind: "c", value: "test" });
    expect(result.kind).toBe("c"); // literal accepts any string
    expect(result.value).toBe("test");
  });

  test("defaults literal for nullish", () => {
    const A = object({ kind: literal("a"), value: string() });
    const schema = union(A);
    const result = parse(schema, { value: "test" });
    expect(result.kind).toBe("a"); // defaults to literal when missing
    expect(result.value).toBe("test");
  });

  test("type matching scores higher than just field presence", () => {
    const StringObj = object({ value: string() }, "StringObj");
    const NumberObj = object({ value: number() }, "NumberObj");

    const schema = union(StringObj, NumberObj);

    // String value should prefer StringObj
    const result1 = parseWithMeta(schema, { value: "hello" });
    expect(result1.meta.chosenName).toBe("StringObj");

    // Number value should prefer NumberObj
    const result2 = parseWithMeta(schema, { value: 42 });
    expect(result2.meta.chosenName).toBe("NumberObj");
  });
});

// ============================================================================
// ONEOF - COMPLEX REAL-WORLD SCENARIOS
// ============================================================================

describe("oneOf - real world scenarios", () => {
  test("primitives + object in oneOf", () => {
    const SomeObject = object(
      { kind: literal("someObject"), id: string() },
      "SomeObject"
    );

    const Value = union(string(), number(), SomeObject);

    type Value = Infer<typeof Value>;

    const v1 = parse(Value, "hello");
    expect(v1).toBe("hello");

    const v2 = parse(Value, 123);
    expect(v2).toBe(123);

    const v3 = parse(Value, { kind: "someObject", id: "abc" });
    expect(v3).toEqual({ kind: "someObject", id: "abc" });
  });

  test("payment method discriminator", () => {
    const Card = object({
      kind: literal("card"),
      last4: string(),
      expMonth: number(),
      expYear: number(),
    });

    const Bank = object({
      kind: literal("bank"),
      iban: string(),
    });

    const PaymentMethod = union(Card, Bank);

    const pm = parse(PaymentMethod, {
      kind: "card",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
    });
    expect(pm).toEqual({
      kind: "card",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
    });

    const bankPm = parse(PaymentMethod, {
      kind: "bank",
      iban: "GB123456789",
    });
    expect(bankPm).toEqual({
      kind: "bank",
      iban: "GB123456789",
    });
  });

  test("debugging with parseWithMeta", () => {
    const A = object({ type: literal("a"), a: string() }, "A");
    const B = object({ type: literal("b"), b: string() }, "B");

    const U = union(A, B);

    const out = parseWithMeta(U, { type: "a", a: "x", extra: 1 });

    expect(out.value).toEqual({ type: "a", a: "x", extra: 1 });
    expect(out.meta.chosenIndex).toBe(0);
    expect(out.meta.chosenName).toBe("A");
    expect(out.meta.candidates.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// UNION (SIMPLE - same as oneOf with rest params)
// ============================================================================

describe("union", () => {
  test("works like oneOf with rest params", () => {
    const schema = union(string(), number());
    expect(parse(schema, "hello")).toBe("hello");
    expect(parse(schema, 42)).toBe(42);
  });

  test("coerces when needed", () => {
    const schema = union(string(), number());
    expect(parse(schema, true)).toBe("true");
  });
});

// ============================================================================
// TYPE INFERENCE
// ============================================================================

describe("type inference", () => {
  test("infers string type", () => {
    const schema = string();
    type T = Infer<typeof schema>;
    const value: T = "hello";
    expect(value).toBe("hello");
  });

  test("infers object type", () => {
    const schema = object({
      name: string(),
      age: number(),
      active: boolean(),
    });
    type T = Infer<typeof schema>;
    const value: T = { name: "John", age: 30, active: true };
    expect(value).toEqual({ name: "John", age: 30, active: true });
  });

  test("infers optional type", () => {
    const schema = object({
      name: string(),
      nickname: optional(string()),
    });
    type T = Infer<typeof schema>;
    const value: T = { name: "John" };
    expect(value.name).toBe("John");
  });

  test("infers nullable type", () => {
    const schema = object({
      name: nullable(string()),
    });
    type T = Infer<typeof schema>;
    const value: T = { name: null };
    expect(value.name).toBeNull();
  });

  test("infers array type", () => {
    const schema = array(string());
    type T = Infer<typeof schema>;
    const value: T = ["a", "b", "c"];
    expect(value).toEqual(["a", "b", "c"]);
  });

  test("infers literal type", () => {
    const schema = literal("active");
    type T = Infer<typeof schema>;
    const value: T = "active";
    expect(value).toBe("active");
  });

  test("infers oneOf type", () => {
    const schema = union(string(), number());
    type T = Infer<typeof schema>;
    const str: T = "hello";
    const num: T = 42;
    expect(str).toBe("hello");
    expect(num).toBe(42);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("edge cases", () => {
  test("handles empty object", () => {
    const schema = object({});
    expect(parse(schema, {})).toEqual({});
  });

  test("handles empty array", () => {
    const schema = array(string());
    expect(parse(schema, [])).toEqual([]);
  });

  test("handles deeply nested structures", () => {
    const schema = object({
      level1: object({
        level2: object({
          level3: object({
            value: string(),
          }),
        }),
      }),
    });
    const result = parse(schema, {
      level1: { level2: { level3: { value: "deep" } } },
    });
    expect(result.level1.level2.level3.value).toBe("deep");
  });

  test("handles numeric string coercion", () => {
    const schema = number();
    expect(parse(schema, "42")).toBe(42);
    expect(parse(schema, "3.14")).toBe(3.14);
    expect(parse(schema, "-10")).toBe(-10);
  });

  test("handles object with all optional properties", () => {
    const schema = object({
      a: optional(string()),
      b: optional(number()),
      c: optional(boolean()),
    });
    expect(parse(schema, {})).toEqual({});
  });

  test("handles oneOf with single schema", () => {
    const schema = union(string());
    expect(parse(schema, "hello")).toBe("hello");
  });

  test("handles nested oneOf", () => {
    const Inner = union(string(), number());
    const Outer = object({ value: Inner });

    expect(parse(Outer, { value: "hello" })).toEqual({ value: "hello" });
    expect(parse(Outer, { value: 42 })).toEqual({ value: 42 });
  });

  test("null vs undefined distinction with nullable and optional", () => {
    const nullableSchema = object({ value: nullable(string()) });
    expect(parse(nullableSchema, { value: null })).toEqual({ value: null });
    expect(parse(nullableSchema, { value: "hello" })).toEqual({
      value: "hello",
    });

    const optionalSchema = object({ value: optional(string()) });
    expect(parse(optionalSchema, {})).toEqual({});
    expect(parse(optionalSchema, { value: "hello" })).toEqual({
      value: "hello",
    });
  });

  test("never throws - always returns valid value", () => {
    const schema = union(string(), number());
    // All these should work without throwing
    expect(() => parse(schema, undefined)).not.toThrow();
    expect(() => parse(schema, null)).not.toThrow();
    expect(() => parse(schema, {})).not.toThrow();
    expect(() => parse(schema, [])).not.toThrow();
    expect(() => parse(schema, Symbol())).not.toThrow();
  });

  test("schema is callable directly", () => {
    const schema = string();
    expect(schema(123)).toBe("123");
    expect(schema("hello")).toBe("hello");
  });
});

// ============================================================================
// OPEN ENUM SCENARIOS
// ============================================================================

describe("open enum behavior", () => {
  test("string literal union preserves unknown value", () => {
    // Open enum: Union[Literal["red", "green", "blue"], UnrecognizedStr]
    // In tonic: union(literal("red"), literal("green"), literal("blue"))
    const schema = union(literal("red"), literal("green"), literal("blue"));

    // Known values work
    expect(parse(schema, "red")).toBe("red");
    expect(parse(schema, "green")).toBe("green");
    expect(parse(schema, "blue")).toBe("blue");

    // Unknown value is preserved, not coerced to a known value
    expect(parse(schema, "purple")).toBe("purple");
    expect(parse(schema, "orange")).toBe("orange");
  });

  test("integer literal union preserves unknown value", () => {
    // Open enum: HeroWidth with values [480, 720, 1080]
    const schema = union(literal(480), literal(720), literal(1080));

    // Known values work
    expect(parse(schema, 480)).toBe(480);
    expect(parse(schema, 720)).toBe(720);
    expect(parse(schema, 1080)).toBe(1080);

    // Unknown value is preserved
    expect(parse(schema, 2160)).toBe(2160);
    expect(parse(schema, 360)).toBe(360);
  });

  test("object with multiple open enum fields accepts mix of known and unknown", () => {
    // Theme model with multiple open enum fields
    const Color = union(literal("red"), literal("green"), literal("blue"));
    const Icon = union(literal("tick"), literal("thumbs-up"), literal("fire"));
    const HeroWidth = union(literal(480), literal(720), literal(1080));

    const Theme = object({
      color: Color,
      icon: Icon,
      heroWidth: HeroWidth,
    });

    const result = parse(Theme, {
      color: "purple", // unknown
      icon: "tick", // known
      heroWidth: 2160, // unknown
    });

    expect(result.color).toBe("purple");
    expect(result.icon).toBe("tick");
    expect(result.heroWidth).toBe(2160);
  });

  test("union discrimination with open enum discriminators - exact match wins", () => {
    // Cat { kind: OpenEnum["cat"] } | Dog { kind: OpenEnum["dog"] }
    const Cat = object(
      { kind: literal("cat"), meow: optional(string()) },
      "Cat"
    );
    const Dog = object(
      { kind: literal("dog"), bark: optional(string()) },
      "Dog"
    );

    const schema = union(Cat, Dog);

    // Exact match on discriminator
    const catResult = parseWithMeta(schema, { kind: "cat" });
    expect(catResult.meta.chosenName).toBe("Cat");
    expect(catResult.value.kind).toBe("cat");

    const dogResult = parseWithMeta(schema, { kind: "dog" });
    expect(dogResult.meta.chosenName).toBe("Dog");
    expect(dogResult.value.kind).toBe("dog");
  });

  test("union discrimination with unknown discriminator value - falls back to first", () => {
    // When kind is unknown value, both variants accept it
    const Cat = object({ kind: literal("cat") }, "Cat");
    const Dog = object({ kind: literal("dog") }, "Dog");

    const schema = union(Cat, Dog);

    // Unknown discriminator value - both accept, first wins due to tie-break
    const result = parseWithMeta(schema, { kind: "bat" });
    expect(result.value.kind).toBe("bat"); // Value preserved
    expect(result.meta.chosenIndex).toBe(0); // First wins on tie
  });

  test("union discrimination with unknown discriminator - field coverage decides", () => {
    // Cat has more fields, should win when discriminator doesn't match either
    const Cat = object({ kind: literal("cat"), name: string() }, "Cat");
    const Dog = object({ kind: literal("dog") }, "Dog");

    const schema = union(Cat, Dog);

    // Unknown kind "bat" + has name field → Cat should win (more field coverage)
    const result = parseWithMeta(schema, { kind: "bat", name: "Bruce" });
    expect(result.meta.chosenName).toBe("Cat");
    expect(result.value.kind).toBe("bat");
    expect(result.value.name).toBe("Bruce");
  });

  test("nested objects with open enum fields - field presence decides", () => {
    const InnerA = object({ foo: literal("foo") });
    const InnerB = object({ bar: literal("bar") });

    const A = object({ inner: InnerA }, "A");
    const B = object({ inner: InnerB }, "B");

    type _TypeA = Infer<typeof A>;
    type _TypeB = Infer<typeof B>;

    const schema = union(A, B);

    // Payload has "bar" field, should match B
    const resultB = parseWithMeta(schema, { inner: { bar: "bar" } });
    expect(resultB.meta.chosenName).toBe("B");
    expect(resultB.value.inner.bar).toBe("bar");

    // Payload has "foo" field, should match A
    const resultA = parseWithMeta(schema, { inner: { foo: "foo" } });
    expect(resultA.meta.chosenName).toBe("A");
    expect(resultA.value.inner.foo).toBe("foo");
  });

  test("open enum with nested union - outer discrimination by field coverage", () => {
    // Inner union variants
    const CatInner = object({ kind: literal("cat") }, "CatInner");
    const DogInner = object({ kind: literal("dog") }, "DogInner");
    const InnerUnion = union(CatInner, DogInner);

    // Option with both kind and name fields
    const KindAndName = object({
      kind: literal("known_kind"),
      name: literal("known_name"),
    });

    const OptionA = object({ data: InnerUnion }, "OptionA");
    const OptionB = object({ data: KindAndName }, "OptionB");

    const schema = union(OptionA, OptionB);

    // Payload with unknown values + name field → OptionB should win (better field coverage)
    const result = parseWithMeta(schema, {
      data: { kind: "unknown", name: "also_unknown" },
    });
    expect(result.meta.chosenName).toBe("OptionB");
    expect(result.value.data.kind).toBe("unknown");
    expect(result.value.data.name).toBe("also_unknown");
  });

  test("open enum round-trip - unknown values survive serialization", () => {
    const Color = union(literal("red"), literal("green"), literal("blue"));
    const Theme = object({ color: Color, icon: string() });

    // Parse with unknown enum value
    const parsed = parse(Theme, { color: "purple", icon: "star" });
    expect(parsed.color).toBe("purple");

    // Serialize (just stringify)
    const json = JSON.stringify(parsed);

    // Parse again - value should be preserved
    const reparsed = parse(Theme, JSON.parse(json));
    expect(reparsed.color).toBe("purple");
    expect(reparsed.icon).toBe("star");
  });

  test("fewer unmatched fields wins over more matched fields with open enums", () => {
    const Minimal = object({ foo: string() }, "Minimal");
    const Extended = object(
      {
        foo: string(),
        bar: literal("b"),
        baz: literal("c"),
      },
      "Extended"
    );

    const schema = union(Minimal, Extended);

    // Payload only has "foo", Minimal wins (fewer missing required fields)
    const result1 = parseWithMeta(schema, { foo: "test" });
    expect(result1.meta.chosenName).toBe("Minimal");

    // Payload has all fields, Extended wins
    const result2 = parseWithMeta(schema, { foo: "test", bar: "b", baz: "c" });
    expect(result2.meta.chosenName).toBe("Extended");
  });
});

describe("stress scenarios", () => {
  test("oneOf: prefers exact literal discriminator match over unique-property match", () => {
    const A = object(
      { kind: literal("a"), common: string(), aOnly: string() },
      "A"
    );
    const B = object(
      { kind: literal("b"), common: string(), bOnly: string() },
      "B"
    );

    const schema = union(A, B);

    // Has B's unique prop but kind says "a" -> should pick A if discriminator scoring dominates.
    const out = parseWithMeta(schema, {
      kind: "a",
      common: "x",
      bOnly: "present",
    });

    expect(out.meta.chosenName).toBe("A");
    expect(out.value.kind).toBe("a");
    // Defaults for missing schema props should be injected
    expect(out.value.aOnly).toBe("");
    // Unknown keys should pass through
    expect((out.value as any).bOnly).toBe("present");
  });

  test("oneOf: deterministic tie-break when shapes are identical (index-stable)", () => {
    const S1 = object({ value: string() }, "S1");
    const S2 = object({ value: string() }, "S2");
    const schema = union(S1, S2);

    const out = parseWithMeta(schema, { value: "x" });

    // With identical fit, library should be deterministic and stable.
    // If your implementation chooses first, enforce that explicitly:
    expect(out.meta.chosenIndex).toBe(0);
    expect(out.meta.chosenName).toBe("S1");
  });

  test("oneOf: prefers native type match over match-via-coercion (string input)", () => {
    const StringObj = object({ value: string() }, "StringObj");
    const NumberObj = object({ value: number() }, "NumberObj");
    const schema = union(StringObj, NumberObj);

    // "42" can become number 42, but it is natively a string; prefer StringObj if scoring uses raw type match.
    const out = parseWithMeta(schema, { value: "42" });

    expect(out.meta.chosenName).toBe("StringObj");
    expect(out.value).toEqual({ value: "42" });
  });

  test("oneOf: deep default initialization after selection when input is empty", () => {
    const DeepA = object(
      {
        a: object({
          b: object({
            c: object({
              s: string(),
              n: number(),
              ok: boolean(),
            }),
          }),
        }),
      },
      "DeepA"
    );

    const DeepB = object({ x: string() }, "DeepB");
    const schema = union(DeepA, DeepB);

    const out = parseWithMeta(schema, {});

    // If tie resolves to first, it should deeply initialise defaults.
    expect(out.meta.chosenName).toBe("DeepA");
    expect(out.value).toEqual({
      a: { b: { c: { s: "", n: 0, ok: false } } },
    });
  });

  test("array(oneOf): mixed junk values become valid typed outputs without throwing", () => {
    const Item = union(
      object(
        { kind: literal("obj"), id: number(), tag: optional(string()) },
        "Obj"
      ),
      string(),
      number(),
      boolean(),
      array(number())
    );

    const schema = array(Item);

    const input = [
      { kind: "obj", id: "123" }, // object + coercion
      { id: "999" }, // object missing kind -> defaults kind + deep defaults
      "hello", // string
      10, // number
      true, // boolean
      ["1", 2, "nope", null, undefined], // array(number()) => elements coerced, invalid -> 0
      null, // should still return something valid
      undefined, // should still return something valid
      Symbol("x"), // should still return something valid
      { totally: "unknown" }, // should still return something valid
    ];

    const out = parse(schema, input);

    // Shape checks (don’t overfit to every coercion detail; enforce key invariants)
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(input.length);

    // The first element should parse as Obj
    expect(typeof (out[0] as any).kind).toBe("string");
    expect((out[0] as any).id).toBe(123);

    // The array branch should come out as numbers
    const arr = out[5];
    expect(Array.isArray(arr)).toBe(true);
    for (const x of arr as any[]) expect(typeof x).toBe("number");
  });

  test("oneOf: object vs array competition with nested arrays and coercion", () => {
    const AsArray = array(number());
    const AsObject = object(
      { items: array(number()), note: optional(string()) },
      "AsObject"
    );

    const schema = union(AsArray, AsObject);

    const out1 = parseWithMeta(schema, ["1", 2, "3"]);
    expect(out1.meta.chosenIndex).toBe(0);
    expect(out1.value).toEqual([1, 2, 3]);

    const out2 = parseWithMeta(schema, {
      items: ["1", 2, "bad"],
      note: 123,
      extra: true,
    });
    expect(out2.meta.chosenName).toBe("AsObject");
    expect(out2.value).toEqual({ items: [1, 2, 0], note: "123", extra: true });
  });

  test("nested oneOf inside object: multiple levels of union selection + defaults + unknown passthrough", () => {
    const Address = object(
      {
        line1: string(),
        postcode: string(),
      },
      "Address"
    );

    const Coordinates = object(
      {
        lat: number(),
        lng: number(),
      },
      "Coordinates"
    );

    const Location = union(Address, Coordinates);

    const User = object({
      id: union(number(), string()),
      location: Location,
      flags: optional(array(boolean())),
      meta: optional(object({ source: optional(string()) })),
    });

    const schema = User;

    const input = {
      id: true, // should become "true" or 1 depending on union order/scoring
      location: { lat: "51.5", lng: "-0.12", extra: "keep" },
      flags: [1, 0, "true", "", null, undefined],
      meta: "not an object",
      unknownTopLevel: { deeply: ["kept"] },
    };

    const out = parse(schema, input);

    // Invariants:
    expect(out).toHaveProperty("id");
    expect(out).toHaveProperty("location");
    expect((out as any).unknownTopLevel).toEqual({ deeply: ["kept"] });

    // Location should prefer Coordinates given lat/lng
    expect((out.location as any).lat).toBeCloseTo(51.5);
    expect((out.location as any).lng).toBeCloseTo(-0.12);
    expect((out.location as any).extra).toBe("keep");

    // flags => booleans
    expect(Array.isArray(out.flags)).toBe(true);
    for (const f of out.flags!) expect(typeof f).toBe("boolean");

    // meta was non-object; should be defaulted to object defaults (and optional behaviour respected)
    // If optional(object(...)) defaults to an object (because input provided), enforce shape:
    if (out.meta) {
      expect(typeof out.meta).toBe("object");
    }
  });

  test("optional vs nullable deep interaction: undefined should omit optional keys but null should be preserved", () => {
    const schema = object({
      a: optional(string()),
      b: nullable(string()),
      nested: object({
        c: optional(number()),
        d: nullable(number()),
      }),
    });

    const out1 = parse(schema, { b: undefined, nested: { d: undefined } });
    // a omitted
    expect("a" in out1).toBe(false);
    // b is nullable => undefined becomes null
    expect(out1.b).toBeNull();
    // nested.c omitted
    expect("c" in out1.nested).toBe(false);
    // nested.d nullable => undefined becomes null
    expect(out1.nested.d).toBeNull();

    const out2 = parse(schema, {
      a: null,
      b: null,
      nested: { c: null, d: null },
    });
    // a optional(string()) with null input: depends on your optional semantics; enforce “never throws” + deterministic output
    expect(out2.b).toBeNull();
    expect(out2.nested.d).toBeNull();
  });

  test("object with array of objects: deep defaults per element + unknown keys preserved", () => {
    const LineItem = object(
      {
        sku: string(),
        qty: number(),
        price: object({ currency: string(), amount: number() }),
      },
      "LineItem"
    );

    const Order = object(
      {
        id: string(),
        items: array(LineItem),
        customer: object({
          name: string(),
          email: optional(string()),
        }),
      },
      "Order"
    );

    const input = {
      id: 123,
      items: [
        {
          sku: "A",
          qty: "2",
          price: { currency: "GBP", amount: "9.99" },
          extra: 1,
        },
        { sku: "B" }, // missing nested structures => deep defaults
        "not an item", // should become default LineItem
      ],
      customer: "not a customer",
      extraTop: { keep: true },
    };

    const out = parse(Order, input);

    expect(out.id).toBe("123");
    expect(out.extraTop).toEqual({ keep: true });

    expect(out.items.length).toBe(3);

    expect(out.items[0]!.qty).toBe(2);
    expect(out.items[0]!.price.amount).toBeCloseTo(9.99);
    expect(out.items[0]!.extra).toBe(1);

    // Deep defaults for missing nested
    expect(out.items[1]).toEqual({
      sku: "B",
      qty: 0,
      price: { currency: "", amount: 0 },
    });

    // Non-object item -> defaulted LineItem
    expect(out.items[2]).toEqual({
      sku: "",
      qty: 0,
      price: { currency: "", amount: 0 },
    });

    // Customer was non-object -> defaults
    expect(out.customer).toEqual({ name: "" });
    expect("email" in out.customer).toBe(false);
  });

  test("large oneOf fanout: many candidates, nested, and ambiguous inputs remain deterministic", () => {
    const A = object(
      { kind: literal("a"), a: string(), common: string() },
      "A"
    );
    const B = object(
      { kind: literal("b"), b: number(), common: string() },
      "B"
    );
    const C = object(
      { kind: literal("c"), c: boolean(), common: string() },
      "C"
    );
    const D = object(
      { kind: literal("d"), d: array(number()), common: string() },
      "D"
    );
    const E = object(
      { kind: literal("e"), e: object({ nested: string() }), common: string() },
      "E"
    );

    const schema = union(A, B, C, D, E, string(), number(), boolean());

    const input = {
      kind: "d",
      common: 999,
      d: ["1", "2", "bad"],
      extra: { x: 1 },
    };

    const out = parseWithMeta(schema, input);

    expect(out.meta.chosenName).toBe("D");
    expect(out.value).toEqual({
      kind: "d",
      common: "999",
      d: [1, 2, 0],
      extra: { x: 1 },
    });
  });

  test("never throws: pathological JS values across deep nested schemas", () => {
    const schema = object({
      s: string(),
      n: number(),
      b: boolean(),
      u: union(string(), number(), object({ x: string() })),
      arr: array(union(number(), object({ y: number() }))),
      nested: object({
        maybe: optional(union(nullable(string()), number())),
      }),
    });

    const input = {
      s: Symbol("sym"),
      n: BigInt(123),
      b: "FALSE",
      u: () => "fn",
      arr: [new Date(), { y: "7" }, null, undefined, { nope: true }],
      nested: { maybe: undefined },
    };

    expect(() => parse(schema, input)).not.toThrow();

    const out = parse(schema, input);

    expect(typeof out.s).toBe("string");
    expect(typeof out.n).toBe("number");
    expect(typeof out.b).toBe("boolean");
    expect(Array.isArray(out.arr)).toBe(true);
    // optional maybe omitted
    expect("maybe" in out.nested).toBe(false);
  });
});

// ============================================================================
// SECURITY & ROBUSTNESS
// ============================================================================

describe("security issues", () => {
  test("object schema should not be vulnerable to prototype pollution via __proto__", () => {
    const schema = object({ name: string() });

    // Malicious input with __proto__ key
    const maliciousInput = JSON.parse(
      '{"name": "test", "__proto__": {"polluted": true}}'
    );

    const result = parse(schema, maliciousInput);

    // The result should NOT have __proto__ copied as an own property
    // that could pollute the prototype chain
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(
      false
    );

    // Verify a fresh object is not polluted
    const freshObj: Record<string, unknown> = {};
    expect(freshObj.polluted).toBeUndefined();
  });

  test("object schema should not copy constructor key", () => {
    const schema = object({ name: string() });

    const maliciousInput = {
      name: "test",
      constructor: { prototype: { bad: true } },
    };
    const result = parse(schema, maliciousInput);

    // constructor should not be an own property on the result
    expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(
      false
    );
  });

  test("object schema should not copy prototype key", () => {
    const schema = object({ name: string() });

    const maliciousInput = { name: "test", prototype: { evil: true } };
    const result = parse(schema, maliciousInput);

    // prototype should not be an own property on the result
    expect(Object.prototype.hasOwnProperty.call(result, "prototype")).toBe(
      false
    );
  });
});

describe("robustness issues", () => {
  test("union with no arguments should not crash", () => {
    const schema = (union as any)();
    expect(() => parse(schema, "anything")).not.toThrow();
  });

  test("union with no arguments should return undefined", () => {
    const schema = (union as any)();
    const result = parse(schema, "anything");
    expect(result).toBeUndefined();
  });

  test("parseWithMeta with empty union should not crash", () => {
    const schema = (union as any)();
    expect(() => parseWithMeta(schema, "anything")).not.toThrow();
  });

  test("deeply nested object scoring should not cause stack overflow", () => {
    // Create a deeply nested object (50 levels deep)
    const createDeepSchema = (depth: number): ReturnType<typeof object> => {
      if (depth === 0) {
        return object({ value: string() });
      }
      return object({ nested: createDeepSchema(depth - 1) });
    };

    const createDeepValue = (depth: number): Record<string, unknown> => {
      if (depth === 0) {
        return { value: "leaf" };
      }
      return { nested: createDeepValue(depth - 1) };
    };

    const DeepA = createDeepSchema(50);
    const DeepB = createDeepSchema(50);
    const schema = union(DeepA, DeepB);

    expect(() => parse(schema, createDeepValue(50))).not.toThrow();
  });

  test("early exit should not cause false positive when score accumulates past threshold", () => {
    const LotsOfFields = object(
      {
        a: string(),
        b: string(),
        c: string(),
        d: string(),
        e: string(),
        f: string(),
        g: string(),
        h: string(),
        i: string(),
        j: string(),
        k: string(),
        l: string(),
        m: string(),
        n: string(),
        o: string(),
        p: string(),
        q: string(),
        r: string(),
        s: string(),
        t: string(),
        nested1: object({ x: string(), y: string(), z: string() }),
        nested2: object({ x: string(), y: string(), z: string() }),
      },
      "LotsOfFields"
    );

    const ExactMatch = object(
      {
        kind: literal("exact"),
        value: string(),
      },
      "ExactMatch"
    );

    const schema = union(LotsOfFields, ExactMatch);

    const input = {
      kind: "exact",
      value: "test",
      a: "1",
      b: "2",
      c: "3",
      d: "4",
      e: "5",
      f: "6",
      g: "7",
      h: "8",
      i: "9",
      j: "10",
      k: "11",
      l: "12",
      m: "13",
      n: "14",
      o: "15",
      p: "16",
      q: "17",
      r: "18",
      s: "19",
      t: "20",
      nested1: { x: "a", y: "b", z: "c" },
      nested2: { x: "d", y: "e", z: "f" },
    };

    const result = parseWithMeta(schema, input);
    expect(result.meta.chosenName).toBe("ExactMatch");
  });
});
