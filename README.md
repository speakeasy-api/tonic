# tonic

A coercing schema library for forward-compatible API consumption.

```bash
npm i @speakeasy/tonic
```

## The Problem

Validation libraries like Zod are designed to **reject** invalid data. This is correct for validating user input at trust boundaries. But for API responses you control the client, not the server.

APIs evolve:

- Fields get added
- Fields get removed
- Types change (`"count": "5"` → `"count": 5`)
- Enums grow new variants
- Response shapes change across versions

When Zod encounters any of these, it throws. Your application crashes. Users see error screens. You scramble to deploy a client update.

## The Solution

Tonic **never throws**. It coerces input to match your schema, always producing a valid output. Unknown fields pass through. Missing fields get defaults. Type mismatches get converted.

```typescript
import { object, string, number, parse } from "tonic";

const User = object({
  id: number(),
  name: string(),
});

// All of these produce { id: 123, name: "alice" }
parse(User, { id: 123, name: "alice" }); // exact match
parse(User, { id: "123", name: "alice" }); // string → number coercion
parse(User, { id: 123, name: "alice", role: "admin" }); // extra field preserved
parse(User, { id: 123 }); // missing string → ""
parse(User, null); // complete miss → defaults
```

## API

### Primitives

```typescript
string(); // default: "", coerces numbers/booleans via String(), objects via JSON.stringify()
number(); // default: 0, coerces numeric strings via parseFloat(), booleans to 0/1
boolean(); // default: false, coerces "true"/"false" strings, 0/1 numbers
literal(v); // default: v, coerces to the literal's base type (string|number|boolean)
```

### Composites

```typescript
object({ key: schema }); // processes each property, preserves extra keys
array(schema); // coerces non-arrays to single-element arrays, null/undefined to []
optional(schema); // allows undefined, omits key from output when undefined
nullable(schema); // allows null, converts undefined to null
```

### Unions

```typescript
oneOf([schemaA, schemaB]); // scored discrimination (see below)
union(schemaA, schemaB); // same as oneOf, rest params syntax
```

### Parsing

```typescript
parse(schema, value); // returns coerced value
parseWithMeta(schema, value); // returns { value, meta } with discrimination details
```

### Type Inference

```typescript
type User = Infer<typeof User>; // extracts TypeScript type from schema
```

## Union Discrimination

The hard problem with unions is choosing which variant to parse into. Tonic uses a scoring algorithm that evaluates all candidates and picks the best match.

### Scoring Rules

Scores are additive. Highest total wins.

#### Type-Level Matching (Primary Signal)

| Condition                                         | Score |
| ------------------------------------------------- | ----- |
| Exact literal match (`value === schema._literal`) | +200  |
| Nullable schema + `null` value                    | +150  |
| Primitive type match (string/number/boolean)      | +100  |
| Literal with same base type                       | +100  |
| Array schema + array value                        | +80   |

#### Object Discrimination (Structural Matching)

For object schemas, Tonic examines properties:

| Condition                                                                       | Score |
| ------------------------------------------------------------------------------- | ----- |
| Discriminator field matches exactly (`type: "user"` matches `{ type: "user" }`) | +50   |
| Unique property present (key exists only in this variant)                       | +10   |
| Required property present                                                       | +5    |
| Property value matches expected type                                            | +2    |
| Input key exists in schema (field coverage)                                     | +1    |
| Required property missing                                                       | -10   |
| Discriminator field has wrong type                                              | -50   |
| Discriminator field has same type, different value                              | +5    |

#### Coercibility (Fallback Signal)

When no type match exists:

| Condition                                    | Score |
| -------------------------------------------- | ----- |
| Number schema + parseable numeric string     | +5    |
| Boolean schema + `"true"`/`"false"`/`0`/`1`  | +5    |
| String schema (anything can become a string) | +1    |

### Discrimination Example

```typescript
const Event = oneOf([
  object({ type: literal("click"), x: number(), y: number() }, "ClickEvent"),
  object({ type: literal("keypress"), key: string() }, "KeypressEvent"),
  object({ type: literal("scroll"), delta: number() }, "ScrollEvent"),
]);

// Input: { type: "click", x: 100, y: 200 }
//
// Candidate scores:
//   ClickEvent:    +50 (type="click" exact) +5 (x present) +2 (x is number) +5 (y present) +2 (y is number) = 64
//   KeypressEvent: +5 (type same base type) -10 (key missing) = -5
//   ScrollEvent:   +5 (type same base type) -10 (delta missing) = -5
//
// Winner: ClickEvent (64 points)
```

### Nested Object Scoring

Discrimination scores are computed recursively for nested objects. This means unions can be discriminated by deeply nested field structures, not just top-level properties.

```typescript
const A = object({ inner: object({ foo: string() }) }, "A");
const B = object({ inner: object({ bar: string() }) }, "B");
const schema = oneOf([A, B]);

// Correctly selects B because nested "bar" field matches B's inner shape
parse(schema, { inner: { bar: "hello" } });
```

### Open Enums

APIs often add new enum values over time. With Zod, receiving an unknown enum value throws. Tonic's `literal()` accepts any value of the same base type, making it ideal for forward-compatible "open" enums:

```typescript
// Define an open enum as a union of literals
const Color = oneOf([literal("red"), literal("green"), literal("blue")]);

parse(Color, "red"); // "red" (exact match)
parse(Color, "purple"); // "purple" (unknown value preserved)
parse(Color, 123); // "123" (coerced to string)

// Works in object schemas too
const Theme = object({
  color: Color,
  heroWidth: oneOf([literal(480), literal(720), literal(1080)]),
});

// Unknown enum values pass through unchanged
parse(Theme, { color: "purple", heroWidth: 2160 });
// → { color: "purple", heroWidth: 2160 }
```

When discriminating between object variants with open enum fields, exact literal matches score higher (+50) than same-type non-matches (+5), so known values still route correctly.

### Inspecting Discrimination

```typescript
const { value, meta } = parseWithMeta(Event, input);

meta.chosenIndex; // index of winning schema
meta.chosenName; // name if object schema had one
meta.candidates; // all candidates with scores: { index, name?, score, typeMatch }[]
```

## Design Principles

**No exceptions.** Parse functions return values, never throw. Malformed input produces degraded but usable output.

**Preserve unknown data.** Extra object keys pass through unchanged. This lets newer API responses work with older client schemas.

**Coerce at boundaries.** Type coercion happens during parsing. After parsing, your code works with correctly-typed data.

**Defaults over nulls.** Missing primitives become zero values (`""`, `0`, `false`), not `null` or `undefined`. Use `nullable()` or `optional()` explicitly when you want those semantics.

## When to Use What

| Scenario                                    | Tool  |
| ------------------------------------------- | ----- |
| Validating user form input                  | Zod   |
| Validating webhook payloads you define      | Zod   |
| Consuming third-party APIs                  | Tonic |
| Consuming your own APIs across version skew | Tonic |
| Config files that must be strictly correct  | Zod   |
| Config files that should degrade gracefully | Tonic |
