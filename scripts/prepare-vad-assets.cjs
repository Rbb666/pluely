// Bundle speech detection assets locally. No runtime CDN access is required.
// The VAD uses ort.env.wasm.numThreads = 1; both SIMD and baseline WASM are included.
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const vadRoot = path.dirname(require.resolve("@ricky0123/vad-web/package.json"));
const ortRoot = path.dirname(require.resolve("onnxruntime-web/package.json", { paths: [vadRoot] }));
const outputDirectory = path.join(projectRoot, "public", "vad");
const assets = [
  [vadRoot, "silero_vad_v5.onnx"],
  [vadRoot, "vad.worklet.bundle.min.js"],
  [ortRoot, "ort-wasm-simd.wasm"],
  [ortRoot, "ort-wasm.wasm"],
].map(([root, filename]) => ({
  source: path.join(root, "dist", filename),
  destination: path.join(outputDirectory, filename),
}));

// Fail before copying if npm dependencies or the expected package files are missing.
for (const { source } of assets) {
  if (!fs.existsSync(source)) {
    throw new Error(`VAD asset is missing: ${source}. Run npm ci before building.`);
  }
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const { source, destination } of assets) {
  fs.copyFileSync(source, destination);
}
console.log(`Prepared ${assets.length} local VAD assets in public/vad.`);
