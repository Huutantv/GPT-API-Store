"use strict";

// Tests cho normalizeToolArgumentsJson: giữ nguyên args bị cắt cụt (không thay
// bằng "{}"), và repair escape backslash không hợp lệ (Windows path) trước khi
// kết luận args là không parse được.
// Cách chạy: node tests/tool-args.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "doro_proxy_node.js"), "utf8");

function slice(fromMarker, toMarker) {
  const start = SRC.indexOf(fromMarker);
  const end = SRC.indexOf(toMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`cannot slice ${fromMarker} -> ${toMarker}`);
  }
  return SRC.slice(start, end);
}

const cluster = slice("function repairInvalidJsonBackslashes(", "function normalizeToolCallsInMessage(");

const ctx = { console, JSON, String };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(["var __logs = [];", "function addLog(m){ __logs.push(String(m)); }", cluster].join("\n"), ctx);

const { normalizeToolArgumentsJson, repairInvalidJsonBackslashes } = ctx;

let pass = 0;
const failures = [];
function check(name, cond) {
  if (cond) {
    pass += 1;
  } else {
    failures.push(name);
    console.log("FAIL " + name);
  }
}

function parses(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

// 1. Object input -> stringify.
check("object input", normalizeToolArgumentsJson({ command: "x" }) === '{"command":"x"}');

// 2. Valid JSON string untouched.
check("valid json preserved", normalizeToolArgumentsJson('{"a":1}') === '{"a":1}');

// 3. Empty -> "{}".
check("empty -> {}", normalizeToolArgumentsJson("") === "{}");

// 4. Windows path with invalid escapes (\U, \T, \X, \k) -> repaired & parseable.
{
  const raw = '{"command":"javac -d C:\\Users\\X\\out @C:\\Temp\\kilo\\src_args.txt"}';
  const out = normalizeToolArgumentsJson(raw);
  const parsed = parses(out);
  check("win: repaired to parseable", !!parsed);
  check(
    "win: path preserved",
    !!parsed && parsed.command === "javac -d C:\\Users\\X\\out @C:\\Temp\\kilo\\src_args.txt",
  );
  check("win: changed from raw", out !== raw);
}

// 5. Uppercase invalid escape \N, \F -> repaired.
{
  const parsed = parses(normalizeToolArgumentsJson('{"p":"C:\\New\\Folder"}'));
  check("win: \\N \\F repaired", !!parsed && parsed.p === "C:\\New\\Folder");
}

// 6. Valid \uXXXX escape must be preserved (not escaped twice).
{
  const out = normalizeToolArgumentsJson('{"s":"\\u0041"}');
  const parsed = parses(out);
  check("unicode: \\u0041 -> A", !!parsed && parsed.s === "A");
}

// 7. Incomplete \u (not 4 hex) -> repaired.
{
  const parsed = parses(normalizeToolArgumentsJson('{"p":"C:\\users\\u12"}'));
  check("unicode: incomplete \\u repaired", !!parsed && parsed.p === "C:\\users\\u12");
}

// 8. Already-escaped backslashes are not double-escaped.
{
  const raw = '{"path":"C:\\\\Users\\\\X"}';
  const out = normalizeToolArgumentsJson(raw);
  const parsed = parses(out);
  check("already escaped kept", out === raw && !!parsed && parsed.path === "C:\\Users\\X");
}

// 9. Real newline escape \n preserved.
{
  const raw = '{"content":"a\\nb"}';
  const out = normalizeToolArgumentsJson(raw);
  const parsed = parses(out);
  check("newline escape preserved", out === raw && !!parsed && parsed.content === "a\nb");
}

// 10. Truncated args -> passthrough (never "{}"), and logged.
{
  ctx.__logs.length = 0;
  const raw = '{"pattern": "INSERT INTO';
  const out = normalizeToolArgumentsJson(raw);
  check("truncated passthrough unchanged", out === raw);
  check("truncated not faked to {}", out !== "{}");
  check("truncated logged", ctx.__logs.some((l) => l.includes("tool args passthrough")));
}

// 11. repairInvalidJsonBackslashes leaves valid escapes alone.
check("repair: valid escapes untouched", repairInvalidJsonBackslashes('a\\nb\\t"c"') === 'a\\nb\\t"c"');
check("repair: invalid escaped", repairInvalidJsonBackslashes("C:\\Users") === "C:\\\\Users");

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
