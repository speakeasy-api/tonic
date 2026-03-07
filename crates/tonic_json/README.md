<div align="center">
  <a href="https://www.speakeasy.com/" target="_blank">
    <img width="1500" height="500" alt="Speakeasy" src="https://github.com/user-attachments/assets/0e56055b-02a3-4476-9130-4be299e5a39c" />
  </a>
  <br />
  <br />
  <a href="https://speakeasy.com/docs/create-client-sdks/" target="_blank"><b>Docs</b></a>&nbsp;&nbsp;//&nbsp;&nbsp;<a href="https://go.speakeasy.com/slack" target="_blank"><b>Join us on Slack</b></a>
  <br />
  <br />
</div>

<hr />

<p align="center">
  <img src="https://raw.githubusercontent.com/speakeasy-api/tonic/main/packages/tonic/logo.svg" alt="tonic" width="128" height="128" />
  <h1 align="center"><b>tonic_json</b></h1>
  <p align="center">
    A coercing JSON schema fitting library for forward-compatible API consumption in Rust.<br />
    Fit incoming payloads into typed Rust models without turning every API change into a hard failure.
  </p>
  <p align="center">
    <a href="https://crates.io/crates/tonic_json"><img alt="crates.io" src="https://img.shields.io/crates/v/tonic_json.svg?style=for-the-badge&logo=rust"></a>
    <a href="https://docs.rs/tonic_json"><img alt="docs.rs" src="https://img.shields.io/docsrs/tonic_json?style=for-the-badge&logo=docs.rs"></a>
    <a href="https://www.rust-lang.org/"><img alt="Rust" src="https://img.shields.io/badge/Rust-2021-000000.svg?style=for-the-badge&logo=rust"></a>
    <br/>
    <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge">
    <a href="https://speakeasy.com/"><img alt="Built by Speakeasy" src="https://www.speakeasy.com/assets/badges/built-by-speakeasy.svg" /></a>
  </p>
</p>

```bash
cargo add tonic_json
```

## Features

- Coerces JSON into expected Rust shapes instead of failing on every mismatch
- Emits diagnostics for defaults, coercions, alias usage, array wrapping, and union selection
- Supports `serde` rename/alias attributes plus Tonic-specific unknown and additional-property handling
- Serializes back out like serde without re-fitting the output value

## Why this exists

Strict deserialization is a good default at trust boundaries, but it is often too brittle for long-lived API clients. Servers add fields, rename payload keys, introduce new enum variants, or change representation details over time. `tonic_json` keeps your client moving by fitting the payload into the schema you expect while telling you exactly where it had to compensate.

## Example

```rust
use std::collections::BTreeMap;

use tonic_json::{DiagnosticKind, Value};

#[derive(Debug, PartialEq, tonic_json::Deserialize, tonic_json::Serialize)]
struct User {
    #[serde(rename = "user_id", alias = "id")]
    id: i64,
    name: String,
    email: Option<String>,
    #[tonic(additional_properties)]
    additional: BTreeMap<String, Value>,
}

let out = tonic_json::from_str_with_diagnostics::<User>(
    r#"{"id":"7","name":null,"role":"admin","active":true}"#,
)
.expect("parse should succeed");

assert_eq!(out.value.id, 7);
assert_eq!(out.value.name, "");
assert_eq!(
    out.value.additional.get("role"),
    Some(&Value::String("admin".to_string()))
);
assert!(out
    .diagnostics
    .iter()
    .any(|d| d.kind == DiagnosticKind::FieldAlias));
```

## More

- Derive macros are re-exported from `tonic_json`, so most users only need this crate.
- The TypeScript runtime and the Rust runtime are kept aligned with a shared parity harness in the main repository.
