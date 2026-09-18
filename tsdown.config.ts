import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version?: string };

const version = process.env.npm_package_version ?? pkg.version ?? "0.0.0";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  minify: true,
  clean: true,
  dts: false,
  sourcemap: false,
  outDir: "dist",
  define: { __CLI_VERSION__: JSON.stringify(version) },
});
