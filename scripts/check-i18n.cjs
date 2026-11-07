// Run from the repository root after editing the bilingual catalog.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "frontend/node_modules/typescript"));
const catalogPath = path.join(root, "frontend/src/lib/translations.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
assert.equal(fs.readFileSync(catalogPath, "utf8"), fs.readFileSync(path.join(root, "backend/translations.json"), "utf8"));
const source = fs.readFileSync(path.join(root, "frontend/src/lib/i18n.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const sandbox = { exports: {}, require: (name) => { assert.equal(name, "./translations.json"); return catalog; } };
vm.runInNewContext(js, sandbox);
const { translate, preferredLocale } = sandbox.exports;
assert.equal(translate("ชื่อที่แสดง", "en"), "Display name");
assert.equal(translate("Display name", "th"), "ชื่อที่แสดง");
assert.equal(translate("ฟัง {0}", "en", { 0: "เพลงของฉัน" }), "Preview เพลงของฉัน");
assert.equal(translate("เพลงของฉัน", "en"), "เพลงของฉัน");
assert.equal(translate("BPM ต่าง 2.5", "en"), "BPM difference 2.5");
assert.equal(preferredLocale("en;q=0,th-TH;q=0.8"), "th");
assert.equal(preferredLocale("th;q=0.3,en-US;q=0.8"), "en");
for (const [key, message] of Object.entries(catalog)) {
  assert(message.th && message.en, key);
  assert(!/[\u0e00-\u0e7f]/.test(message.en), key);
  assert.deepEqual((message.th.match(/\{\d+\}/g) || []).sort(), (message.en.match(/\{\d+\}/g) || []).sort(), key);
}
const paths = ["frontend/src/app/page.tsx", "frontend/src/lib/api.ts", ...fs.readdirSync(path.join(root, "frontend/src/hooks")).filter((name) => name.endsWith(".ts")).map((name) => "frontend/src/hooks/" + name), ...fs.readdirSync(path.join(root, "frontend/src/components")).filter((name) => name.endsWith(".tsx")).map((name) => "frontend/src/components/" + name)];
for (const name of paths) {
  const source = fs.readFileSync(path.join(root, name), "utf8");
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  function checkMessage(node) {
    if (ts.isStringLiteral(node)) assert(catalog[node.text], name + ": missing " + node.text);
    else if (ts.isConditionalExpression(node)) {
      checkMessage(node.whenTrue);
      checkMessage(node.whenFalse);
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) && ["tr", "t"].includes(node.expression.getText(file)) && node.arguments[0]) checkMessage(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(file);
}
console.log(`TH/EN catalog verified: ${Object.keys(catalog).length} messages; placeholders, language negotiation and user content preservation passed.`);
