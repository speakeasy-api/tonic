# tonic

A coercing schema library for forward-compatible API consumption.

```bash
npm i @speakeasy/tonic
```

## Features

- Under 2.5kb gzipped (enforced by CI)
- Zero dependencies
- Full TypeScript inference
- Never throws

## Why this exists

Validation libraries like Zod are designed to **reject** invalid data. That's correct for validating user input at trust boundaries—you control the schema, users control the data, and you want to fail fast on bad input.

API responses are different. You control the client code, but someone else controls the server. When consuming APIs:

- Fields get added (new features ship)
- Fields get removed (deprecations happen)
- Types change (`"count": "5"` → `"count": 5`)
- Enums grow new variants (`status: "pending" | "complete"` gains `"processing"`)
- Response shapes change across versions

When Zod encounters any of these, it throws. Your application crashes. Users see error screens. You scramble to deploy a client update for a change that shouldn't have broken anything.

## What `tonic` does

Tonic coerces input to match your schema. It always produces a valid output—no exceptions. Unknown fields pass through. Missing fields get defaults. Type mismatches get converted when possible.

```typescript
import { object, string, number, parse } from "@speakeasy/tonic";

const User = object({
  id: number(),
  name: string(),
});

// All of these produce { id: 123, name: "alice" }
parse(User, { id: 123, name: "alice" }); // exact match
parse(User, { id: "123", name: "alice" }); // string → number
parse(User, { id: 123, name: "alice", role: "admin" }); // extra field preserved
parse(User, { id: 123 }); // missing string → ""
parse(User, null); // complete miss → defaults
```

## Examples

### Parsing API responses

```typescript
const ApiResponse = object({
  data: array(
    object({
      id: string(),
      createdAt: string(),
      status: literal("active"),
    })
  ),
  cursor: optional(string()),
});

// Works even if the API adds new fields or changes status values
const response = await fetch("/api/items").then((r) => r.json());
const { data, cursor } = parse(ApiResponse, response);
```

### Discriminated unions

Events, webhooks, and polymorphic responses often use a discriminator field:

```typescript
const WebhookEvent = union(
  object(
    {
      type: literal("user.created"),
      user: object({ id: string(), email: string() }),
    },
    "UserCreated"
  ),
  object({ type: literal("user.deleted"), userId: string() }, "UserDeleted"),
  object(
    { type: literal("invoice.paid"), invoiceId: string(), amount: number() },
    "InvoicePaid"
  )
);

// Known type, exact match → routes to UserDeleted
parse(WebhookEvent, { type: "user.deleted", userId: "u_123" });
// → { type: "user.deleted", userId: "u_123" }

// Known type, shape changed → routes to UserCreated, fills expected fields
// with default values
parse(WebhookEvent, { type: "user.created", userId: "u_123" });
// → { type: "user.created", userId: "u_123", user: { id: "", email: "" } }

// Known type, but payload has extra fields the schema doesn't know about
// (API added a "reason" field) → still routes correctly, extra data preserved
parse(WebhookEvent, { type: "user.deleted", userId: "u_123", reason: "spam" });
// → { type: "user.deleted", userId: "u_123", reason: "spam" }

// Unknown type → doesn't crash, coerces to closest structural match
// "user.updated" isn't in schema, but has a "user" field like UserCreated
parse(WebhookEvent, {
  type: "user.updated",
  user: { id: "u_123", email: "new@example.com" },
});
// → { type: "user.updated", user: { id: "u_123", email: "new@example.com" } }
```

### Open enums

APIs add enum values over time. A strict enum breaks when the server returns a value the client doesn't know about:

```typescript
// This is actually a union of literals, allowing any string
const Status = union(
  literal("pending"),
  literal("active"),
  literal("archived")
);

parse(Status, "pending"); // "pending" (exact match)
parse(Status, "suspended"); // "suspended" (unknown value preserved)

const Item = object({
  id: string(),
  status: Status,
});

// Unknown enum values pass through without crashing
parse(Item, { id: "123", status: "on_hold" });
// → { id: "123", status: "on_hold" }
```

### Handling missing data

When a field is missing, you get the schema's default:

```typescript
const Config = object({
  timeout: number(), // default: 0
  retries: number(), // default: 0
  debug: boolean(), // default: false
  endpoint: string(), // default: ""
});

parse(Config, {});
// → { timeout: 0, retries: 0, debug: false, endpoint: "" }

parse(Config, { timeout: 30 });
// → { timeout: 30, retries: 0, debug: false, endpoint: "" }
```

### `optional` vs `nullable`

```typescript
const Profile = object({
  name: string(),
  bio: optional(string()), // omitted from output when undefined
  avatar: nullable(string()), // null when missing
});

parse(Profile, { name: "alice" });
// → { name: "alice", avatar: null }
// Note: bio is not present in output

parse(Profile, { name: "alice", bio: undefined, avatar: undefined });
// → { name: "alice", avatar: null }
```

### Array coercion

Non-arrays become single-element arrays:

```typescript
const Tags = array(string());

parse(Tags, ["a", "b"]); // ["a", "b"]
parse(Tags, "single"); // ["single"]
parse(Tags, null); // []
```

### Type inference

```typescript
const User = object({
  id: number(),
  name: string(),
  tags: array(string()),
  settings: optional(
    object({
      theme: literal("light"),
      notifications: boolean(),
    })
  ),
});

type User = Infer<typeof User>;
// {
//   id: number;
//   name: string;
//   tags: string[];
//   settings?: { theme: "light" | string; notifications: boolean };
// }
```

## API

### Primitives

```typescript
string(); // default: ""
number(); // default: 0
boolean(); // default: false
literal(v); // default: v (accepts any value of same base type)
```

### Composites

```typescript
object({ key: schema }); // preserves extra keys
array(schema); // coerces non-arrays to single-element
optional(schema); // omits key when undefined
nullable(schema); // converts undefined to null
```

### Unions

```typescript
union(schemaA, schemaB, ...)  // scored discrimination
```

### Parsing

```typescript
parse(schema, value); // returns coerced value
parseWithMeta(schema, value); // returns { value, meta } with discrimination details
```

## Union discrimination logic

When parsing a union, Tonic scores each candidate and picks the best match.

Scores are additive. Highest total wins.

| Condition                                        | Score       |
| ------------------------------------------------ | ----------- |
| Exact literal match                              | +200        |
| Nullable schema + `null` value                   | +150        |
| Type match (`string`/`number`/`boolean`/`array`) | +80 to +100 |
| Discriminator field matches exactly              | +50         |
| Required property present                        | +5          |
| Property value matches expected type             | +2          |
| Input key exists in schema                       | +1          |
| Required property missing                        | -10         |
| Discriminator field has wrong type               | -50         |

Discrimination works recursively on nested objects:

```typescript
const A = object({ inner: object({ foo: string() }) }, "A");
const B = object({ inner: object({ bar: string() }) }, "B");
const Schema = union(A, B);

parse(Schema, { inner: { bar: "hello" } });
// Selects B because nested "bar" matches B's structure
```

### Inspecting discrimination

```typescript
const { value, meta } = parseWithMeta(Event, input);

meta.chosenIndex; // index of winning schema
meta.chosenName; // name if object schema had one
meta.candidates; // all candidates with scores
```

## Design principles

**Never throw.** Parse functions return values. Malformed input produces degraded but usable output. Your app keeps running.

**Preserve unknown data.** Extra object keys pass through unchanged. Newer API responses work with older client schemas.

**Coerce at the boundary.** Type conversion happens during parsing. After parsing, your code works with correctly-typed data.

**Defaults over nulls.** Missing primitives become zero values (`""`, `0`, `false`), not `null`. Use `nullable()` or `optional()` explicitly when you want those semantics.

**Stay small.** The entire library is under 2.5kb gzipped. SDKs ship this to end users, so size matters.

## When to Use What

| Scenario                                    | Tool  |
| ------------------------------------------- | ----- |
| Validating user form input                  | Zod   |
| Validating webhook payloads you define      | Zod   |
| Consuming external APIs                     | Tonic |
| Consuming your own APIs across version skew | Tonic |
| Config files that must be strictly correct  | Zod   |
| Config files that should degrade gracefully | Tonic |

## License

MIT
