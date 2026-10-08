import { probeMemberSite } from "./site-readiness.mjs";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--url" || args[2] !== "--timeout-ms"
  || !Number.isInteger(Number(args[3])) || Number(args[3]) < 1 || Number(args[3]) > 30000) {
  throw new Error("Usage: node scripts/check-site-access.mjs --url <origin> --timeout-ms <1-30000>");
}
try {
  const result = await probeMemberSite(args[1], { timeoutMs: Number(args[3]) });
  console.log(JSON.stringify(result));
  process.exitCode = result.ready ? 0 : 1;
} catch {
  console.log(JSON.stringify({ ready: false, code: "INVALID_ORIGIN" }));
  process.exitCode = 1;
}
