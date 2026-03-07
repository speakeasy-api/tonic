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

writeFileSync(cargoTomlPath, `${lines.join("\n")}\n`);
