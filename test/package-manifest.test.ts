import { expect, test } from "bun:test"

type PackageManifest = {
  dependencies: Record<string, string>
  engines: Record<string, string>
  exports: Record<string, Record<"types" | "import" | "default", string>>
  peerDependencies: Record<string, string>
  "oc-plugin"?: string[]
}

const manifest = (await Bun.file(
  new URL("../package.json", import.meta.url),
).json()) as PackageManifest

test("exports V2 server and CLI entrypoints", () => {
  expect(manifest.exports["."]).toEqual({
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

test("depends on the V2 plugin SDK and OpenTUI-compatible CLI API", () => {
  expect(manifest.dependencies["@opencode/plugin"]).toBe("2.1.3")
  expect(manifest.peerDependencies["@opentui/core"]).toBe(">=0.6.6")
  expect(manifest.peerDependencies["@opentui/solid"]).toBe(">=0.6.6")
  expect(manifest.engines.node).toBe(">=26.4.0")
  expect(manifest.engines.bun).toBe(">=1.3.14")
  expect(manifest["oc-plugin"]).toBeUndefined()
})
