use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

extern crate self as tonic_json;

pub use serde_json::Value;
pub use tonic_json_derive::{Deserialize, Serialize};

const S_EXACT_TYPE: i32 = 100;
const S_ARRAY_MATCH: i32 = 80;
const S_NULL_MATCH: i32 = 150;
const S_COERCIBLE_STRING: i32 = 1;
const S_COERCIBLE_NUMBER: i32 = 5;
const S_COERCIBLE_BOOLEAN: i32 = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathSegment {
    Key(String),
    Index(usize),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[derive(Debug, Clone, PartialEq)]
pub enum DiagnosticDetails {
    Coercion {
        from: String,
        to: String,
    },
    Default {
        schema: String,
        value: Value,
    },
    Literal {
        expected: Value,
        received: Value,
    },
    UnionSelection {
        chosen_index: usize,
        chosen_name: Option<String>,
        reason: UnionReason,
    },
    FieldAlias {
        from: String,
    },
    ArrayWrap {
        value_type: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnionReason {
    ExactMatch,
    TypeMatch,
    BestScore,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Diagnostic {
    pub kind: DiagnosticKind,
    pub path: Vec<PathSegment>,
    pub details: DiagnosticDetails,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UnknownEntry {
    pub path: Vec<PathSegment>,
    pub key: String,
    pub value: Value,
}

pub type UnknownStore = Vec<UnknownEntry>;

#[derive(Debug, Clone, PartialEq)]
pub struct ParseResult<T> {
    pub value: T,
    pub diagnostics: Vec<Diagnostic>,
    pub unknown: UnknownStore,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Nullable<T> {
    Null,
    Value(T),
}

impl<T> From<T> for Nullable<T> {
    fn from(value: T) -> Self {
        Self::Value(value)
    }
}

impl<T> Nullable<T> {
    pub fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }

    pub fn as_ref(&self) -> Option<&T> {
        match self {
            Self::Null => None,
            Self::Value(v) => Some(v),
        }
    }
}

#[derive(Debug)]
pub enum Error {
    Syntax(serde_json::Error),
}

impl Display for Error {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Syntax(err) => write!(f, "invalid JSON syntax: {err}"),
        }
    }
}

impl std::error::Error for Error {}

#[derive(Debug, Clone, PartialEq)]
pub struct FitResult<T> {
    pub value: T,
    pub score: i32,
    pub exact_match: bool,
    pub type_match: bool,
}

impl<T> FitResult<T> {
    pub fn new(value: T, score: i32, exact_match: bool, type_match: bool) -> Self {
        Self {
            value,
            score,
            exact_match,
            type_match,
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct FitContext {
    path: Vec<PathSegment>,
    diagnostics: Vec<Diagnostic>,
    unknown: UnknownStore,
}

impl FitContext {
    pub fn fork(&self) -> Self {
        self.clone()
    }

    pub fn diagnostics_len(&self) -> usize {
        self.diagnostics.len()
    }

    pub fn unknown_len(&self) -> usize {
        self.unknown.len()
    }

    pub fn diagnostics_from(&self, start: usize) -> Vec<Diagnostic> {
        self.diagnostics[start..].to_vec()
    }

    pub fn unknown_from(&self, start: usize) -> UnknownStore {
        self.unknown[start..].to_vec()
    }

    pub fn push_diagnostics(&mut self, diagnostics: Vec<Diagnostic>) {
        self.diagnostics.extend(diagnostics);
    }

    pub fn push_unknown(&mut self, unknown: UnknownStore) {
        self.unknown.extend(unknown);
    }

    pub fn push_key(&mut self, key: impl Into<String>) {
        self.path.push(PathSegment::Key(key.into()));
    }

    pub fn push_index(&mut self, index: usize) {
        self.path.push(PathSegment::Index(index));
    }

    pub fn pop(&mut self) {
        let _ = self.path.pop();
    }

    pub fn diagnostic(&mut self, kind: DiagnosticKind, details: DiagnosticDetails) {
        self.diagnostics.push(Diagnostic {
            kind,
            path: self.path.clone(),
            details,
        });
    }

    pub fn record_default(&mut self, schema: &str, value: Value) {
        self.diagnostic(
            DiagnosticKind::Default,
            DiagnosticDetails::Default {
                schema: schema.to_string(),
                value,
            },
        );
    }

    pub fn record_coercion(&mut self, from: &str, to: &str) {
        self.diagnostic(
            DiagnosticKind::Coercion,
            DiagnosticDetails::Coercion {
                from: from.to_string(),
                to: to.to_string(),
            },
        );
    }

    pub fn record_field_alias(&mut self, from: &str) {
        self.diagnostic(
            DiagnosticKind::FieldAlias,
            DiagnosticDetails::FieldAlias {
                from: from.to_string(),
            },
        );
    }

    pub fn record_array_wrap(&mut self, value_type: &str) {
        self.diagnostic(
            DiagnosticKind::ArrayWrap,
            DiagnosticDetails::ArrayWrap {
                value_type: value_type.to_string(),
            },
        );
    }

    pub fn record_union_selection(
        &mut self,
        chosen_index: usize,
        chosen_name: Option<String>,
        reason: UnionReason,
    ) {
        self.diagnostic(
            DiagnosticKind::UnionSelection,
            DiagnosticDetails::UnionSelection {
                chosen_index,
                chosen_name,
                reason,
            },
        );
    }

    pub fn record_unknown(&mut self, key: impl Into<String>, value: Value) {
        self.unknown.push(UnknownEntry {
            path: self.path.clone(),
            key: key.into(),
            value,
        });
    }
}

pub trait Deserialize: Sized {
    fn tonic_deserialize_with_ctx(input: &Value, ctx: &mut FitContext) -> FitResult<Self>;
}

pub trait Serialize {
    fn tonic_serialize(&self) -> Value;
}

pub fn from_str<T: Deserialize>(input: &str) -> Result<T, Error> {
    let value: Value = serde_json::from_str(input).map_err(Error::Syntax)?;
    Ok(from_value(value))
}

pub fn from_slice<T: Deserialize>(input: &[u8]) -> Result<T, Error> {
    let value: Value = serde_json::from_slice(input).map_err(Error::Syntax)?;
    Ok(from_value(value))
}

pub fn from_value<T: Deserialize>(input: Value) -> T {
    let mut ctx = FitContext::default();
    T::tonic_deserialize_with_ctx(&input, &mut ctx).value
}

pub fn from_str_with_diagnostics<T: Deserialize>(input: &str) -> Result<ParseResult<T>, Error> {
    let value: Value = serde_json::from_str(input).map_err(Error::Syntax)?;
    Ok(from_value_with_diagnostics(value))
}

pub fn from_value_with_diagnostics<T: Deserialize>(input: Value) -> ParseResult<T> {
    let mut ctx = FitContext::default();
    let result = T::tonic_deserialize_with_ctx(&input, &mut ctx);
    ParseResult {
        value: result.value,
        diagnostics: ctx.diagnostics,
        unknown: ctx.unknown,
    }
}

pub fn to_value<T: Serialize>(value: &T) -> Value {
    value.tonic_serialize()
}

pub fn to_string<T: Serialize>(value: &T) -> Result<String, Error> {
    serde_json::to_string(&value.tonic_serialize()).map_err(Error::Syntax)
}

fn value_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::Number(v) => {
            if let Some(i) = v.as_i64() {
                i != 0
            } else if let Some(u) = v.as_u64() {
                u != 0
            } else if let Some(f) = v.as_f64() {
                f != 0.0
            } else {
                false
            }
        }
        Value::String(v) => !v.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

impl Deserialize for Value {
    fn tonic_deserialize_with_ctx(input: &Value, _ctx: &mut FitContext) -> FitResult<Self> {
        FitResult::new(input.clone(), S_EXACT_TYPE, false, true)
    }
}

impl Serialize for Value {
    fn tonic_serialize(&self) -> Value {
        self.clone()
    }
}

impl Deserialize for String {
    fn tonic_deserialize_with_ctx(input: &Value, ctx: &mut FitContext) -> FitResult<Self> {
        if let Value::String(v) = input {
            return FitResult::new(v.clone(), S_EXACT_TYPE, false, true);
        }

        if matches!(input, Value::Null) {
            let default = String::new();
            ctx.record_default("string", Value::String(default.clone()));
            return FitResult::new(default, S_COERCIBLE_STRING, false, false);
        }

        let rendered = match input {
            Value::Object(_) | Value::Array(_) => serde_json::to_string(input).unwrap_or_default(),
            Value::Bool(v) => v.to_string(),
            Value::Number(v) => v.to_string(),
            Value::Null => String::new(),
            Value::String(v) => v.clone(),
        };
        ctx.record_coercion(value_type_name(input), "string");
        FitResult::new(rendered, S_COERCIBLE_STRING, false, false)
    }
}

impl Serialize for String {
    fn tonic_serialize(&self) -> Value {
        Value::String(self.clone())
    }
}

impl Deserialize for bool {
    fn tonic_deserialize_with_ctx(input: &Value, ctx: &mut FitContext) -> FitResult<Self> {
        if let Value::Bool(v) = input {
            return FitResult::new(*v, S_EXACT_TYPE, false, true);
        }
        if matches!(input, Value::Null) {
            ctx.record_default("boolean", Value::Bool(false));
            return FitResult::new(false, 0, false, false);
        }

        let out = match input {
            Value::String(v) if v == "false" => false,
            Value::Number(v) if v.as_i64() == Some(0) || v.as_u64() == Some(0) => false,
            _ => truthy(input),
        };
        ctx.record_coercion(value_type_name(input), "boolean");
        FitResult::new(out, S_COERCIBLE_BOOLEAN, false, false)
    }
}

impl Serialize for bool {
    fn tonic_serialize(&self) -> Value {
        Value::Bool(*self)
    }
}

macro_rules! impl_int_deser {
    ($ty:ty, $as_method:ident) => {
        impl Deserialize for $ty {
            fn tonic_deserialize_with_ctx(input: &Value, ctx: &mut FitContext) -> FitResult<Self> {
                if matches!(input, Value::Null) {
                    ctx.record_default("number", Value::Number(0.into()));
                    return FitResult::new(0, 0, false, false);
                }
                if let Value::Number(n) = input {
                    if let Some(v) = n.$as_method() {
                        return FitResult::new(v as $ty, S_EXACT_TYPE, false, true);
                    }
                }
                if let Value::String(s) = input {
                    if let Ok(parsed) = s.parse::<$ty>() {
                        ctx.record_coercion("string", "number");
                        return FitResult::new(parsed, S_COERCIBLE_NUMBER, false, false);
                    }
                    ctx.record_default("number", Value::Number(0.into()));
                    return FitResult::new(0, 0, false, false);
                }
                if let Value::Bool(v) = input {
                    ctx.record_coercion("boolean", "number");
                    return FitResult::new(if *v { 1 } else { 0 }, 0, false, false);
                }
                ctx.record_coercion(value_type_name(input), "number");
                FitResult::new(0, 0, false, false)
            }
        }

        impl Serialize for $ty {
            fn tonic_serialize(&self) -> Value {
                Value::Number((*self).into())
            }
        }
    };
}

impl_int_deser!(i64, as_i64);
impl_int_deser!(u64, as_u64);

impl Deserialize for i32 {
    fn tonic_deserialize_with_ctx(input: &Value, ctx: &mut FitContext) -> FitResult<Self> {
        let r = i64::tonic_deserialize_with_ctx(input, ctx);
        FitResult::new(r.value as i32, r.score, r.exact_match, r.type_match)
    }
}

impl Serialize for i32 {
    fn tonic_serialize(&self) -> Value {
        Value::Number((*self as i64).into())
    }
}

impl Deserialize for u32 {
    fn tonic_deserialize_with_ctx(input: &Value, ctx: &mut FitContext) -> FitResult<Self> {
        let r = u64::tonic_deserialize_with_ctx(input, ctx);
        FitResult::new(r.value as u32, r.score, r.exact_match, r.type_match)
    }
}

impl Serialize for u32 {
    fn tonic_serialize(&self) -> Value {
        Value::Number((*self as u64).into())
    }
}

impl Deserialize for f64 {
    fn tonic_deserialize_with_ctx(input: &Value, ctx: &mut FitContext) -> FitResult<Self> {
        if matches!(input, Value::Null) {
            ctx.record_default("number", Value::Number(0.into()));
            return FitResult::new(0.0, 0, false, false);
        }
        if let Value::Number(n) = input {
            if let Some(v) = n.as_f64() {
                return FitResult::new(v, S_EXACT_TYPE, false, true);
            }
        }
        if let Value::String(s) = input {
            if let Ok(parsed) = s.parse::<f64>() {
                ctx.record_coercion("string", "number");
                return FitResult::new(parsed, S_COERCIBLE_NUMBER, false, false);
            }
            ctx.record_default("number", Value::Number(0.into()));
            return FitResult::new(0.0, 0, false, false);
        }
        if let Value::Bool(v) = input {
            ctx.record_coercion("boolean", "number");
            return FitResult::new(if *v { 1.0 } else { 0.0 }, 0, false, false);
        }
        ctx.record_coercion(value_type_name(input), "number");
        FitResult::new(0.0, 0, false, false)
    }
}

impl Serialize for f64 {
    fn tonic_serialize(&self) -> Value {
        match serde_json::Number::from_f64(*self) {
            Some(n) => Value::Number(n),
            None => Value::Number(0.into()),
        }
    }
}

impl<T: Deserialize> Deserialize for Option<T> {
    fn tonic_deserialize_with_ctx(input: &Value, ctx: &mut FitContext) -> FitResult<Self> {
        if matches!(input, Value::Null) {
            return FitResult::new(None, S_EXACT_TYPE, false, true);
        }
        let inner = T::tonic_deserialize_with_ctx(input, ctx);
        FitResult::new(
            Some(inner.value),
            inner.score,
            inner.exact_match,
            inner.type_match,
        )
    }
}

impl<T: Serialize> Serialize for Option<T> {
    fn tonic_serialize(&self) -> Value {
        match self {
            Some(v) => v.tonic_serialize(),
            None => Value::Null,
        }
    }
}

impl<T: Deserialize> Deserialize for Nullable<T> {
    fn tonic_deserialize_with_ctx(input: &Value, ctx: &mut FitContext) -> FitResult<Self> {
        if matches!(input, Value::Null) {
            return FitResult::new(Nullable::Null, S_NULL_MATCH, true, true);
        }
        let inner = T::tonic_deserialize_with_ctx(input, ctx);
        FitResult::new(
            Nullable::Value(inner.value),
            inner.score,
            inner.exact_match,
            inner.type_match,
        )
    }
}

impl<T: Serialize> Serialize for Nullable<T> {
    fn tonic_serialize(&self) -> Value {
        match self {
            Nullable::Null => Value::Null,
            Nullable::Value(v) => v.tonic_serialize(),
        }
    }
}

impl<T: Deserialize> Deserialize for Vec<T> {
    fn tonic_deserialize_with_ctx(input: &Value, ctx: &mut FitContext) -> FitResult<Self> {
        if let Value::Array(items) = input {
            let mut out = Vec::with_capacity(items.len());
            let mut score = S_ARRAY_MATCH;
            let mut exact = true;
            for (idx, item) in items.iter().enumerate() {
                ctx.push_index(idx);
                let inner = T::tonic_deserialize_with_ctx(item, ctx);
                ctx.pop();
                score += inner.score;
                if !inner.exact_match {
                    exact = false;
                }
                out.push(inner.value);
            }
            return FitResult::new(out, score, exact, true);
        }

        if matches!(input, Value::Null) {
            ctx.record_default("array", Value::Array(Vec::new()));
            return FitResult::new(Vec::new(), 0, false, false);
        }

        ctx.record_array_wrap(value_type_name(input));
        ctx.push_index(0);
        let inner = T::tonic_deserialize_with_ctx(input, ctx);
        ctx.pop();
        FitResult::new(vec![inner.value], inner.score, false, false)
    }
}

impl<T: Serialize> Serialize for Vec<T> {
    fn tonic_serialize(&self) -> Value {
        Value::Array(self.iter().map(|v| v.tonic_serialize()).collect())
    }
}

impl Deserialize for BTreeMap<String, Value> {
    fn tonic_deserialize_with_ctx(input: &Value, _ctx: &mut FitContext) -> FitResult<Self> {
        match input {
            Value::Object(obj) => {
                let mut out = BTreeMap::new();
                for (k, v) in obj {
                    out.insert(k.clone(), v.clone());
                }
                FitResult::new(out, S_EXACT_TYPE, false, true)
            }
            _ => FitResult::new(BTreeMap::new(), 0, false, false),
        }
    }
}

impl Serialize for BTreeMap<String, Value> {
    fn tonic_serialize(&self) -> Value {
        let mut map = serde_json::Map::new();
        for (k, v) in self {
            map.insert(k.clone(), v.clone());
        }
        Value::Object(map)
    }
}
