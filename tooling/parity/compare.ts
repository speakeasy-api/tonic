import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type CaseDef = {
  id: string;
  input: unknown;
  expected_fail?: boolean;
  note?: string;
};

type CasePayload = {
  cases: CaseDef[];
};

type RunnerResult = {
  id: string;
  result: {
    value: unknown;
    diagnostics: Array<{
      kind: string;
      path: Array<string | number>;
      details: Record<string, unknown>;
    }>;
    error?: string;
  };
};

function stable(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(stable);
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [k, val] of entries) {
      out[k] = stable(val);
    }
    return out;
  }
  return v;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  payload: CasePayload,
): RunnerResult[] {
  const proc = spawnSync(cmd, args, {
    cwd,
    input: JSON.stringify({
      cases: payload.cases.map((c) => ({ id: c.id, input: c.input })),
    }),
    encoding: "utf8",
  });

  if (proc.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed\nstdout:\n${proc.stdout}\nstderr:\n${proc.stderr}`,
    );
  }

  return JSON.parse(proc.stdout) as RunnerResult[];
}

function main() {
  const repoRoot = process.cwd();
  const casesPath = path.join(repoRoot, "tooling", "parity", "cases.json");
  const payload = JSON.parse(readFileSync(casesPath, "utf8")) as CasePayload;

  const tsResults = runCommand(
    "bun",
    ["tooling/parity/ts_runner.ts"],
    repoRoot,
    payload,
  );
  const rustResults = runCommand(
    "cargo",
    ["run", "-q", "-p", "tonic_json", "--bin", "parity_runner"],
    repoRoot,
    payload,
  );

  const tsMap = new Map(tsResults.map((r) => [r.id, r.result]));
  const rustMap = new Map(rustResults.map((r) => [r.id, r.result]));

  let strictPass = 0;
  let strictFail = 0;
  let trackedFail = 0;
  let trackedPass = 0;

  for (const c of payload.cases) {
    const ts = tsMap.get(c.id);
    const rust = rustMap.get(c.id);
    if (!ts || !rust) {
      strictFail++;
      process.stdout.write(`FAIL  ${c.id} missing result in one runner\n`);
      continue;
    }

    const valueOk = deepEqual(ts.value, rust.value);
    const diagnosticsOk = deepEqual(ts.diagnostics, rust.diagnostics);
    const ok = valueOk && diagnosticsOk;

    if (!c.expected_fail) {
      if (ok) {
        strictPass++;
        process.stdout.write(`PASS  ${c.id}\n`);
      } else {
        strictFail++;
        process.stdout.write(`FAIL  ${c.id}\n`);
        process.stdout.write(`  TS:   ${JSON.stringify(ts)}\n`);
        process.stdout.write(`  Rust: ${JSON.stringify(rust)}\n`);
      }
      continue;
    }

    if (ok) {
      trackedPass++;
      process.stdout.write(`XPASS ${c.id}\n`);
    } else {
      trackedFail++;
      process.stdout.write(`XFAIL ${c.id}\n`);
      if (c.note) {
        process.stdout.write(`  note: ${c.note}\n`);
      }
    }
  }

  process.stdout.write("\n");
  process.stdout.write(
    `Summary: strict pass ${strictPass}, strict fail ${strictFail}, tracked fail ${trackedFail}, tracked pass ${trackedPass}\n`,
  );

  if (strictFail > 0) {
    process.exit(1);
  }
}

main();
