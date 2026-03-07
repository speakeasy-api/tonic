use pretty_assertions::assert_eq;
use tonic_json::{DiagnosticKind, Nullable};

#[derive(Debug, PartialEq, tonic_json::Deserialize, tonic_json::Serialize)]
struct PresenceCase {
    a: Option<Nullable<i64>>,
    b: Nullable<Option<i64>>,
}

#[test]
fn optional_nullable_missing_vs_null_vs_value() {
    let missing = tonic_json::from_str::<PresenceCase>(r#"{}"#).unwrap();
    assert_eq!(
        missing,
        PresenceCase {
            a: None,
            b: Nullable::Null
        }
    );

    let explicit_null = tonic_json::from_str::<PresenceCase>(r#"{"a":null,"b":null}"#).unwrap();
    assert_eq!(
        explicit_null,
        PresenceCase {
            a: Some(Nullable::Null),
            b: Nullable::Null
        }
    );

    let explicit_value = tonic_json::from_str::<PresenceCase>(r#"{"a":"2","b":"3"}"#).unwrap();
    assert_eq!(
        explicit_value,
        PresenceCase {
            a: Some(Nullable::Value(2)),
            b: Nullable::Value(Some(3))
        }
    );
}

#[test]
fn optional_nullable_serialize_shape() {
    let value = PresenceCase {
        a: None,
        b: Nullable::Null,
    };
    let out = tonic_json::to_value(&value);
    assert_eq!(out, serde_json::json!({ "b": null }));

    let value2 = PresenceCase {
        a: Some(Nullable::Null),
        b: Nullable::Value(Some(9)),
    };
    let out2 = tonic_json::to_value(&value2);
    assert_eq!(out2, serde_json::json!({ "a": null, "b": 9 }));
}

#[test]
fn optional_nullable_diagnostics_are_stable() {
    let out = tonic_json::from_str_with_diagnostics::<PresenceCase>(r#"{}"#).unwrap();
    assert_eq!(out.diagnostics.len(), 0);

    let out2 =
        tonic_json::from_str_with_diagnostics::<PresenceCase>(r#"{"a":"2","b":"3"}"#).unwrap();
    assert!(
        out2.diagnostics
            .iter()
            .filter(|d| d.kind == DiagnosticKind::Coercion)
            .count()
            >= 2
    );
}

#[test]
fn nullable_from_value_is_ergonomic() {
    let value = PresenceCase {
        a: Some(2.into()),
        b: Some(9).into(),
    };

    assert_eq!(
        value,
        PresenceCase {
            a: Some(Nullable::Value(2)),
            b: Nullable::Value(Some(9)),
        }
    );
}
