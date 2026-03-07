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
  <h1 align="center"><b>tonic_json_derive</b></h1>
  <p align="center">
    Proc-macro derives for Tonic's Rust schema fitting runtime.<br />
    Power `tonic_json` with forward-compatible deserialization and serde-like serialization.
  </p>
  <p align="center">
    <a href="https://crates.io/crates/tonic_json_derive"><img alt="crates.io" src="https://img.shields.io/crates/v/tonic_json_derive.svg?style=for-the-badge&logo=rust"></a>
    <a href="https://docs.rs/tonic_json_derive"><img alt="docs.rs" src="https://img.shields.io/docsrs/tonic_json_derive?style=for-the-badge&logo=docs.rs"></a>
    <a href="https://www.rust-lang.org/"><img alt="Rust" src="https://img.shields.io/badge/Rust-2021-000000.svg?style=for-the-badge&logo=rust"></a>
    <br/>
    <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge">
    <a href="https://speakeasy.com/"><img alt="Built by Speakeasy" src="https://www.speakeasy.com/assets/badges/built-by-speakeasy.svg" /></a>
  </p>
</p>

```bash
cargo add tonic_json
```

## What this crate does

`tonic_json_derive` provides the derives used by the Rust runtime:

- `#[derive(tonic_json::Deserialize)]`
- `#[derive(tonic_json::Serialize)]`

Most users should depend on `tonic_json` directly. It re-exports these macros and includes the runtime traits and helpers they target.

## Supported Attributes

- `#[serde(rename = "...", alias = "...", default)]`
- `#[serde(skip_serializing, skip_deserializing)]`
- `#[tonic(additional_properties)]`
- `#[tonic(unknown)]`
- `#[tonic(literal = "...")]`

## Example

```rust
use std::collections::BTreeMap;

use tonic_json::Value;

#[derive(Debug, tonic_json::Deserialize, tonic_json::Serialize)]
struct User {
    #[serde(alias = "user_id")]
    id: i64,
    name: String,
    #[tonic(additional_properties)]
    additional: BTreeMap<String, Value>,
}

#[derive(Debug, tonic_json::Deserialize, tonic_json::Serialize)]
enum Status {
    Pending,
    Active,
    #[tonic(unknown)]
    Unknown(String),
}
```

## More

- Use `tonic_json` when you want the full runtime plus the derives.
- The main repository also contains the original TypeScript package and a shared parity harness to keep both runtimes aligned.
