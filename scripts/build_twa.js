// Generates the Trusted Web Activity Android project from android/twa-manifest.json
// without Bubblewrap's interactive prompts, then builds a debug APK with Gradle.
//
// Usage:
//   node scripts/build_twa.js [iconBaseUrl]
//
// The icon URLs in the manifest are overridden to point at a local static server
// (default http://127.0.0.1:8787) so the generator can download the launcher icons.

const path = require("path");
const fs = require("fs");

// Resolve Bubblewrap's core library from the global npm install instead of a
// machine-specific path.
const GLOBAL_NODE_MODULES = require("child_process")
  .execSync("npm root -g", { encoding: "utf8" })
  .trim();
const cliRequire = require("module").createRequire(
  path.join(GLOBAL_NODE_MODULES, "@bubblewrap", "cli", "dist", "index.js")
);
const { TwaManifest, TwaGenerator, BufferedLog, ConsoleLog } =
  cliRequire("@bubblewrap/core");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_SRC = path.join(ROOT, "android", "twa-manifest.json");
const TARGET = path.join(ROOT, "android", "twa-project");
const ICON_BASE = process.argv[2] || "http://127.0.0.1:8787";

async function main() {
  const twaManifest = await TwaManifest.fromFile(MANIFEST_SRC);

  // Point the launcher icons and web manifest at the local static server so the
  // generator can fetch them (the real host isn't deployed yet).
  twaManifest.iconUrl = `${ICON_BASE}/icon-512.png`;
  twaManifest.maskableIconUrl = `${ICON_BASE}/icon-maskable-512.png`;
  twaManifest.monochromeIconUrl = undefined;
  twaManifest.webManifestUrl = new URL(`${ICON_BASE}/manifest.webmanifest`);

  // Keep the signing key path relative so the generated manifest is portable.
  twaManifest.signingKey.path = "android.keystore";

  const twaGenerator = new TwaGenerator();
  const log = new BufferedLog(new ConsoleLog("generate"));
  const progress = (current, total) => {
    if (current % Math.max(1, Math.floor(total / 10)) === 0) {
      process.stdout.write(`  ${Math.round((current / total) * 100)}%\n`);
    }
  };

  console.log(`Generating TWA project in ${TARGET} ...`);
  fs.mkdirSync(TARGET, { recursive: true });
  await twaGenerator.createTwaProject(TARGET, twaManifest, log, progress);
  log.flush();

  await twaManifest.saveToFile(path.join(TARGET, "twa-manifest.json"));
  console.log("Project generated successfully.");
  console.log(`Run: cd "${TARGET}" && gradlew.bat assembleDebug`);
}

main().catch((err) => {
  console.error("build_twa failed:", err);
  process.exit(1);
});
