// Rebuild the bundled dictionary from the pinned Apache-2.0 source, entirely offline.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "third_party", "pinyin");
const source = fs.readFileSync(path.join(sourceRoot, "google_pinyin_rawdict_utf8_65105_freq.txt"));
const expectedHash = "aaf694bb2dde77678ecabe9ca80059caefb71b89b94656a0541b96a615a52ef6";
if (crypto.createHash("sha256").update(source).digest("hex") !== expectedHash) {
  throw new Error("Pinyin dictionary source checksum does not match the pinned version.");
}

const entries = [];
for (const line of source.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
  const [word, frequency, traditional, ...syllables] = line.trim().split(/\s+/);
  if (traditional !== "0") continue;
  const spelling = syllables.join(" ");
  if (!word || !Number.isFinite(Number(frequency)) || !/^[a-z]+(?: [a-z]+)*$/.test(spelling)) {
    throw new Error(`Invalid simplified dictionary row: ${line}`);
  }
  entries.push([spelling, word, Number(frequency)]);
}
if (entries.length !== 55320) throw new Error(`Unexpected dictionary size: ${entries.length}`);

const destination = path.join(root, "src", "assets", "pinyin-dictionary.json");
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify({
  source: "dongyuwei/web-pinyin-ime@ee505cf7bab43cf70dcc2540579027aea432f28a",
  copyright: "Copyright (c) 2009, The Android Open Source Project; Apache-2.0",
  entries,
}) + "\n");

const notices = path.join(root, "public", "licenses", "pinyin");
fs.mkdirSync(notices, { recursive: true });
for (const name of ["LICENSE", "NOTICE"]) {
  fs.copyFileSync(path.join(sourceRoot, name), path.join(notices, name));
}
console.log(`Prepared ${entries.length} offline Pinyin entries and bundled license notices.`);
