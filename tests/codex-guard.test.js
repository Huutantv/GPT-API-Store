"use strict";

// Tests cho Codex path guard: chỉ chèn hint khi có tool-set Codex, idempotent,
// tôn trọng cờ DORO_CODEX_PATH_GUARD.
// Cách chạy: node tests/codex-guard.test.js

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

const envFlagCluster = slice("function envFlag(", "function defaultUserAssistantOnlyForModel(");
const guardCluster = slice("const CODEX_PATH_TOOL_RE", "function extractToken(");

const ctx = { console, process, String, Array };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext([envFlagCluster, guardCluster].join("\n"), ctx);

const { codexPathGuardEnabled, isCodexToolset, prependCodexPathGuard } = ctx;

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

const MARKER = "Shell/patch path policy (Windows):";
const codexTools = [
  { type: "function", function: { name: "exec_command" } },
  { type: "function", function: { name: "write_stdin" } },
  { type: "custom", name: "apply_patch" },
];
const otherTools = [
  { type: "function", function: { name: "read_file" } },
  { type: "function", function: { name: "list_dir" } },
];

function baseMessages() {
  return [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "compile the project" },
  ];
}

function countMarker(messages) {
  return messages.filter((m) => m && m.role === "system" && String(m.content || "").includes(MARKER)).length;
}

delete process.env.DORO_CODEX_PATH_GUARD;

// 1. Detection.
check("detect exec_command", isCodexToolset([{ type: "function", function: { name: "exec_command" } }]) === true);
check("detect apply_patch (name shape)", isCodexToolset([{ name: "apply_patch" }]) === true);
check("detect write_stdin", isCodexToolset([{ function: { name: "write_stdin" } }]) === true);
check("no detect read_file", isCodexToolset(otherTools) === false);
check("no detect empty", isCodexToolset([]) === false);
check("no detect undefined", isCodexToolset(undefined) === false);

// 2. Default enabled.
check("default enabled", codexPathGuardEnabled() === true);

// 3. Insert exactly one message at firstNonSystem.
{
  const out = prependCodexPathGuard(baseMessages(), codexTools);
  check("insert: +1 message", out.length === 3);
  check("insert: one marker", countMarker(out) === 1);
  check("insert: system stays first", out[0].role === "system" && out[0].content === "You are helpful.");
  check("insert: marker before user", String(out[1].content).includes(MARKER) && out[2].role === "user");
}

// 4. Idempotent: applying twice keeps one.
{
  const once = prependCodexPathGuard(baseMessages(), codexTools);
  const twice = prependCodexPathGuard(once, codexTools);
  check("idempotent: still one marker", countMarker(twice) === 1 && twice.length === 3);
}

// 5. Non-codex toolset -> untouched.
{
  const out = prependCodexPathGuard(baseMessages(), otherTools);
  check("non-codex: untouched", countMarker(out) === 0 && out.length === 2);
}

// 6. Flag off -> untouched.
{
  process.env.DORO_CODEX_PATH_GUARD = "0";
  check("flag off disabled", codexPathGuardEnabled() === false);
  const out = prependCodexPathGuard(baseMessages(), codexTools);
  check("flag off: untouched", countMarker(out) === 0 && out.length === 2);
  delete process.env.DORO_CODEX_PATH_GUARD;
}

// 7. All-system messages -> appended.
{
  const out = prependCodexPathGuard([{ role: "system", content: "sys" }], codexTools);
  check("all-system: appended", out.length === 2 && String(out[1].content).includes(MARKER));
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
