use std::collections::BTreeMap;

use pretty_assertions::assert_eq;
use tonic_json::{DiagnosticKind, PathSegment, Value};

#[derive(Debug, PartialEq, tonic_json::Deserialize, tonic_json::Serialize)]
struct User {
    #[serde(rename = "user_id", alias = "id")]
    id: i64,
    name: String,
    email: Option<String>,
    #[tonic(additional_properties)]
    additional: BTreeMap<String, Value>,
}

#[derive(Debug, PartialEq, tonic_json::Deserialize, tonic_json::Serialize)]
struct Wrap {
    values: Vec<String>,
}

#[test]
fn from_str_syntax_error_only() {
    let err = tonic_json::from_str::<User>("{").expect_err("expected syntax error");
    let msg = err.to_string();
    assert!(msg.contains("invalid JSON syntax"));
}

#[test]
fn struct_fit_with_alias_defaults_and_unknown_capture() {
    let out = tonic_json::from_str_with_diagnostics::<User>(
        r#"{"id":"7","name":null,"role":"admin","active":true}"#,
    )
    .expect("parse should succeed");

    assert_eq!(
        out.value,
        User {
            id: 7,
            name: String::new(),
            email: None,
            additional: BTreeMap::from([
                ("active".to_string(), Value::Bool(true)),
                ("role".to_string(), Value::String("admin".to_string())),
            ]),
        }
    );

    assert!(out
        .diagnostics
        .iter()
        .any(|d| d.kind == DiagnosticKind::FieldAlias
            && d.path == vec![PathSegment::Key("id".to_string())]));
    assert!(out
        .diagnostics
        .iter()
        .any(|d| d.kind == DiagnosticKind::Default
            && d.path == vec![PathSegment::Key("name".to_string())]));

    assert_eq!(out.unknown.len(), 2);
}

#[test]
fn array_wrap_diagnostic_path_is_stable() {
    let out = tonic_json::from_str_with_diagnostics::<Wrap>(r#"{"values":"single"}"#).unwrap();
    assert_eq!(
        out.value,
        Wrap {
            values: vec!["single".to_string()],
        }
    );
    assert_eq!(out.diagnostics[0].kind, DiagnosticKind::ArrayWrap);
    assert_eq!(
        out.diagnostics[0].path,
        vec![PathSegment::Key("values".to_string())]
    );
}

#[test]
fn serialize_is_serde_like_and_does_not_fit() {
    let user = User {
        id: 42,
        name: "alice".to_string(),
        email: None,
        additional: BTreeMap::from([("role".to_string(), Value::String("admin".to_string()))]),
    };

    let value = tonic_json::to_value(&user);
    assert_eq!(
        value,
        serde_json::json!({
            "user_id": 42,
            "name": "alice",
            "role": "admin"
        })
    );
}
