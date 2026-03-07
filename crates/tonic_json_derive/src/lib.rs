use std::collections::HashMap;

use proc_macro::TokenStream;
use quote::{format_ident, quote};
use syn::{
    parse_macro_input, Data, DataEnum, DataStruct, DeriveInput, Field, Fields, LitStr, Path, Type,
    Variant,
};

#[derive(Clone)]
enum DefaultAttr {
    None,
    TraitDefault,
    Path(Path),
}

#[derive(Clone)]
struct FieldAttrs {
    rename: Option<String>,
    aliases: Vec<String>,
    default: DefaultAttr,
    literal: Option<LiteralAttr>,
    skip_serializing: bool,
    skip_deserializing: bool,
    additional_properties: bool,
}

impl Default for FieldAttrs {
    fn default() -> Self {
        Self {
            rename: None,
            aliases: Vec::new(),
            default: DefaultAttr::None,
            literal: None,
            skip_serializing: false,
            skip_deserializing: false,
            additional_properties: false,
        }
    }
}

#[derive(Clone)]
enum LiteralAttr {
    String(String),
    Bool(bool),
    I64(i64),
    U64(u64),
    F64(f64),
}

impl LiteralAttr {
    fn expected_value_expr(&self) -> proc_macro2::TokenStream {
        match self {
            LiteralAttr::String(v) => quote! { ::tonic_json::Value::String(#v.to_string()) },
            LiteralAttr::Bool(v) => quote! { ::tonic_json::Value::Bool(#v) },
            LiteralAttr::I64(v) => quote! { ::tonic_json::Value::Number((#v as i64).into()) },
            LiteralAttr::U64(v) => quote! { ::tonic_json::Value::Number((#v as u64).into()) },
            LiteralAttr::F64(v) => quote! {{
                match ::serde_json::Number::from_f64(#v) {
                    ::core::option::Option::Some(__n) => ::tonic_json::Value::Number(__n),
                    ::core::option::Option::None => ::tonic_json::Value::Number(0.into()),
                }
            }},
        }
    }

    fn exact_match_expr(&self) -> proc_macro2::TokenStream {
        match self {
            LiteralAttr::String(v) => {
                quote! { matches!(&__value, ::tonic_json::Value::String(__s) if __s == #v) }
            }
            LiteralAttr::Bool(v) => {
                quote! { matches!(&__value, ::tonic_json::Value::Bool(__b) if *__b == #v) }
            }
            LiteralAttr::I64(v) => {
                quote! { matches!(&__value, ::tonic_json::Value::Number(__n) if __n.as_i64() == ::core::option::Option::Some(#v)) }
            }
            LiteralAttr::U64(v) => {
                quote! { matches!(&__value, ::tonic_json::Value::Number(__n) if __n.as_u64() == ::core::option::Option::Some(#v)) }
            }
            LiteralAttr::F64(v) => {
                quote! { matches!(&__value, ::tonic_json::Value::Number(__n) if __n.as_f64().map(|__x| (__x - #v).abs() < f64::EPSILON).unwrap_or(false)) }
            }
        }
    }

    fn same_base_type_expr(&self) -> proc_macro2::TokenStream {
        match self {
            LiteralAttr::String(_) => quote! { matches!(&__value, ::tonic_json::Value::String(_)) },
            LiteralAttr::Bool(_) => quote! { matches!(&__value, ::tonic_json::Value::Bool(_)) },
            LiteralAttr::I64(_) | LiteralAttr::U64(_) | LiteralAttr::F64(_) => {
                quote! { matches!(&__value, ::tonic_json::Value::Number(_)) }
            }
        }
    }
}

#[derive(Default, Clone)]
struct VariantAttrs {
    rename: Option<String>,
    unknown: bool,
}

struct DecodeParts {
    parse_fields: Vec<proc_macro2::TokenStream>,
    init_fields: Vec<proc_macro2::TokenStream>,
    additional_parse: proc_macro2::TokenStream,
    canonical_keys: Vec<String>,
}

#[proc_macro_derive(Deserialize, attributes(tonic, serde))]
pub fn derive_deserialize(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    match &input.data {
        Data::Struct(data) => derive_struct_deserialize(&input, data).into(),
        Data::Enum(data) => derive_enum_deserialize(&input, data).into(),
        _ => syn::Error::new_spanned(
            &input.ident,
            "tonic_json::Deserialize currently supports only structs and enums",
        )
        .to_compile_error()
        .into(),
    }
}

#[proc_macro_derive(Serialize, attributes(tonic, serde))]
pub fn derive_serialize(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    match &input.data {
        Data::Struct(data) => derive_struct_serialize(&input, data).into(),
        Data::Enum(data) => derive_enum_serialize(&input, data).into(),
        _ => syn::Error::new_spanned(
            &input.ident,
            "tonic_json::Serialize currently supports only structs and enums",
        )
        .to_compile_error()
        .into(),
    }
}

fn derive_struct_deserialize(input: &DeriveInput, data: &DataStruct) -> proc_macro2::TokenStream {
    let ident = &input.ident;
    let fields = match &data.fields {
        Fields::Named(fields) => &fields.named,
        _ => {
            return syn::Error::new_spanned(
                ident,
                "tonic_json::Deserialize requires named struct fields",
            )
            .to_compile_error();
        }
    };

    let parts = match build_decode_parts(fields, false) {
        Ok(parts) => parts,
        Err(err) => return err.to_compile_error(),
    };

    let parse_fields = parts.parse_fields;
    let init_fields = parts.init_fields;
    let additional_parse = parts.additional_parse;

    quote! {
        impl ::tonic_json::Deserialize for #ident {
            fn tonic_deserialize_with_ctx(
                input: &::tonic_json::Value,
                __ctx: &mut ::tonic_json::FitContext,
            ) -> ::tonic_json::FitResult<Self> {
                let mut __score: i32 = 0;
                let mut __has_exact_discriminator = false;
                let __is_object = matches!(input, ::tonic_json::Value::Object(_));
                let mut __input = match input {
                    ::tonic_json::Value::Object(map) => map.clone(),
                    _ => ::serde_json::Map::new(),
                };

                #(#parse_fields)*

                for (k, v) in &__input {
                    __ctx.record_unknown(k.clone(), v.clone());
                }
                #additional_parse

                ::tonic_json::FitResult::new(
                    Self { #(#init_fields),* },
                    __score,
                    __has_exact_discriminator && __is_object,
                    __is_object
                )
            }
        }
    }
}

fn derive_enum_deserialize(input: &DeriveInput, data: &DataEnum) -> proc_macro2::TokenStream {
    let ident = &input.ident;
    if data.variants.is_empty() {
        return syn::Error::new_spanned(ident, "enum must have at least one variant")
            .to_compile_error();
    }

    struct VariantDecode {
        idx: usize,
        ident: syn::Ident,
        name: String,
        parse_fields: Vec<proc_macro2::TokenStream>,
        init_fields: Vec<proc_macro2::TokenStream>,
        additional_parse: proc_macro2::TokenStream,
        unique_keys: Vec<String>,
        is_unit: bool,
    }

    enum UnknownPayload {
        Unit,
        Single(Box<Type>),
    }

    struct UnknownVariant {
        idx: usize,
        ident: syn::Ident,
        name: String,
        payload: UnknownPayload,
    }

    let mut unknown_variant: Option<UnknownVariant> = None;
    let mut keys_by_variant: Vec<Vec<String>> = Vec::new();
    for (idx, variant) in data.variants.iter().enumerate() {
        let vattrs = parse_variant_attrs(variant);
        if vattrs.unknown {
            if unknown_variant.is_some() {
                return syn::Error::new_spanned(
                    variant,
                    "only one #[tonic(unknown)] enum variant is supported",
                )
                .to_compile_error();
            }
            let payload = match &variant.fields {
                Fields::Unit => UnknownPayload::Unit,
                Fields::Unnamed(fields) if fields.unnamed.len() == 1 => {
                    UnknownPayload::Single(Box::new(fields.unnamed[0].ty.clone()))
                }
                Fields::Unnamed(_) => {
                    return syn::Error::new_spanned(
                        variant,
                        "unknown variant with unnamed fields must have exactly one field",
                    )
                    .to_compile_error();
                }
                Fields::Named(_) => {
                    return syn::Error::new_spanned(
                        variant,
                        "unknown variant cannot be a named-field struct variant",
                    )
                    .to_compile_error();
                }
            };
            unknown_variant = Some(UnknownVariant {
                idx,
                ident: variant.ident.clone(),
                name: parse_variant_name(variant),
                payload,
            });
            continue;
        }

        match &variant.fields {
            Fields::Named(fields) => {
                let parts = match build_decode_parts(&fields.named, false) {
                    Ok(parts) => parts,
                    Err(err) => return err.to_compile_error(),
                };
                keys_by_variant.push(parts.canonical_keys);
            }
            Fields::Unit => keys_by_variant.push(Vec::new()),
            _ => {
                return syn::Error::new_spanned(
                    variant,
                    "tonic_json::Deserialize enums currently support named/unit variants and one unnamed unknown variant",
                )
                .to_compile_error();
            }
        }
    }

    let mut key_counts: HashMap<String, usize> = HashMap::new();
    for keys in &keys_by_variant {
        for k in keys {
            *key_counts.entry(k.clone()).or_insert(0) += 1;
        }
    }

    let mut variants = Vec::<VariantDecode>::new();
    for (idx, variant) in data.variants.iter().enumerate() {
        let vattrs = parse_variant_attrs(variant);
        if vattrs.unknown {
            continue;
        }

        let variant_name = parse_variant_name(variant);
        match &variant.fields {
            Fields::Named(fields) => {
                let parts = match build_decode_parts(&fields.named, false) {
                    Ok(parts) => parts,
                    Err(err) => return err.to_compile_error(),
                };
                let unique_keys = parts
                    .canonical_keys
                    .iter()
                    .filter(|k| key_counts.get(*k).copied().unwrap_or_default() == 1)
                    .cloned()
                    .collect();
                variants.push(VariantDecode {
                    idx,
                    ident: variant.ident.clone(),
                    name: variant_name,
                    parse_fields: parts.parse_fields,
                    init_fields: parts.init_fields,
                    additional_parse: parts.additional_parse,
                    unique_keys,
                    is_unit: false,
                });
            }
            Fields::Unit => {
                variants.push(VariantDecode {
                    idx,
                    ident: variant.ident.clone(),
                    name: variant_name,
                    parse_fields: Vec::new(),
                    init_fields: Vec::new(),
                    additional_parse: quote! {},
                    unique_keys: Vec::new(),
                    is_unit: true,
                });
            }
            Fields::Unnamed(_) => {
                return syn::Error::new_spanned(
                    variant,
                    "only #[tonic(unknown)] may be used on an unnamed enum variant in v1",
                )
                .to_compile_error();
            }
        }
    }

    let mut candidate_blocks = Vec::new();
    for v in variants {
        let idx = v.idx;
        let variant_ident = v.ident;
        let variant_name = v.name;
        let variant_name_lit = LitStr::new(&variant_name, variant_ident.span());

        if v.is_unit {
            let candidate = quote! {
                {
                    let mut __branch_ctx = __ctx.fork();
                    let __candidate = match input {
                        ::tonic_json::Value::String(__s) if __s == #variant_name_lit => {
                            ::tonic_json::FitResult::new(Self::#variant_ident, 200, true, true)
                        }
                        ::tonic_json::Value::String(__s) => {
                            __branch_ctx.diagnostic(
                                ::tonic_json::DiagnosticKind::LiteralMismatch,
                                ::tonic_json::DiagnosticDetails::Literal {
                                    expected: ::tonic_json::Value::String(#variant_name_lit.to_string()),
                                    received: ::tonic_json::Value::String(__s.clone()),
                                },
                            );
                            ::tonic_json::FitResult::new(Self::#variant_ident, 100, false, true)
                        }
                        ::tonic_json::Value::Null => {
                            __branch_ctx.diagnostic(
                                ::tonic_json::DiagnosticKind::LiteralDefault,
                                ::tonic_json::DiagnosticDetails::Literal {
                                    expected: ::tonic_json::Value::String(#variant_name_lit.to_string()),
                                    received: ::tonic_json::Value::Null,
                                },
                            );
                            ::tonic_json::FitResult::new(Self::#variant_ident, 0, false, false)
                        }
                        _ => {
                            __branch_ctx.diagnostic(
                                ::tonic_json::DiagnosticKind::LiteralCoercion,
                                ::tonic_json::DiagnosticDetails::Literal {
                                    expected: ::tonic_json::Value::String(#variant_name_lit.to_string()),
                                    received: input.clone(),
                                },
                            );
                            ::tonic_json::FitResult::new(Self::#variant_ident, 0, false, false)
                        }
                    };
                    let __select = if __best_value.is_none() {
                        true
                    } else if (__candidate.exact_match && !__best_exact)
                        || (!__best_exact && __candidate.score > __best_score)
                    {
                        true
                    } else {
                        false
                    };
                    if __select {
                        __best_value = ::core::option::Option::Some(__candidate.value);
                        __best_score = __candidate.score;
                        __best_exact = __candidate.exact_match;
                        __best_type = __candidate.type_match;
                        __best_object_variant = false;
                        __best_unit_literal_mismatch = !__candidate.exact_match && __candidate.type_match;
                        __best_index = #idx;
                        __best_name = ::core::option::Option::Some(#variant_name_lit.to_string());
                        __best_ctx = ::core::option::Option::Some(__branch_ctx);
                    }
                }
            };
            candidate_blocks.push(candidate);
            continue;
        }

        let parse_fields = v.parse_fields;
        let init_fields = v.init_fields;
        let additional_parse = v.additional_parse;
        let unique_key_lits: Vec<LitStr> = v
            .unique_keys
            .iter()
            .map(|k| LitStr::new(k, variant_ident.span()))
            .collect();

        let candidate = quote! {
            {
                let mut __branch_ctx = __ctx.fork();
                let __candidate = (|| {
                    let mut __score: i32 = 0;
                    let mut __has_exact_discriminator = false;
                    let __is_object = matches!(input, ::tonic_json::Value::Object(_));
                    let mut __input = match input {
                        ::tonic_json::Value::Object(map) => map.clone(),
                        _ => ::serde_json::Map::new(),
                    };
                    let __ctx: &mut ::tonic_json::FitContext = &mut __branch_ctx;

                    if let ::tonic_json::Value::Object(__raw_obj) = input {
                        #(
                            if __raw_obj.contains_key(#unique_key_lits) {
                                __score += 10;
                            }
                        )*
                    }

                    #(#parse_fields)*

                    for (k, v) in &__input {
                        __ctx.record_unknown(k.clone(), v.clone());
                    }
                    #additional_parse

                    ::tonic_json::FitResult::new(
                        Self::#variant_ident { #(#init_fields),* },
                        __score,
                        __has_exact_discriminator && __is_object,
                        __is_object
                    )
                })();

                let __select = if __best_value.is_none() {
                    true
                } else if (__candidate.exact_match && !__best_exact)
                    || (!__best_exact && __candidate.score > __best_score)
                {
                    true
                } else {
                    false
                };
                if __select {
                    __best_value = ::core::option::Option::Some(__candidate.value);
                    __best_score = __candidate.score;
                    __best_exact = __candidate.exact_match;
                    __best_type = __candidate.type_match;
                    __best_object_variant = true;
                    __best_unit_literal_mismatch = false;
                    __best_index = #idx;
                    __best_name = ::core::option::Option::Some(#variant_name_lit.to_string());
                    __best_ctx = ::core::option::Option::Some(__branch_ctx);
                }
            }
        };
        candidate_blocks.push(candidate);
    }

    let unknown_fallback = if let Some(u) = unknown_variant {
        let unknown_idx = u.idx;
        let unknown_ident = u.ident;
        let unknown_name_lit = LitStr::new(&u.name, unknown_ident.span());
        let parse_unknown = match u.payload {
            UnknownPayload::Unit => quote! {
                let __unknown_value = Self::#unknown_ident;
                let __unknown_score: i32 = 0;
                let __unknown_exact = false;
                let __unknown_type = false;
            },
            UnknownPayload::Single(ty) => quote! {
                let __unknown_fit = <#ty as ::tonic_json::Deserialize>::tonic_deserialize_with_ctx(input, &mut __unknown_ctx);
                let __unknown_value = Self::#unknown_ident(__unknown_fit.value);
                let __unknown_score: i32 = __unknown_fit.score;
                let __unknown_exact = __unknown_fit.exact_match;
                let __unknown_type = __unknown_fit.type_match;
            },
        };
        quote! {
            let __use_unknown = !__best_exact && (__best_score <= 0 || __best_unit_literal_mismatch);
            if __use_unknown {
                let mut __unknown_ctx = __ctx.fork();
                #parse_unknown
                __ctx.record_union_selection(
                    #unknown_idx,
                    ::core::option::Option::Some(#unknown_name_lit.to_string()),
                    ::tonic_json::UnionReason::BestScore,
                );
                __ctx.push_diagnostics(__unknown_ctx.diagnostics_from(__diag_start));
                __ctx.push_unknown(__unknown_ctx.unknown_from(__unknown_start));
                return ::tonic_json::FitResult::new(
                    __unknown_value,
                    __unknown_score,
                    __unknown_exact,
                    __unknown_type,
                );
            }
        }
    } else {
        quote! {}
    };

    quote! {
        impl ::tonic_json::Deserialize for #ident {
            fn tonic_deserialize_with_ctx(
                input: &::tonic_json::Value,
                __ctx: &mut ::tonic_json::FitContext,
            ) -> ::tonic_json::FitResult<Self> {
                let __diag_start = __ctx.diagnostics_len();
                let __unknown_start = __ctx.unknown_len();

                let mut __best_value: ::core::option::Option<Self> = ::core::option::Option::None;
                let mut __best_score: i32 = i32::MIN;
                let mut __best_exact = false;
                let mut __best_type = false;
                let mut __best_object_variant = false;
                let mut __best_unit_literal_mismatch = false;
                let mut __best_index: usize = 0;
                let mut __best_name: ::core::option::Option<String> = ::core::option::Option::None;
                let mut __best_ctx: ::core::option::Option<::tonic_json::FitContext> =
                    ::core::option::Option::None;

                #(#candidate_blocks)*
                #unknown_fallback

                let __chosen_ctx = __best_ctx.expect("enum must contain at least one variant");
                let __reason = if __best_exact {
                    ::tonic_json::UnionReason::ExactMatch
                } else if __best_type && !__best_object_variant {
                    ::tonic_json::UnionReason::TypeMatch
                } else {
                    ::tonic_json::UnionReason::BestScore
                };
                __ctx.record_union_selection(__best_index, __best_name, __reason);
                __ctx.push_diagnostics(__chosen_ctx.diagnostics_from(__diag_start));
                __ctx.push_unknown(__chosen_ctx.unknown_from(__unknown_start));

                ::tonic_json::FitResult::new(
                    __best_value.expect("enum must contain at least one variant"),
                    __best_score,
                    __best_exact,
                    __best_type,
                )
            }
        }
    }
}

fn derive_struct_serialize(input: &DeriveInput, data: &DataStruct) -> proc_macro2::TokenStream {
    let ident = &input.ident;
    let fields = match &data.fields {
        Fields::Named(fields) => &fields.named,
        _ => {
            return syn::Error::new_spanned(ident, "tonic_json::Serialize requires named fields")
                .to_compile_error();
        }
    };

    let mut writes = Vec::new();
    for field in fields {
        let Some(field_ident) = &field.ident else {
            continue;
        };
        let ty = &field.ty;
        let attrs = parse_field_attrs(field);
        if attrs.skip_serializing {
            continue;
        }
        if attrs.additional_properties {
            writes.push(quote! {
                for (k, v) in self.#field_ident.iter() {
                    __out.insert(k.clone(), v.clone());
                }
            });
            continue;
        }

        let key = attrs.rename.unwrap_or_else(|| field_ident.to_string());
        let key_lit = LitStr::new(&key, field_ident.span());
        if is_option_type(ty) {
            writes.push(quote! {
                if let ::core::option::Option::Some(__v) = &self.#field_ident {
                    __out.insert(#key_lit.to_string(), ::tonic_json::Serialize::tonic_serialize(__v));
                }
            });
        } else {
            writes.push(quote! {
                __out.insert(#key_lit.to_string(), ::tonic_json::Serialize::tonic_serialize(&self.#field_ident));
            });
        }
    }

    quote! {
        impl ::tonic_json::Serialize for #ident {
            fn tonic_serialize(&self) -> ::tonic_json::Value {
                let mut __out = ::serde_json::Map::new();
                #(#writes)*
                ::tonic_json::Value::Object(__out)
            }
        }
    }
}

fn derive_enum_serialize(input: &DeriveInput, data: &DataEnum) -> proc_macro2::TokenStream {
    let ident = &input.ident;
    let mut arms = Vec::new();

    for variant in &data.variants {
        let variant_ident = &variant.ident;
        let variant_name = parse_variant_name(variant);
        let variant_name_lit = LitStr::new(&variant_name, variant.ident.span());

        match &variant.fields {
            Fields::Unit => {
                arms.push(quote! {
                    Self::#variant_ident => ::tonic_json::Value::String(#variant_name_lit.to_string())
                });
            }
            Fields::Named(fields) => {
                let mut bindings = Vec::new();
                let mut writes = Vec::new();
                for field in &fields.named {
                    let Some(field_ident) = &field.ident else {
                        continue;
                    };
                    let ty = &field.ty;
                    let attrs = parse_field_attrs(field);
                    if attrs.skip_serializing {
                        continue;
                    }

                    bindings.push(quote! { #field_ident });
                    if attrs.additional_properties {
                        writes.push(quote! {
                            for (k, v) in #field_ident.iter() {
                                __out.insert(k.clone(), v.clone());
                            }
                        });
                        continue;
                    }

                    let key = attrs.rename.unwrap_or_else(|| field_ident.to_string());
                    let key_lit = LitStr::new(&key, field_ident.span());
                    if is_option_type(ty) {
                        writes.push(quote! {
                            if let ::core::option::Option::Some(__v) = #field_ident {
                                __out.insert(#key_lit.to_string(), ::tonic_json::Serialize::tonic_serialize(__v));
                            }
                        });
                    } else {
                        writes.push(quote! {
                            __out.insert(#key_lit.to_string(), ::tonic_json::Serialize::tonic_serialize(#field_ident));
                        });
                    }
                }

                arms.push(quote! {
                    Self::#variant_ident { #(#bindings),* } => {
                        let mut __out = ::serde_json::Map::new();
                        #(#writes)*
                        ::tonic_json::Value::Object(__out)
                    }
                });
            }
            Fields::Unnamed(fields) => {
                if fields.unnamed.len() != 1 {
                    return syn::Error::new_spanned(
                        variant,
                        "tonic_json::Serialize unnamed enum variants must have exactly one field in v1",
                    )
                    .to_compile_error();
                }
                let binding = format_ident!("__inner_{}", variant_ident.to_string().to_lowercase());
                arms.push(quote! {
                    Self::#variant_ident(#binding) => ::tonic_json::Serialize::tonic_serialize(#binding)
                });
            }
        }
    }

    quote! {
        impl ::tonic_json::Serialize for #ident {
            fn tonic_serialize(&self) -> ::tonic_json::Value {
                match self {
                    #(#arms),*
                }
            }
        }
    }
}

fn build_decode_parts(
    fields: &syn::punctuated::Punctuated<Field, syn::token::Comma>,
    no_additional_properties: bool,
) -> Result<DecodeParts, syn::Error> {
    let mut additional_field = None::<(&syn::Ident, &Type)>;
    let mut parse_fields = Vec::new();
    let mut init_fields = Vec::new();
    let mut canonical_keys = Vec::new();

    for field in fields {
        let Some(field_ident) = &field.ident else {
            continue;
        };
        let ty = &field.ty;
        let attrs = parse_field_attrs(field);

        if attrs.additional_properties {
            if no_additional_properties {
                return Err(syn::Error::new_spanned(
                    field,
                    "#[tonic(additional_properties)] is not supported on enum variants in v1",
                ));
            }
            if additional_field.is_some() {
                return Err(syn::Error::new_spanned(
                    field,
                    "only one #[tonic(additional_properties)] field is supported",
                ));
            }
            additional_field = Some((field_ident, ty));
            continue;
        }

        let rust_name = field_ident.to_string();
        let primary_key = attrs.rename.clone().unwrap_or_else(|| rust_name.clone());
        if !attrs.skip_deserializing {
            canonical_keys.push(primary_key.clone());
        }

        let aliases = attrs.aliases.clone();
        let primary_key_lit = LitStr::new(&primary_key, field_ident.span());
        let alias_lits: Vec<LitStr> = aliases
            .iter()
            .map(|a| LitStr::new(a, field_ident.span()))
            .collect();
        let raw_var = format_ident!("__raw_{}", field_ident);
        let alias_var = format_ident!("__alias_{}", field_ident);

        let default_expr = match attrs.default {
            DefaultAttr::None => {
                if let Some(literal) = &attrs.literal {
                    let expected_expr = literal.expected_value_expr();
                    quote! {
                        {
                            __score -= 10;
                            __ctx.push_key(#rust_name);
                            __ctx.diagnostic(
                                ::tonic_json::DiagnosticKind::LiteralDefault,
                                ::tonic_json::DiagnosticDetails::Literal {
                                    expected: #expected_expr,
                                    received: ::tonic_json::Value::Null,
                                },
                            );
                            let __fr = <#ty as ::tonic_json::Deserialize>::tonic_deserialize_with_ctx(&#expected_expr, __ctx);
                            __ctx.pop();
                            __fr.value
                        }
                    }
                } else if is_option_type(ty) {
                    quote! { None }
                } else {
                    quote! {
                        {
                            __score -= 10;
                            __ctx.push_key(#rust_name);
                            let __fr = <#ty as ::tonic_json::Deserialize>::tonic_deserialize_with_ctx(&::tonic_json::Value::Null, __ctx);
                            __ctx.pop();
                            __score += __fr.score;
                            __fr.value
                        }
                    }
                }
            }
            DefaultAttr::TraitDefault => quote! {
                {
                    __ctx.push_key(#rust_name);
                    __ctx.record_default(::core::any::type_name::<#ty>(), ::tonic_json::Value::String("default".to_string()));
                    __ctx.pop();
                    <#ty as ::core::default::Default>::default()
                }
            },
            DefaultAttr::Path(ref p) => quote! {
                {
                    __ctx.push_key(#rust_name);
                    __ctx.record_default(::core::any::type_name::<#ty>(), ::tonic_json::Value::String("default".to_string()));
                    __ctx.pop();
                    #p()
                }
            },
        };

        let literal_logic = if let Some(literal) = &attrs.literal {
            let expected_expr = literal.expected_value_expr();
            let exact_expr = literal.exact_match_expr();
            let same_type_expr = literal.same_base_type_expr();
            quote! {
                if #exact_expr {
                    __score += 50;
                    __has_exact_discriminator = true;
                } else if #same_type_expr {
                    __score += 5;
                    __ctx.push_key(#rust_name);
                    __ctx.diagnostic(
                        ::tonic_json::DiagnosticKind::LiteralMismatch,
                        ::tonic_json::DiagnosticDetails::Literal {
                            expected: #expected_expr,
                            received: __value.clone(),
                        },
                    );
                    __ctx.pop();
                } else {
                    __score -= 50;
                    __ctx.push_key(#rust_name);
                    __ctx.diagnostic(
                        ::tonic_json::DiagnosticKind::LiteralCoercion,
                        ::tonic_json::DiagnosticDetails::Literal {
                            expected: #expected_expr,
                            received: __value.clone(),
                        },
                    );
                    __ctx.pop();
                }
            }
        } else {
            quote! {}
        };

        let option_nullable_inner = option_nullable_inner_type(ty);
        let parse_expr = if attrs.skip_deserializing {
            quote! {
                let #field_ident: #ty = <#ty as ::core::default::Default>::default();
            }
        } else if let Some(inner_ty) = option_nullable_inner {
            quote! {
                let mut #raw_var: ::core::option::Option<::tonic_json::Value> = ::core::option::Option::None;
                let mut #alias_var: ::core::option::Option<&str> = ::core::option::Option::None;
                #(
                    if #raw_var.is_none() {
                        if let ::core::option::Option::Some(__v) = __input.remove(#alias_lits) {
                            #raw_var = ::core::option::Option::Some(__v);
                            #alias_var = ::core::option::Option::Some(#alias_lits);
                        }
                    }
                )*
                if #raw_var.is_none() {
                    if let ::core::option::Option::Some(__v) = __input.remove(#primary_key_lit) {
                        #raw_var = ::core::option::Option::Some(__v);
                    }
                }

                if let ::core::option::Option::Some(__from) = #alias_var {
                    __ctx.push_key(#rust_name);
                    __ctx.record_field_alias(__from);
                    __ctx.pop();
                }

                let #field_ident: #ty = if let ::core::option::Option::Some(__value) = #raw_var {
                    __score += 5;
                    __ctx.push_key(#rust_name);
                    let __fr = <#inner_ty as ::tonic_json::Deserialize>::tonic_deserialize_with_ctx(&__value, __ctx);
                    __ctx.pop();
                    if __fr.type_match {
                        __score += 2;
                    }
                    __score += __fr.score;
                    ::core::option::Option::Some(__fr.value)
                } else {
                    ::core::option::Option::None
                };
            }
        } else {
            quote! {
                let mut #raw_var: ::core::option::Option<::tonic_json::Value> = ::core::option::Option::None;
                let mut #alias_var: ::core::option::Option<&str> = ::core::option::Option::None;
                #(
                    if #raw_var.is_none() {
                        if let ::core::option::Option::Some(__v) = __input.remove(#alias_lits) {
                            #raw_var = ::core::option::Option::Some(__v);
                            #alias_var = ::core::option::Option::Some(#alias_lits);
                        }
                    }
                )*
                if #raw_var.is_none() {
                    if let ::core::option::Option::Some(__v) = __input.remove(#primary_key_lit) {
                        #raw_var = ::core::option::Option::Some(__v);
                    }
                }

                if let ::core::option::Option::Some(__from) = #alias_var {
                    __ctx.push_key(#rust_name);
                    __ctx.record_field_alias(__from);
                    __ctx.pop();
                }

                let #field_ident: #ty = if let ::core::option::Option::Some(__value) = #raw_var {
                    __score += 5;
                    __ctx.push_key(#rust_name);
                    let __fr = <#ty as ::tonic_json::Deserialize>::tonic_deserialize_with_ctx(&__value, __ctx);
                    __ctx.pop();
                    if __fr.type_match {
                        __score += 2;
                    }
                    __score += __fr.score;
                    #literal_logic
                    __fr.value
                } else {
                    #default_expr
                };
            }
        };

        parse_fields.push(parse_expr);
        init_fields.push(quote! { #field_ident });
    }

    let additional_parse = if let Some((field_ident, ty)) = additional_field {
        init_fields.push(quote! { #field_ident });
        quote! {
            let #field_ident: #ty = __input.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        }
    } else {
        quote! {}
    };

    Ok(DecodeParts {
        parse_fields,
        init_fields,
        additional_parse,
        canonical_keys,
    })
}

fn parse_field_attrs(field: &Field) -> FieldAttrs {
    let mut out = FieldAttrs::default();

    for attr in &field.attrs {
        let Some(name) = attr.path().get_ident().map(ToString::to_string) else {
            continue;
        };
        if name != "serde" && name != "tonic" {
            continue;
        }

        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("rename") {
                let v: LitStr = meta.value()?.parse()?;
                out.rename = Some(v.value());
                return Ok(());
            }
            if meta.path.is_ident("alias") {
                let v: LitStr = meta.value()?.parse()?;
                out.aliases.push(v.value());
                return Ok(());
            }
            if meta.path.is_ident("default") {
                if meta.input.peek(syn::Token![=]) {
                    let v: LitStr = meta.value()?.parse()?;
                    if let Ok(path) = v.parse::<Path>() {
                        out.default = DefaultAttr::Path(path);
                    }
                } else {
                    out.default = DefaultAttr::TraitDefault;
                }
                return Ok(());
            }
            if meta.path.is_ident("literal") && name == "tonic" {
                let lit: syn::Lit = meta.value()?.parse()?;
                out.literal = match lit {
                    syn::Lit::Str(v) => Some(LiteralAttr::String(v.value())),
                    syn::Lit::Bool(v) => Some(LiteralAttr::Bool(v.value)),
                    syn::Lit::Int(v) => {
                        if let Ok(n) = v.base10_parse::<i64>() {
                            Some(LiteralAttr::I64(n))
                        } else if let Ok(n) = v.base10_parse::<u64>() {
                            Some(LiteralAttr::U64(n))
                        } else {
                            None
                        }
                    }
                    syn::Lit::Float(v) => v.base10_parse::<f64>().ok().map(LiteralAttr::F64),
                    _ => None,
                };
                return Ok(());
            }
            if meta.path.is_ident("skip_serializing") {
                out.skip_serializing = true;
                return Ok(());
            }
            if meta.path.is_ident("skip_deserializing") {
                out.skip_deserializing = true;
                return Ok(());
            }
            if meta.path.is_ident("additional_properties") && name == "tonic" {
                out.additional_properties = true;
                return Ok(());
            }
            Ok(())
        });
    }

    out
}

fn parse_variant_name(variant: &Variant) -> String {
    parse_variant_attrs(variant)
        .rename
        .unwrap_or_else(|| variant.ident.to_string())
}

fn parse_variant_attrs(variant: &Variant) -> VariantAttrs {
    let mut out = VariantAttrs::default();
    for attr in &variant.attrs {
        let Some(name) = attr.path().get_ident().map(ToString::to_string) else {
            continue;
        };
        if name != "serde" && name != "tonic" {
            continue;
        }
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("rename") {
                let v: LitStr = meta.value()?.parse()?;
                out.rename = Some(v.value());
                return Ok(());
            }
            if meta.path.is_ident("unknown") && name == "tonic" {
                out.unknown = true;
                return Ok(());
            }
            if meta.path.is_ident("other") && name == "serde" {
                out.unknown = true;
                return Ok(());
            }
            Ok(())
        });
    }
    out
}

fn is_option_type(ty: &Type) -> bool {
    let Type::Path(path) = ty else {
        return false;
    };
    path.path
        .segments
        .last()
        .map(|segment| segment.ident == "Option")
        .unwrap_or(false)
}

fn option_nullable_inner_type(ty: &Type) -> Option<Type> {
    let Type::Path(path) = ty else {
        return None;
    };
    let option_seg = path.path.segments.last()?;
    if option_seg.ident != "Option" {
        return None;
    }
    let syn::PathArguments::AngleBracketed(args) = &option_seg.arguments else {
        return None;
    };
    let inner = args.args.first()?;
    let syn::GenericArgument::Type(inner_ty) = inner else {
        return None;
    };
    if !is_nullable_type(inner_ty) {
        return None;
    }
    Some(inner_ty.clone())
}

fn is_nullable_type(ty: &Type) -> bool {
    let Type::Path(path) = ty else {
        return false;
    };
    path.path
        .segments
        .last()
        .map(|segment| segment.ident == "Nullable")
        .unwrap_or(false)
}
