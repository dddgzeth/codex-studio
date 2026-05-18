import { spawnSync } from "node:child_process";

const checks = [
  ["node", ["-v"]],
  ["npm", ["-v"]],
  ["codex", ["--version"]],
  ["sqlite3", ["--version"]]
];

let failed = false;

for (const [command, args] of checks) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    console.error(`missing or broken: ${command}`);
    if (result.stderr) {
      console.error(result.stderr.trim());
    }
    continue;
  }

  console.log(`${command}: ${result.stdout.trim()}`);
}

if (failed) {
  process.exit(1);
}

console.log("environment looks ready");
