import { runBackendTests } from "./backend-test-runner.mjs";

try {
  process.exitCode = await runBackendTests(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "后端集成测试启动失败");
  process.exitCode = 1;
}
