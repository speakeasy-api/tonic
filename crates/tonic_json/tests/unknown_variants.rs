use pretty_assertions::assert_eq;
use tonic_json::{DiagnosticDetails, DiagnosticKind, UnionReason, Value};

#[derive(Debug, PartialEq, tonic_json::Deserialize, tonic_json::Serialize)]
enum Status {
    Pending,
    Active,
    #[tonic(unknown)]
    Unknown(String),
}

#[derive(Debug, PartialEq, tonic_json::Deserialize, tonic_json::Serialize)]
enum Event {
    UserCreated {
        kind: String,
        id: String,
    },
    UserDeleted {
        kind: String,
        user_id: String,
    },
    #[tonic(unknown)]
    Unknown(Value),
}

fn union_selection(diagnostics: &[tonic_json::Diagnostic]) -> (usize, Option<String>, UnionReason) {
    let d = diagnostics
        .iter()
        .find(|d| d.kind == DiagnosticKind::UnionSelection)
        .expect("missing union_selection");
    let DiagnosticDetails::UnionSelection {
        chosen_index,
        chosen_name,
        reason,
    } = &d.details
    else {
        panic!("unexpected diagnostic details");
    };
    (*chosen_index, chosen_name.clone(), *reason)
}

#[test]
fn open_enum_unknown_value_maps_to_unknown_variant() {
    let out = tonic_json::from_str_with_diagnostics::<Status>(r#""paused""#).unwrap();
    assert_eq!(out.value, Status::Unknown("paused".to_string()));
    assert_eq!(out.diagnostics[0].kind, DiagnosticKind::UnionSelection);
    let (idx, name, reason) = union_selection(&out.diagnostics);
    assert_eq!(idx, 2);
    assert_eq!(name, Some("Unknown".to_string()));
    assert_eq!(reason, UnionReason::BestScore);
}

#[test]
fn open_enum_known_value_still_maps_to_known_variant() {
    let out = tonic_json::from_str::<Status>(r#""Pending""#).unwrap();
    assert_eq!(out, Status::Pending);
}

#[test]
fn unknown_variant_preserves_raw_union_payload() {
    let out = tonic_json::from_str_with_diagnostics::<Event>(r#"{"type":"mystery","foo":1}"#)
        .expect("parse should succeed");
    assert_eq!(
        out.value,
        Event::Unknown(serde_json::json!({"type":"mystery","foo":1}))
    );
    assert_eq!(out.diagnostics[0].kind, DiagnosticKind::UnionSelection);
    let (idx, name, reason) = union_selection(&out.diagnostics);
    assert_eq!(idx, 2);
    assert_eq!(name, Some("Unknown".to_string()));
    assert_eq!(reason, UnionReason::BestScore);
}

#[test]
fn unknown_variant_roundtrips_payload_on_serialize() {
    let event = Event::Unknown(serde_json::json!({"type":"new.kind","x":true}));
    let value = tonic_json::to_value(&event);
    assert_eq!(value, serde_json::json!({"type":"new.kind","x":true}));
}
