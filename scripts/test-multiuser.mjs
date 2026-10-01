import { spawn } from "node:child_process";
const flag = process.argv.indexOf("--url");
const url = flag >= 0 ? process.argv[flag + 1] : "http://localhost:3000";
const child = spawn(process.execPath, ["--test", "tests/backend.integration.test.mjs"], {
  cwd: new URL("..", import.meta.url), stdio: "inherit",
  env: { ...process.env, DIANTUO_TEST_URL: url },
});
child.on("exit", code => { process.exitCode = code ?? 1; });
