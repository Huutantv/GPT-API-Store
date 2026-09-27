"use strict";

// Tests cho agent continue guard + auto-continue (chống "hứa rồi dừng").
// Cach chay: node tests/agent-continue.test.js

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

const cluster = slice("function agentContinueGuardEnabled(", "async function runAgentRounds(");
const stubs = `
function envFlag(value, fallback = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}
function openaiContentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p && p.text) || "").join("");
  return content == null ? "" : String(content);
}
function addLog() {}
`;

const ctx = { console, process };
vm.createContext(ctx);
vm.runInContext([stubs, cluster].join("\n"), ctx);

const {
  agentContinueGuardEnabled,
  agentAutoContinueEnabled,
  agentAutoContinueMax,
  agentAutoContinueMode,
  isExplicitCompletionText,
  prependAgentContinueGuard,
  agentAutoContinueNudgeMessage,
  isContinuationPromiseText,
  agentAutoContinueActive,
  shouldAutoContinue,
  appendAutoContinueNudge,
} = ctx;

let pass = 0;
const failures = [];
function check(name, cond) {
  if (cond) pass += 1;
  else {
    failures.push(name);
    console.log("FAIL " + name);
  }
}

// 1. Promise patterns (VI + EN).
for (const t of [
  "Tôi sẽ đọc tiếp các module cốt lõi còn lại.",
  "Mình sẽ kiểm tra tiếp phần còn lại.",
  "Đọc tiếp nhé.",
  "I'll continue reading the rest.",
  "Let me check the remaining files.",
  "Kiểm tra git diff:",
  "Đã update xong. 33 references được sửa across 13 files. Kiểm tra git diff:",
  "Let me read the file:",
  "Now verify and add on_accent_idx helper to theme.rs.",
  "Next, update the palette and run the tests.",
  "Bây giờ tôi thêm helper vào theme.rs.",
]) {
  check("promise-true:" + t.slice(0, 24), isContinuationPromiseText(t) === true);
}
for (const t of [
  "Đã xong rồi, không còn gì để làm.",
  "Kết quả: 42.",
  "Here is the final answer.",
  "",
]) {
  check("promise-false:" + t.slice(0, 24), isContinuationPromiseText(t) === false);
}
check("promise-false:code-fence", isContinuationPromiseText("Tôi sẽ viết ```js\ncode\n``` tiếp") === false);
check("promise-false:too-long", isContinuationPromiseText("Tôi sẽ đọc tiếp " + "x".repeat(500)) === false);

// 2. Guard injection.
{
  const messages = [{ role: "system", content: "sys" }, { role: "user", content: "hi" }];
  const tools = [{ type: "function", function: { name: "read" } }];
  const out = prependAgentContinueGuard(messages, tools);
  check("guard: injected when tools", out.length === 3 && out[1].role === "system" && out[1].content.includes("Agent tool workflow policy:"));
  const again = prependAgentContinueGuard(out, tools);
  check("guard: idempotent", again.length === 3);
  const noTools = prependAgentContinueGuard(messages, []);
  check("guard: skipped without tools", noTools.length === 2);
}

// 3. Guard disabled via env.
{
  const messages = [{ role: "user", content: "hi" }];
  process.env.DORO_AGENT_CONTINUE_GUARD = "0";
  check("guard: disabled flag", agentContinueGuardEnabled() === false && prependAgentContinueGuard(messages, [{ type: "function", function: { name: "read" } }]).length === 1);
  delete process.env.DORO_AGENT_CONTINUE_GUARD;
  check("guard: default on", agentContinueGuardEnabled() === true);
}

// 4. shouldAutoContinue.
{
  const promiseData = { choices: [{ message: { role: "assistant", content: "Tôi sẽ đọc tiếp." } }] };
  const toolData = { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "read", arguments: "{}" } }] } }] };
  const finalData = { choices: [{ message: { role: "assistant", content: "Đã xong." } }] };
  check("should: promise true", shouldAutoContinue(promiseData, true, 0, 1) === true);
  check("should: tool call false", shouldAutoContinue(toolData, true, 0, 1) === false);
  check("should: final text false", shouldAutoContinue(finalData, true, 0, 1) === false);
  check("should: no tools false", shouldAutoContinue(promiseData, false, 0, 1) === false);
  check("should: round>=max false", shouldAutoContinue(promiseData, true, 1, 1) === false);
}

// 5. max clamp + active helper.
{
  delete process.env.DORO_AGENT_AUTO_CONTINUE_MAX;
  check("max: default 2", agentAutoContinueMax() === 2);
  process.env.DORO_AGENT_AUTO_CONTINUE_MAX = "9";
  check("max: clamp 3", agentAutoContinueMax() === 3);
  process.env.DORO_AGENT_AUTO_CONTINUE_MAX = "0";
  check("max: 0 allowed", agentAutoContinueMax() === 0);
  delete process.env.DORO_AGENT_AUTO_CONTINUE_MAX;
  check("active: with tools", agentAutoContinueActive({ tools: [{ type: "function" }] }) === true);
  check("active: without tools", agentAutoContinueActive({}) === false);
}

// 6. Nudge append.
{
  const messages = [{ role: "user", content: "hi" }];
  const data = { choices: [{ message: { role: "assistant", content: "Tôi sẽ đọc tiếp." } }] };
  appendAutoContinueNudge(messages, data);
  check("nudge: assistant appended", messages[1].role === "assistant" && messages[1].content === "Tôi sẽ đọc tiếp.");
  check("nudge: nudge appended as user", messages[2].role === "user" && messages[2].content.includes("chưa hoàn thành"));
  check("nudge: message shape", agentAutoContinueNudgeMessage().role === "user");
}

// 7. Mode + explicit completion (aggressive).
{
  delete process.env.DORO_AGENT_AUTO_CONTINUE_MODE;
  check("mode: default aggressive", agentAutoContinueMode() === "aggressive");
  process.env.DORO_AGENT_AUTO_CONTINUE_MODE = "pattern";
  check("mode: pattern", agentAutoContinueMode() === "pattern");
  process.env.DORO_AGENT_AUTO_CONTINUE_MODE = "bogus";
  check("mode: invalid -> aggressive", agentAutoContinueMode() === "aggressive");

  check("completion: true", isExplicitCompletionText("Đã hoàn thành tất cả các bước.") === true);
  check("completion: false", isExplicitCompletionText("Tôi sẽ đọc tiếp.") === false);
  // Fix: final answer dài (>600) vẫn phải nhận ra là xong (trước đây bị nudge sai).
  check("completion: long done true", isExplicitCompletionText("Đã hoàn thành tất cả các bước. " + "x".repeat(800)) === true);
  // Fix: 'now verify/add...' là preamble, KHÔNG tính là xong dù chứa từ khóa.
  check("completion: now-verify false", isExplicitCompletionText("Now verify and add on_accent_idx helper to theme.rs.") === false);

  // aggressive: nudge moi text-only tru khi noi ro da xong.
  const plain = { choices: [{ message: { role: "assistant", content: "Đang xử lý bước quan trọng." } }] };
  const done = { choices: [{ message: { role: "assistant", content: "Đã hoàn thành tất cả các bước." } }] };
  const doneColon = { choices: [{ message: { role: "assistant", content: "Đã hoàn thành. Kiểm tra git diff:" } }] };
  delete process.env.DORO_AGENT_AUTO_CONTINUE_MODE;
  check("aggressive: plain nudged", shouldAutoContinue(plain, true, 0, 1) === true);
  check("aggressive: explicit done respected", shouldAutoContinue(done, true, 0, 1) === false);
  check("aggressive: done but trailing colon nudged", shouldAutoContinue(doneColon, true, 0, 1) === true);
  process.env.DORO_AGENT_AUTO_CONTINUE_MODE = "pattern";
  // pattern mode: plain text khong nudge.
  check("pattern: plain not nudged", shouldAutoContinue(plain, true, 0, 1) === false);
  delete process.env.DORO_AGENT_AUTO_CONTINUE_MODE;
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
