"use strict";

// Tests cho tinh "transparent" cua tool call: proxy KHONG duoc sua/xoa/them tool.
// Cach chay: node tests/tool-passthrough.test.js

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

const flatCluster = slice("function backendRequiresFlattenedToolHistory(", "function backendWeights(");
const toolCompatCluster = slice("function applyBackendToolCompatibility(", "function openaiContentToText(");

const ctx = { console, process };
vm.createContext(ctx);
vm.runInContext([`function addLog(){}\n`, flatCluster, toolCompatCluster].join("\n"), ctx);

const { backendRequiresFlattenedToolHistory, applyBackendToolCompatibility } = ctx;

let pass = 0;
const failures = [];
function check(name, cond) {
  if (cond) pass += 1;
  else {
    failures.push(name);
    console.log("FAIL " + name);
  }
}

function fixture() {
  return {
    model: "deepseek-v4.1-flash",
    tools: [
      { type: "function", function: { name: "read", description: "Read a file", parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] } } },
    ],
    tool_choice: "auto",
    parallel_tool_calls: true,
    messages: [
      { role: "user", content: "fix the bug" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: '{"filePath":"C:\\\\Users\\\\a.txt"}' } }] },
      { role: "tool", tool_call_id: "call_1", content: "file body" },
    ],
  };
}

// 1. Mac dinh (disableTools false): tools/tool_choice/messages phai nguyen ven 100%.
for (const label of ["default", "explicit"]) {
  const payload = fixture();
  const before = JSON.stringify(payload);
  const settings = label === "default"
    ? { profileLabel: "Backend 1" }
    : { profileLabel: "Backend 1", disableTools: false };
  applyBackendToolCompatibility(payload, settings);
  check(`passthrough(${label}): tools unchanged`, JSON.stringify(payload) === before);
  check(`passthrough(${label}): tool_calls kept`, Array.isArray(payload.messages[1].tool_calls) && payload.messages[1].tool_calls.length === 1);
  check(`passthrough(${label}): args raw backslash kept`, payload.messages[1].tool_calls[0].function.arguments === '{"filePath":"C:\\\\Users\\\\a.txt"}');
}

// 2. chi khi admin bat DISABLE_TOOLS tuong minh moi strip tools.
{
  const payload = fixture();
  applyBackendToolCompatibility(payload, { profileLabel: "Backend X", disableTools: true });
  check("disableTools: tools removed", payload.tools === undefined);
  check("disableTools: tool_choice removed", payload.tool_choice === undefined);
  check("disableTools: messages untouched", payload.messages.length === 3 && payload.messages[1].tool_calls.length === 1);
}

// 3. userAssistantOnly mac dinh false -> khong flatten history.
check("flatten: default off", backendRequiresFlattenedToolHistory({}) === false);
check("flatten: undefined settings off", backendRequiresFlattenedToolHistory(undefined) === false);
check("flatten: only when opted in", backendRequiresFlattenedToolHistory({ userAssistantOnly: true }) === true);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
