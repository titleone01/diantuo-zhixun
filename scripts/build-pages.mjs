import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { preparePdfAssets } from "./prepare-pdf-assets.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const normalizeBase = (value) => `/${value.replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");
const base = normalizeBase(option("--base", "/diantuo-zhixun/"));
const outputName = option("--out-dir", "docs");
const outDir = path.resolve(projectRoot, outputName);

if (path.dirname(outDir) !== projectRoot || !["docs", "pages-dist"].includes(path.basename(outDir))) {
  throw new Error(`拒绝重建非 Pages 目录: ${outDir}`);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await preparePdfAssets(projectRoot);
await cp(path.join(projectRoot, "public"), outDir, { recursive: true });

const result = await build({
  entryPoints: [path.join(projectRoot, "github-pages", "main.tsx")],
  outdir: outDir,
  bundle: true,
  splitting: true,
  chunkNames: "assets/chunks/[name]-[hash]",
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  conditions: ["style"],
  define: {
    "__STATIC_DEMO__": "true",
    "import.meta.env.BASE_URL": JSON.stringify(base),
  },
  entryNames: "assets/index-[hash]",
  assetNames: "assets/[name]-[hash]",
  loader: {
    ".glb": "file",
    ".svg": "file",
  },
  metafile: true,
  logLevel: "info",
});

const entry = Object.entries(result.metafile.outputs).find(([, metadata]) => metadata.entryPoint && path.resolve(projectRoot, metadata.entryPoint) === path.join(projectRoot, "github-pages", "main.tsx"));
if (!entry) throw new Error("Pages 构建未生成 JavaScript 入口");
const [entryPath, entryMetadata] = entry;
const relativeUrl = (filePath) => `${base}${path.relative(outDir, path.resolve(projectRoot, filePath)).replaceAll("\\", "/")}`;
const scriptUrl = relativeUrl(entryPath);
const stylesheetUrl = entryMetadata.cssBundle ? relativeUrl(entryMetadata.cssBundle) : null;

let html = await readFile(path.join(projectRoot, "github-pages", "index.html"), "utf8");
html = html.replace(
  "</head>",
  `    <link rel="icon" href="${base}favicon.svg" />\n${stylesheetUrl ? `    <link rel="stylesheet" href="${stylesheetUrl}" />\n` : ""}  </head>`,
);
html = html.replace('<script type="module" src="/main.tsx"></script>', `<script type="module" src="${scriptUrl}"></script>`);
await writeFile(path.join(outDir, "index.html"), html);

console.log(`Pages 构建完成: ${path.relative(projectRoot, outDir)} (${base})`);
