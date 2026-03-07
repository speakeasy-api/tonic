# Differential Parity Harness

This harness compares TypeScript tonic behavior against `tonic_json` behavior for a shared case corpus.

## Run

```bash
bun tooling/parity/compare.ts
```

The harness executes:

- `tooling/parity/ts_runner.ts` against the TypeScript implementation
- `crates/tonic_json/src/bin/parity_runner.rs` against the Rust implementation

and compares normalized `value` and `diagnostics`.

## Case Manifest

Cases are declared in `tooling/parity/cases.json`.

Each case supports:

- `id`: unique case identifier
- `input`: JSON input value
- `expected_fail` (optional): mark known gaps as tracked failures
- `note` (optional): rationale and implementation path

## Outcome Labels

- `PASS`: strict parity case passes
- `FAIL`: strict parity case fails (non-zero exit)
- `XFAIL`: expected/tracked gap
- `XPASS`: expected gap now passes; remove `expected_fail` and make strict

## Current Gap Strategy

Tracked cases should correspond to explicit roadmap items so progress can be measured by turning:

- `XFAIL -> XPASS -> PASS`
