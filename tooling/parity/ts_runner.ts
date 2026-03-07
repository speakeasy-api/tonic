import {
  array,
  boolean,
  field,
  literal,
  nullable,
  number,
  object,
  optional,
  parseWithDiagnostics,
  string,
  union,
} from "../../packages/tonic/src/index.ts";

type CaseRequest = {
  id: string;
  input: unknown;
};

type BatchRequest = {
  cases: CaseRequest[];
};

function schemaForCase(id: string) {
  switch (id) {
    case "string_from_number":
      return string();
    case "number_from_string":
      return number();
    case "boolean_from_false_string":
      return boolean();
    case "user_alias_defaults_unknown":
      return object({
        id: field(number(), { from: "user_id" }),
        name: string(),
        email: optional(string()),
      });
    case "array_wrap":
      return object({
        values: array(string()),
      });
    case "shared_alias":
      return object({
        a: field(string(), { from: "x" }),
        b: field(string(), { from: "x" }),
      });
    case "alias_collision":
      return object({
        from_alias: field(string(), { from: "x" }),
        x: number(),
      });
    case "union_best_score":
      return union(
        object({ kind: string(), left: string() }, "A"),
        object({ kind: string(), right: string() }, "B"),
      );
    case "optional_nullable_distinction":
      return object({
        a: optional(nullable(number())),
        b: nullable(optional(number())),
      });
    case "literal_discriminator_penalty":
      return union(
        object({ kind: literal("a"), a: string() }, "A"),
        object({ kind: literal("b"), b: string() }, "B"),
      );
    default:
      throw new Error(`unknown case id: ${id}`);
  }
}

function normalizeDiagnostic(d: {
  kind: string;
  path: (string | number)[];
  details: Record<string, unknown>;
}) {
  const details = d.details ?? {};
  switch (d.kind) {
    case "coercion":
      return {
        kind: d.kind,
        path: d.path,
        details: { from: details.from, to: details.to },
      };
    case "default":
      return {
        kind: d.kind,
        path: d.path,
        details: { schema: details.schema, value: details.value },
      };
    case "literal_mismatch":
    case "literal_coercion":
    case "literal_default":
      return {
        kind: d.kind,
        path: d.path,
        details: { expected: details.expected, received: details.received },
      };
    case "union_selection":
      return {
        kind: d.kind,
        path: d.path,
        details: {
          chosenIndex: details.chosenIndex,
          chosenName: details.chosenName,
          reason: details.reason,
        },
      };
    case "field_alias":
      return {
        kind: d.kind,
        path: d.path,
        details: { from: details.from },
      };
    case "array_wrap":
      return {
        kind: d.kind,
        path: d.path,
        details: { valueType: details.valueType },
      };
    default:
      return {
        kind: d.kind,
        path: d.path,
        details,
      };
  }
}

function runCase(c: CaseRequest) {
  const schema = schemaForCase(c.id);
  const out = parseWithDiagnostics(schema, c.input);
  return {
    value: out.value,
    diagnostics: out.diagnostics.map((d) => normalizeDiagnostic(d as never)),
  };
}

async function main() {
  const raw = await new Response(Bun.stdin.stream()).text();
  const input = JSON.parse(raw) as BatchRequest;
  const results = input.cases.map((c) => ({ id: c.id, result: runCase(c) }));
  process.stdout.write(JSON.stringify(results));
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
