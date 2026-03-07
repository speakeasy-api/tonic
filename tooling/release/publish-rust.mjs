import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const dryRun = process.argv.includes("--dry-run");
const repoRoot = process.cwd();
const packageJsonPath = path.join(
  repoRoot,
  "packages",
  "tonic",
  "package.json",
);
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;

if (typeof version !== "string" || version.length === 0) {
  throw new Error("packages/tonic/package.json is missing a valid version");
}

function run(args) {
  const result = spawnSync("cargo", args, {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function crateVersionIsVisible(crate) {
  const result = spawnSync("cargo", ["search", crate, "--limit", "1"], {
    encoding: "utf8",
  });

  return (
    result.status === 0 && result.stdout.includes(`${crate} = "${version}"`)
  );
}

async function waitForPublishedVersion(crate) {
  const attempts = 24;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (crateVersionIsVisible(crate)) {
      return;
    }

    if (attempt < attempts) {
      process.stdout.write(
        `waiting for ${crate} ${version} to appear on crates.io (${attempt}/${attempts})\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }

  throw new Error(
    `timed out waiting for ${crate} ${version} to appear on crates.io`,
  );
}

if (dryRun) {
  run(["package", "-p", "tonic_json_derive", "--locked", "--allow-dirty"]);
  run(["check", "-p", "tonic_json", "--locked"]);
  process.exit(0);
}

run(["publish", "-p", "tonic_json_derive", "--locked", "--allow-dirty"]);
await waitForPublishedVersion("tonic_json_derive");
run(["publish", "-p", "tonic_json", "--locked", "--allow-dirty"]);
