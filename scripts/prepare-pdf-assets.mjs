import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Copy only the browser worker and runtime data; omit viewers, source maps and Node builds. */
export async function preparePdfAssets(root) {
  const source = path.join(root, "node_modules", "pdfjs-dist");
  const target = path.join(root, "public", "sim-assets", "pdfjs");
  await mkdir(target, { recursive: true });
  await cp(path.join(source, "build", "pdf.worker.min.mjs"), path.join(target, "pdf.worker.mjs"));
  for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    await cp(path.join(source, directory), path.join(target, directory), { recursive: true });
  }
  await cp(path.join(source, "LICENSE"), path.join(target, "LICENSE"));
  const metadata = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
  await writeFile(path.join(target, "version.json"), JSON.stringify({ name: metadata.name, version: metadata.version }, null, 2) + "\n");
}
