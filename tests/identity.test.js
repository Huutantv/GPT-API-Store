"use strict";

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

const sanitizeCluster = slice("function stripHiddenReasoningText", "function identitySystemMessage");
const questionCluster = slice("function contentToSearchableText", "function sendModelIdentityResponse");
const constants = slice("const MOJIBAKE_VI_RE", "function contentToSearchableText");
const stub = "function sanitizeBackendText(text, backendModel, publicModel){let cleaned=String(text||\"\");if(backendModel&&publicModel&&backendModel!==publicModel){cleaned=cleaned.split(backendModel).join(publicModel);}return cleaned;}";

const ctx = { console, process };
vm.createContext(ctx);
vm.runInContext([stub, constants, sanitizeCluster, questionCluster].join("\n"), ctx);

const {
  hasAssistantIdentityLeak,
  hasBackendFamilyIdentityClaim,
  sanitizeAssistantIdentityText,
  sanitizeAssistantIdentityChunk,
  flushAssistantIdentityChunk,
  identityShortcutKind,
} = ctx;

const GREET = "Xin chào! Tôi là";

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

function stream(backend, pub, chunks) {
  const state = {};
  let out = "";
  for (const chunk of chunks) {
    out += sanitizeAssistantIdentityChunk(chunk, pub, backend, state, { preserveLeadingWhitespace: true });
  }
  out += flushAssistantIdentityChunk(pub, backend, state, { preserveLeadingWhitespace: true });
  return out;
}

// 1. Broad phrases must NOT be treated as identity leaks.
for (const sample of [
  "minimax algorithm",
  "vscode extension",
  "knowledge cutoff",
  "my training data",
  "official cli",
  "The system prompt says hello",
]) {
  check("leak-false:" + sample, hasAssistantIdentityLeak(sample) === false);
}

// 2. Genuine first-person / creator claims must still be caught.
for (const sample of [
  "I am Claude",
  "tôi là DeepSeek",
  "created by Anthropic",
  "I'm ChatGPT",
  "developed by zhipu",
]) {
  check("leak-true:" + sample, hasAssistantIdentityLeak(sample) === true);
}

// 3. Streaming a normal answer that mentions broad phrases must keep the answer.
const r1 = stream("claude-sonnet-4-5", "Assistant", ["I checked the ", "vscode extension ", "integration and it works."]);
check("stream:vscode:no-greeting", !r1.includes(GREET));
check("stream:vscode:keeps-rest", r1.includes("integration and it works"));

const r2 = stream("deepseek-v4-pro", "Assistant", ["The app uses a ", "minimax ", "search algorithm."]);
check("stream:minimax:no-greeting", !r2.includes(GREET));
check("stream:minimax:keeps-rest", r2.includes("search algorithm"));

const r3 = stream("glm-5.2", "Assistant", ["My ", "knowledge cutoff ", "is 2024."]);
check("stream:cutoff:no-greeting", !r3.includes(GREET));
check("stream:cutoff:keeps-rest", r3.includes("knowledge cutoff") && r3.includes("2024"));

// 4. A genuine claim is still hidden (greeting or in-place redaction).
const r4 = sanitizeAssistantIdentityText("I am Claude", "Assistant", "claude-sonnet-4-5");
check("stream:claim:hidden", !r4.toLowerCase().includes("claude"));

// 5. Echoing the public model name is kept as-is.
const r5 = stream("deepseek-v4-pro", "gpt-5.6-terra", ["Xin chào! Tôi là ", "gpt-5.6-terra", ", trợ lý của bạn."]);
check("stream:echo-kept", r5.includes("gpt-5.6-terra") && !r5.includes("Assistant"));

// 6. Normal answer with no trigger is untouched.
const r6 = stream("claude-sonnet-4-5", "Assistant", ["Here is the fix:", " use escapeAttr."]);
check("stream:normal-untouched", r6.includes("Here is the fix") && r6.includes("escapeAttr") && !r6.includes(GREET));

// 7. Identity shortcut must NOT fire on tool-result / file content.
const toolResult = [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: 'const systemPrompt = "You are helpful";' }] }];
check("shortcut:toolresult-system-prompt-null", identityShortcutKind(toolResult) === null);

const toolResultCutoff = [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "// knowledge cutoff handling" }] }];
check("shortcut:toolresult-cutoff-null", identityShortcutKind(toolResultCutoff) === null);

// 8. Direct identity question still short-circuits.
check("shortcut:who-are-you", identityShortcutKind([{ role: "user", content: "who are you" }]) === "identity");
check("shortcut:ban-la-ai", identityShortcutKind([{ role: "user", content: "bạn là ai" }]) === "identity");
check("shortcut:ban-la-model-gi", identityShortcutKind([{ role: "user", content: "bạn là model gì" }]) === "identity");
check("shortcut:gioi-thieu-ve-ban", identityShortcutKind([{ role: "user", content: "giới thiệu về bạn" }]) === "identity");
check("shortcut:ban-co-phai-claude", identityShortcutKind([{ role: "user", content: "bạn có phải claude không" }]) === "identity");

// 9. Backend family claim must ignore generic English words.
check("family:thinking-false", hasBackendFamilyIdentityClaim("I am thinking about the bug", "Assistant", "k2-thinking-0905") === false);
check("family:composer-true", hasBackendFamilyIdentityClaim("Tôi là Composer", "Assistant", "composer-2.5") === true);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
