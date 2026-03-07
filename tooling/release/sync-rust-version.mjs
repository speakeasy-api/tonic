import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const packageJsonPath = path.join(
  repoRoot,
  "packages",
  "tonic",
  "package.json",
);
const cargoTomlPath = path.join(repoRoot, "Cargo.toml");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;

if (typeof version !== "string" || version.length === 0) {
  throw new Error("packages/tonic/package.json is missing a valid version");
}

const cargoToml = readFileSync(cargoTomlPath, "utf8");
const lines = cargoToml.split("\n");

let section = "";
let updatedWorkspaceVersion = false;
let updatedDeriveDependencyVersion = false;

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];

  if (line.startsWith("[") && line.endsWith("]")) {
    section = line;
    continue;
  }

  if (section === "[workspace.package]" && line.startsWith("version = ")) {
    lines[index] = `version = "${version}"`;
    updatedWorkspaceVersion = true;
    continue;
  }

  if (
    section === "[workspace.dependencies]" &&
    line.startsWith("tonic_json_derive = ")
  ) {
    lines[index] =
      `tonic_json_derive = { version = "${version}", path = "crates/tonic_json_derive" }`;
    updatedDeriveDependencyVersion = true;
  }
}

if (!updatedWorkspaceVersion || !updatedDeriveDependencyVersion) {
  throw new Error("failed to update Cargo.toml version fields");
}

const updatedCargoToml = lines.join("\n");

writeFileSync(
  cargoTomlPath,
  updatedCargoToml.endsWith("\n") ? updatedCargoToml : `${updatedCargoToml}\n`,
);

function runCargo(args) {
  const result = spawnSync("cargo", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  });

  return {
    status: result.status ?? 1,
    error: result.stderr || result.stdout || `cargo ${args.join(" ")} failed`,
  };
}

const offlineRefresh = runCargo(["update", "--workspace", "--offline"]);

if (offlineRefresh.status !== 0) {
  const onlineRefresh = runCargo(["update", "--workspace"]);

  if (onlineRefresh.status !== 0) {
    throw new Error(
      `failed to refresh Cargo.lock\n\n${onlineRefresh.error.trim()}`,
    );
  }
}
