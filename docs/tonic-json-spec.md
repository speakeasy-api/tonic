# tonic_json Specification (Draft v0.2)

## 1. Status

- Status: Draft
- Audience: tonic maintainers and contributors
- Goal: Define the Rust `tonic_json` API and behavior for bidirectional schema fitting with directional parity to TypeScript tonic.

## 2. Problem Statement

TypeScript tonic is currently unidirectional (input fitting only). The Rust implementation must be bidirectional and ergonomic for Rust users, while preserving tonic's forward-compatible fitting model.

Rust users should be able to parse unstable API payloads into stable Rust types and serialize stable Rust types into canonical outbound payloads without maintaining a second schema DSL.

## 3. Design Goals

- `from_str::<T>` and `to_string::<T>` style API.
- Coercion-first semantics for semantic mismatches.
- Never fail for semantic mismatch during fitting.
- Deterministic best-fit selection for ambiguous unions/enums.
- Diagnostics for fit decisions and coercions.
- Serde-parity-first attribute model.
- Own traits and derives: `tonic_json::Deserialize`, `tonic_json::Serialize`.
- Optional interop with serde and/or microserde.
- 100% directional parity with TS tonic where semantics overlap.
- Outbound behavior close to serde serialization semantics (no outbound fitting).

## 4. Non-Goals

- Byte-for-byte parity with JS for non-JSON values (`NaN`, functions, symbols) in text parsing APIs.
- Full serde feature parity in v1.
- Runtime reflection without derives.

## 5. Terminology

- Fit: Transforming input/output to satisfy a schema contract without hard failure.
- Semantic mismatch: Valid JSON that does not match expected shape/types.
- Syntax error: Invalid JSON text.
- Directional parity: Equivalent behavior to TS tonic for shared representable cases, accounting for language/runtime limits.

## 6. High-Level Architecture

- `tonic_json_core`: fit engine, scoring, diagnostics, value model, parser/serializer entrypoints.
- `tonic_json_derive`: proc-macro derives for `Serialize` and `Deserialize`.
- `tonic_json`: public facade crate re-exporting core API and derives.

The core engine is framework-agnostic. Adapters for serde/microserde are optional features.

## 7. Public API (Initial)

```rust
pub fn from_str<T: tonic_json::Deserialize>(input: &str) -> Result<T, Error>;
pub fn from_slice<T: tonic_json::Deserialize>(input: &[u8]) -> Result<T, Error>;
pub fn from_value<T: tonic_json::Deserialize>(input: Value) -> T;

pub fn from_str_with_diagnostics<T: tonic_json::Deserialize>(
    input: &str,
) -> Result<ParseResult<T>, Error>;

pub fn to_string<T: tonic_json::Serialize>(value: &T) -> Result<String, Error>;
pub fn to_value<T: tonic_json::Serialize>(value: &T) -> Value;
```

```rust
pub struct ParseResult<T> {
    pub value: T,
    pub diagnostics: Vec<Diagnostic>,
    pub unknown: UnknownStore,
}
```

Error rules:

- `from_str` and `from_slice` return `Err` on JSON syntax errors only.
- Semantic mismatch does not produce `Err`; it produces fitted values and diagnostics.
- `from_value` does not return `Err`.

## 8. Core Traits

```rust
pub trait Deserialize: Sized {
    fn tonic_deserialize(input: &Value, ctx: &mut FitContext) -> Self;
}

pub trait Serialize {
    fn tonic_serialize(&self, ctx: &mut FitContext) -> Value;
}
```

`FitContext` collects diagnostics and controls deterministic behavior.

## 9. Diagnostics Model

Diagnostics are ordered and deterministic.

```rust
pub enum DiagnosticKind {
    Coercion,
    Default,
    LiteralMismatch,
    LiteralCoercion,
    LiteralDefault,
    UnionSelection,
    FieldAlias,
    ArrayWrap,
}
```

Each diagnostic includes:

- `kind`
- `path: Vec<PathSegment>` where `PathSegment` is key or index
- `details` payload per kind

Ordering rules:

- `UnionSelection` is first for each union resolution.
- For wrapped array inputs, `ArrayWrap` appears before nested element diagnostics.
- Field paths are prepended from outer to inner in the same order as TS tonic.

## 10. Fitting Semantics (Inbound)

Primitive semantics follow TS tonic:

- `string`: pass-through strings; coerce numbers/bools; `null` or missing uses default `""`.
- `number`: pass-through finite numbers; parse numeric strings; bool to `0/1`; invalid uses default `0`.
- `boolean`: pass-through bools; `"false"` and `0` map to `false`; otherwise truthy coercion; missing or `null` defaults `false`.
- literals: exact literal scores highest; same base type passes with mismatch diagnostic; incompatible types coerce via base type.

Composite semantics:

- object:
  - parse known fields in declaration order
  - unknown keys are retained in parser metadata
  - unknown keys can be directed into a field via `#[tonic(additional_properties)]` (typically `BTreeMap<String, Value>`)
  - missing required fields default
  - alias source key is consumed before canonical field key
- array:
  - array passes through element-fitting
  - non-array non-null value is wrapped into single-element array
  - missing or `null` defaults to `[]`
- optional:
  - `Option<T>` fields map missing or `null` to `None`
  - non-`Option` fields use defaulting semantics (`#[tonic(default)]`/serde `default`) when missing

## 11. Serialization Semantics (Outbound)

Outbound behavior follows serde-like serialization semantics.

No outbound fitting is performed in v1. Typed Rust values are serialized as-is according to derive metadata.

v1 policy:

- Respect rename/tag/content/flatten/skip/default attributes with serde-compatible behavior.
- Do not run coercion/scoring/diagnostic fit logic during serialization.
- Serialize captured additional properties when present.

## 12. Enum/Union Best-Fit Scoring

Best-fit scoring is used for ambiguous enum/union deserialization.

Baseline constants (parity-aligned with TS):

- Exact literal: `+200`
- Same base type: `+100`
- Nullable + null match: `+150`
- Array type match: `+80`
- Required field present: `+5`
- Field type match: `+2`
- Required field missing: `-10`
- Field coverage: `+1`
- Discriminator exact: `+50`
- Discriminator type-only: `+5`
- Discriminator mismatch: `-50`
- Unique variant field hit: `+10`

Selection rules:

- Prefer exact match candidates.
- Otherwise choose highest score.
- Tie-break by declaration order.
- Selection reason is one of `exact_match`, `type_match`, `best_score`.

## 13. Derive Macros

Primary derives:

- `#[derive(tonic_json::Deserialize)]`
- `#[derive(tonic_json::Serialize)]`

Supported field/container attributes in v1:

- Serde-compatible baseline (primary): `rename`, `alias`, `default`, `flatten`, `tag`, `content`, `untagged`, `skip_serializing`, `skip_deserializing`, `with`.
- Tonic extensions:
  - `#[tonic(additional_properties)]`
  - `#[tonic(default)]` and `#[tonic(default = "path::fn")]` as aliases to serde default behavior.

Conflict policy:

- When both are present, `tonic(...)` overrides equivalent `serde(...)` directives.

## 14. Type Semantics for Missing vs Null

v1 intentionally follows serde-style `Option<T>` semantics instead of introducing separate TS-style `optional` and `nullable` modeling.

v1 rules:

- `Option<T>` is the primary optionality mechanism.
- Missing values and explicit `null` both map to `None` by default (serde-compatible).
- `#[tonic(default)]` or serde-compatible `default` controls missing-field defaulting for non-`Option` fields.
- A dedicated tri-state missing/null type is out of scope for v1.

## 15. Unknown Field Strategy

Unknown keys are not errors.

- Default: unknown keys are retained in parser metadata and accessible from `ParseResult`.
- `#[tonic(additional_properties)]` map field captures unknown keys directly into the decoded type.
- Captured unknown fields are serialized back by default.

## 16. microserde and serde Strategy

- Core engine remains independent of serde.
- v1 behavior and attribute semantics aim for serde compatibility first.
- `microserde` and `serde` support are optional compatibility layers.
- Derive macros are owned by `tonic_json`.
- Implementations may internally delegate to microserde/serde visitors only where it does not alter tonic fit semantics.

## 17. Determinism Guarantees

- Stable output for same input and type across runs.
- Stable diagnostic ordering.
- Stable union selection.
- Stable behavior independent of object key order in input JSON.

## 18. Parity Requirements

Parity target: directional parity against TS tonic for shared JSON-representable behavior:

- same fitted value outcomes
- same diagnostic kind and path
- same union branch selection and reason
- same deterministic ordering invariants

Additionally, v1 targets serde-compatible derive semantics for overlapping attributes and outbound serialization behavior.

Documented divergences:

- JS symbol keys: not representable in JSON parsing path.
- JS prototype pollution cases: not applicable in Rust object model.
- Non-JSON JS primitives only parity-tested via `from_value`, not `from_str`.

## 19. Test Plan

- Golden conformance suite sourced from TS behavior cases.
- Differential runner comparing TS output/diagnostics to Rust output/diagnostics.
- Determinism tests for repeated parse and shuffled key order.
- Fuzz tests for nested unions/objects/arrays.
- Roundtrip tests for `additional_properties` unknown-field preservation.

## 20. Milestones

- M1: Core primitives and object/array fitting with diagnostics.
- M2: Union best-fit scoring and deterministic selection parity.
- M3: Derive macros for structs/enums and serde-parity attr support.
- M4: Outbound serialization parity (no outbound fitting).
- M5: Differential parity suite passing with divergence report.

## 21. Open Questions

- Should metadata-retained unknown values be exposed only in `ParseResult`, or also through a thread-local/global debug hook?
- Should `#[tonic(additional_properties)]` support only object-level unknowns, or nested-path capture policies in v1?
