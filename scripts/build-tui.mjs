import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import babel from "@babel/core"
import typescriptPreset from "@babel/preset-typescript"
import solidPreset from "babel-preset-solid"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const sourceDir = path.join(rootDir, "src", "tui")
const srcDir = path.join(rootDir, "src")
const distDir = path.join(rootDir, "dist")

async function listTsxFiles(dir) {
  const found = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await listTsxFiles(entryPath)))
    else if (entry.isFile() && entry.name.endsWith(".tsx")) found.push(entryPath)
  }
  return found
}

await fs.mkdir(distDir, { recursive: true })
for (const sourcePath of await listTsxFiles(sourceDir)) {
  const distStem = path.join(distDir, path.relative(srcDir, sourcePath)).replace(/\.tsx$/, "")
  const transformed = await babel.transformAsync(await fs.readFile(sourcePath, "utf8"), {
    filename: sourcePath,
    configFile: false,
    babelrc: false,
    presets: [
      [solidPreset, { moduleName: "@opentui/solid", generate: "universal" }],
      [typescriptPreset],
    ],
  })

  if (!transformed?.code) {
    throw new Error(`Babel transform returned empty output for ${path.relative(srcDir, sourcePath)}`)
  }

  await fs.mkdir(path.dirname(distStem), { recursive: true })
  await fs.writeFile(`${distStem}.js`, `${transformed.code}\n`)
  await fs.rm(`${distStem}.jsx`, { force: true })
  await fs.rm(`${distStem}.jsx.map`, { force: true })
}

await fs.rm(path.join(distDir, "tui.tsx"), { force: true })
const reexport = `export { default } from "./tui/index.js";\nexport * from "./tui/index.js";\n`
await fs.writeFile(path.join(distDir, "tui.js"), reexport)
await fs.writeFile(path.join(distDir, "tui.d.ts"), reexport)
