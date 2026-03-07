use pretty_assertions::assert_eq;
use tonic_json::{DiagnosticDetails, DiagnosticKind, PathSegment, UnionReason};

#[derive(Debug, PartialEq, tonic_json::Deserialize)]
struct SharedAlias {
    #[serde(alias = "x")]
    a: String,
    #[serde(alias = "x")]
    b: String,
}

#[derive(Debug, PartialEq, tonic_json::Deserialize)]
struct AliasCollision {
    #[serde(alias = "x")]
    from_alias: String,
    x: i64,
}

#[derive(Debug, PartialEq, tonic_json::Deserialize, tonic_json::Serialize)]
enum Event {
    A { kind: String, left: String },
    B { kind: String, right: String },
}

fn union_selection(
    diagnostics: &[tonic_json::Diagnostic],
) -> (&tonic_json::Diagnostic, usize, Option<String>, UnionReason) {
    let d = diagnostics
        .iter()
        .find(|d| d.kind == DiagnosticKind::UnionSelection)
        .expect("missing union_selection diagnostic");
    let DiagnosticDetails::UnionSelection {
        chosen_index,
        chosen_name,
        reason,
    } = &d.details
    else {
        panic!("unexpected union_selection details");
    };
    (d, *chosen_index, chosen_name.clone(), *reason)
}

#[test]
fn shared_alias_first_field_consumes_second_defaults() {
    let out = tonic_json::from_str::<SharedAlias>(r#"{"x":"value"}"#).unwrap();
    assert_eq!(
        out,
        SharedAlias {
            a: "value".to_string(),
            b: String::new(),
        }
    );
}

#[test]
fn alias_collision_aliased_field_consumes_source_first() {
    let out = tonic_json::from_str::<AliasCollision>(r#"{"x":"7"}"#).unwrap();
    assert_eq!(
        out,
        AliasCollision {
            from_alias: "7".to_string(),
            x: 0,
        }
    );
}

#[test]
fn union_selection_is_first_and_picks_best_score_variant() {
    let out = tonic_json::from_str_with_diagnostics::<Event>(r#"{"kind":"z","right":"yes"}"#)
        .expect("parse should succeed");

    assert_eq!(
        out.value,
        Event::B {
            kind: "z".to_string(),
            right: "yes".to_string(),
        }
    );
    assert_eq!(out.diagnostics[0].kind, DiagnosticKind::UnionSelection);

    let (_, chosen_index, chosen_name, reason) = union_selection(&out.diagnostics);
    assert_eq!(chosen_index, 1);
    assert_eq!(chosen_name, Some("B".to_string()));
    assert_eq!(reason, UnionReason::BestScore);
}

#[test]
fn union_selection_is_deterministic_across_input_key_order() {
    let a =
        tonic_json::from_str_with_diagnostics::<Event>(r#"{"kind":"z","right":"yes","extra":1}"#)
            .unwrap();
    let b =
        tonic_json::from_str_with_diagnostics::<Event>(r#"{"extra":1,"right":"yes","kind":"z"}"#)
            .unwrap();

    assert_eq!(a.value, b.value);

    let (_, chosen_index_a, chosen_name_a, reason_a) = union_selection(&a.diagnostics);
    let (_, chosen_index_b, chosen_name_b, reason_b) = union_selection(&b.diagnostics);
    assert_eq!(chosen_index_a, chosen_index_b);
    assert_eq!(chosen_name_a, chosen_name_b);
    assert_eq!(reason_a, reason_b);
}

#[test]
fn array_wrap_diagnostic_precedes_nested_item_diagnostics() {
    #[derive(Debug, PartialEq, tonic_json::Deserialize)]
    struct Wrap {
        items: Vec<AliasCollision>,
    }

    let out = tonic_json::from_str_with_diagnostics::<Wrap>(r#"{"items":{"x":"9"}}"#).unwrap();

    assert_eq!(
        out.value,
        Wrap {
            items: vec![AliasCollision {
                from_alias: "9".to_string(),
                x: 0,
            }],
        }
    );
    assert_eq!(out.diagnostics[0].kind, DiagnosticKind::ArrayWrap);
    assert_eq!(
        out.diagnostics[0].path,
        vec![PathSegment::Key("items".to_string())]
    );
    assert_eq!(out.diagnostics[1].kind, DiagnosticKind::FieldAlias);
    assert_eq!(
        out.diagnostics[1].path,
        vec![
            PathSegment::Key("items".to_string()),
            PathSegment::Index(0),
            PathSegment::Key("from_alias".to_string())
        ]
    );
}
