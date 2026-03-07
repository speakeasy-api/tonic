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
    encoding: "utf8",
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function crateVersionIsVisible(crate) {
  try {
    const response = await fetch(`https://crates.io/api/v1/crates/${crate}`, {
      headers: {
        "user-agent": "tonic-release-script",
      },
    });

    if (response.status === 404) {
      return false;
    }

    if (!response.ok) {
      process.stdout.write(
        `warning: crates.io returned ${response.status} while checking ${crate} ${version}\n`,
      );
      return false;
    }

    const payload = await response.json();
    const publishedVersions = Array.isArray(payload.versions)
      ? payload.versions
      : [];

    return publishedVersions.some(
      (publishedVersion) => publishedVersion.num === version,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      `warning: failed to check crates.io for ${crate} ${version}: ${message}\n`,
    );
    return false;
  }
}

async function publishCrate(crate) {
  if (await crateVersionIsVisible(crate)) {
    process.stdout.write(
      `${crate} ${version} is already published on crates.io, skipping\n`,
    );
    return false;
  }

  const result = spawnSync(
    "cargo",
    ["publish", "-p", crate, "--locked", "--allow-dirty"],
    {
      encoding: "utf8",
    },
  );

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status === 0) {
    return true;
  }

  if (await crateVersionIsVisible(crate)) {
    process.stdout.write(
      `${crate} ${version} is already visible on crates.io after a failed publish attempt, continuing\n`,
    );
    return false;
  }

  process.exit(result.status ?? 1);
}

async function waitForPublishedVersion(crate) {
  const attempts = 60;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await crateVersionIsVisible(crate)) {
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

const deriveWasPublished = await publishCrate("tonic_json_derive");

if (deriveWasPublished) {
  await waitForPublishedVersion("tonic_json_derive");
}

await publishCrate("tonic_json");
