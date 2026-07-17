import { expect, test } from "bun:test"

type ExportConditions = Record<"types" | "import" | "default", string>
type PackageManifest = {
  exports: Record<string, ExportConditions>
  files: string[]
}

const manifest = (await Bun.file(
  new URL("../package.json", import.meta.url),
).json()) as PackageManifest

test("exports the server and TUI entrypoints", () => {
  expect(manifest.exports["./server"]).toEqual({
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  })
  expect(manifest.exports["./tui"]).toEqual({
    types: "./dist/tui.d.ts",
    import: "./dist/tui.js",
    default: "./dist/tui.js",
  })
})

test("declares the oc-plugin targets", () => {
  expect((manifest as { "oc-plugin"?: string[] })["oc-plugin"]).toEqual([
    "server",
    "tui",
  ])
})

test("publishes every exported entrypoint from dist", () => {
  expect(manifest.files).toContain("dist")

  for (const conditions of Object.values(manifest.exports)) {
    for (const exportedPath of Object.values(conditions)) {
      expect(exportedPath.startsWith("./dist/")).toBe(true)
    }
  }
})
