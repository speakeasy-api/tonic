use std::collections::BTreeMap;
use std::io::Read;

use serde_json::{json, Value};
use tonic_json::{
    Diagnostic, DiagnosticDetails, DiagnosticKind, ParseResult, PathSegment, Serialize, UnionReason,
};

#[derive(Debug, tonic_json::Deserialize, tonic_json::Serialize)]
struct UserAliasDefaultsUnknown {
    #[serde(alias = "user_id")]
    id: i64,
    name: String,
    email: Option<String>,
    #[tonic(additional_properties)]
    additional_properties: BTreeMap<String, Value>,
}

#[derive(Debug, tonic_json::Deserialize, tonic_json::Serialize)]
struct ArrayWrapCase {
    values: Vec<String>,
}

#[derive(Debug, tonic_json::Deserialize, tonic_json::Serialize)]
struct SharedAliasCase {
    #[serde(alias = "x")]
    a: String,
    #[serde(alias = "x")]
    b: String,
}

#[derive(Debug, tonic_json::Deserialize, tonic_json::Serialize)]
struct AliasCollisionCase {
    #[serde(alias = "x")]
    from_alias: String,
    x: i64,
}

#[derive(Debug, tonic_json::Deserialize, tonic_json::Serialize)]
enum UnionBestScoreCase {
    A { kind: String, left: String },
    B { kind: String, right: String },
}

#[derive(Debug, tonic_json::Deserialize, tonic_json::Serialize)]
struct OptionalNullableCase {
    a: Option<tonic_json::Nullable<i64>>,
    b: tonic_json::Nullable<Option<i64>>,
}

#[derive(Debug, tonic_json::Deserialize, tonic_json::Serialize)]
enum LiteralDiscriminatorPenaltyCase {
    A {
        #[tonic(literal = "a")]
        kind: String,
        a: String,
        #[tonic(additional_properties)]
        additional_properties: BTreeMap<String, Value>,
    },
    B {
        #[tonic(literal = "b")]
        kind: String,
        b: String,
        #[tonic(additional_properties)]
        additional_properties: BTreeMap<String, Value>,
    },
}

fn normalize_path(path: &[PathSegment]) -> Value {
    Value::Array(
        path.iter()
            .map(|p| match p {
                PathSegment::Key(k) => Value::String(k.clone()),
                PathSegment::Index(i) => json!(*i),
            })
            .collect(),
    )
}

fn normalize_kind(kind: DiagnosticKind) -> &'static str {
    match kind {
        DiagnosticKind::Coercion => "coercion",
        DiagnosticKind::Default => "default",
        DiagnosticKind::LiteralMismatch => "literal_mismatch",
        DiagnosticKind::LiteralCoercion => "literal_coercion",
        DiagnosticKind::LiteralDefault => "literal_default",
        DiagnosticKind::UnionSelection => "union_selection",
        DiagnosticKind::FieldAlias => "field_alias",
        DiagnosticKind::ArrayWrap => "array_wrap",
    }
}

fn normalize_reason(reason: UnionReason) -> &'static str {
    match reason {
        UnionReason::ExactMatch => "exact match",
        UnionReason::TypeMatch => "type match",
        UnionReason::BestScore => "best score",
    }
}

fn normalize_diagnostic(d: &Diagnostic) -> Value {
    let details = match &d.details {
        DiagnosticDetails::Coercion { from, to } => {
            json!({ "from": from, "to": to })
        }
        DiagnosticDetails::Default { schema, value } => {
            json!({ "schema": schema, "value": value })
        }
        DiagnosticDetails::Literal { expected, received } => {
            json!({ "expected": expected, "received": received })
        }
        DiagnosticDetails::UnionSelection {
            chosen_index,
            chosen_name,
            reason,
        } => {
            json!({
                "chosenIndex": chosen_index,
                "chosenName": chosen_name,
                "reason": normalize_reason(*reason),
            })
        }
        DiagnosticDetails::FieldAlias { from } => json!({ "from": from }),
        DiagnosticDetails::ArrayWrap { value_type } => json!({ "valueType": value_type }),
    };
    json!({
        "kind": normalize_kind(d.kind),
        "path": normalize_path(&d.path),
        "details": details,
    })
}

fn normalize_result<T: Serialize>(out: ParseResult<T>) -> Value {
    json!({
        "value": tonic_json::to_value(&out.value),
        "diagnostics": out.diagnostics.iter().map(normalize_diagnostic).collect::<Vec<_>>(),
    })
}

fn run_case(id: &str, input: Value) -> Value {
    match id {
        "string_from_number" => {
            normalize_result(tonic_json::from_value_with_diagnostics::<String>(input))
        }
        "number_from_string" => {
            normalize_result(tonic_json::from_value_with_diagnostics::<i64>(input))
        }
        "boolean_from_false_string" => {
            normalize_result(tonic_json::from_value_with_diagnostics::<bool>(input))
        }
        "user_alias_defaults_unknown" => {
            normalize_result(tonic_json::from_value_with_diagnostics::<
                UserAliasDefaultsUnknown,
            >(input))
        }
        "array_wrap" => normalize_result(tonic_json::from_value_with_diagnostics::<ArrayWrapCase>(
            input,
        )),
        "shared_alias" => normalize_result(tonic_json::from_value_with_diagnostics::<
            SharedAliasCase,
        >(input)),
        "alias_collision" => {
            normalize_result(tonic_json::from_value_with_diagnostics::<AliasCollisionCase>(input))
        }
        "union_best_score" => {
            normalize_result(tonic_json::from_value_with_diagnostics::<UnionBestScoreCase>(input))
        }
        "optional_nullable_distinction" => {
            normalize_result(tonic_json::from_value_with_diagnostics::<
                OptionalNullableCase,
            >(input))
        }
        "literal_discriminator_penalty" => {
            normalize_result(tonic_json::from_value_with_diagnostics::<
                LiteralDiscriminatorPenaltyCase,
            >(input))
        }
        _ => json!({ "error": format!("unknown case id: {id}") }),
    }
}

fn main() {
    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .expect("failed to read stdin");
    let parsed: Value = serde_json::from_str(&raw).expect("invalid input payload");
    let cases = parsed
        .get("cases")
        .and_then(Value::as_array)
        .expect("payload missing cases array");

    let mut out = Vec::with_capacity(cases.len());
    for case in cases {
        let id = case
            .get("id")
            .and_then(Value::as_str)
            .expect("case missing id");
        let input = case.get("input").cloned().unwrap_or(Value::Null);
        out.push(json!({
            "id": id,
            "result": run_case(id, input),
        }));
    }

    print!("{}", Value::Array(out));
}
