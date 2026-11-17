// Offline candidate/consumption regression tests; no browser, input method or network access.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/lib/pinyin-engine.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const moduleExports = {};
let dictionaryLoads = 0;
vm.runInNewContext(compiled, {
  exports: moduleExports,
  require: (specifier) => {
    assert.equal(specifier, "../assets/pinyin-dictionary.json");
    dictionaryLoads += 1;
    return JSON.parse(fs.readFileSync(path.join(root, "src/assets/pinyin-dictionary.json"), "utf8"));
  },
});

(async () => {
  const { queryPinyin } = moduleExports;
  for (const input of ["", "123", "你好", "<script>", "nihao1"]) assert.equal((await queryPinyin(input)).length, 0);
  assert.equal(dictionaryLoads, 0, "Invalid input should not load the dictionary");
  for (const [input, expected] of [["nihao", "你好"], ["zhongwen", "中文"], ["ceshi", "测试"], ["zhongguo", "中国"]]) {
    const candidates = await queryPinyin(input);
    assert.equal(candidates[0].text, expected, input);
    assert.equal(candidates[0].consumed, input.length);
  }
  assert.equal(dictionaryLoads, 1, "Concurrent/local lookups share one lazy dictionary load");

  const segmented = (await queryPinyin("nihaozhongwen")).find((item) => item.text === "你好");
  assert.ok(segmented);
  assert.equal(segmented.consumed, 5);
  const remainder = "nihaozhongwen".slice(segmented.consumed);
  assert.equal((await queryPinyin(remainder))[0].text, "中文");
  assert.equal((await queryPinyin("niha"))[0].text, "你好", "Incomplete syllables get local completions");
  assert.ok((await queryPinyin("zg")).some((item) => item.text === "中国" && item.consumed === 2));
  const apostrophe = await queryPinyin("xi'an");
  assert.ok(apostrophe.some((item) => item.text === "西安" && item.consumed === 5));
  assert.equal(apostrophe.some((item) => item.text === "先" && item.consumed === 5), false);
  assert.equal((await queryPinyin("NI HAO"))[0].text, "你好");
  assert.equal((await queryPinyin("NI HAO"))[0].consumed, 6);
  for (const spelling of ["lv", "lü", "lu:"]) assert.ok((await queryPinyin(spelling)).some((item) => item.text === "绿" && item.consumed === spelling.length));
  for (const input of ["n", "shi", "nihaozhongwen", "xi'an", "NI HAO"]) {
    const candidates = await queryPinyin(input);
    assert.ok(candidates.every((item) => item.consumed > 0 && item.consumed <= input.length));
    assert.equal(new Set(candidates.map((item) => `${item.text}:${item.consumed}`)).size, candidates.length);
    assert.ok(candidates.length <= 60);
  }
  console.log("Offline Pinyin passed: common phrases, initials, prefix completion, segmented consumption, apostrophes, umlauts and input bounds.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
