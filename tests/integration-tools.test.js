"use strict";

// Integration test: proxy that + mock backend, kiem tra tool call di qua nguyen ven
// cho ca 3 wire API: OpenAI chat/completions, Anthropic messages, Responses (Codex).
//
// Cach chay: node tests/integration-tools.test.js
//
// Muc tieu: tool doc/ghi (read_file/write_file + custom apply_patch) phai:
//   - duoc forward xuong backend voi schema nguyen ven
//   - tool_calls backend tra ve duoc dich dung shape cho tung client
//   - history role "tool" (tool_result) khong bi flatten/mat
//   - streaming reconstruct dung name + arguments

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PROXY_ENTRY = process.env.DORO_PROXY_ENTRY || path.join(ROOT, "doro_proxy_node.js");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "doro-tools-"));
const dbPath = path.join(tmpDir, "credit.db");
const logDir = path.join(tmpDir, "logs");

const API_KEY = "sk-integration-tools-0001";

// Seed a credit key in the proxy's DB before spawning it.
process.env.DORO_DB_PATH = dbPath;
const credit = require(path.join(ROOT, "credit.js"));
credit.createManualKey({ key: API_KEY, label: "integration", credit: 1000000, tokenRemaining: 1000000, rpmLimit: 100000 });

const PATCH = "*** Begin Patch\n*** Add File: out.txt\n+hello\n*** End Patch";

function pickTool(parsed) {
  const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
  const names = tools.map((t) => t && t.function && t.function.name).filter(Boolean);
  const blob = JSON.stringify(parsed.messages || "") + JSON.stringify(parsed.input || "");
  const marker = blob.match(/TOOL:([A-Za-z0-9_]+)/);
  const name = (marker && names.includes(marker[1]) && marker[1])
    || names.find((n) => /apply_patch/.test(n))
    || names[0]
    || "write_file";
  const isCustom = name === "apply_patch";
  const args = isCustom
    ? JSON.stringify({ input: PATCH })
    : JSON.stringify({ path: "out.txt", content: "hello" });
  return { name, args };
}

// ---- mock backend -----------------------------------------------------------
const captured = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let parsed = {};
    try { parsed = JSON.parse(body || "{}"); } catch (_) {}
    captured.push({ url: req.url, body: parsed });
    const { name, args } = pickTool(parsed);

    if (parsed.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: "chatcmpl_mock", object: "chat.completion.chunk", created: 1, model: parsed.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      const mid = args.length >> 1;
      res.write(chunk({ role: "assistant" }));
      // Gia lap turn "text + tool call" nhu Codex agent: model noi 1 cau roi goi tool.
      res.write(chunk({ content: "Tôi sẽ đọc tiếp module còn lại. " }));
      res.write(chunk({ tool_calls: [{ index: 0, id: "call_stream", type: "function", function: { name, arguments: "" } }] }));
      res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(0, mid) } }] }));
      res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(mid) } }] }));
      res.write(chunk({}, "tool_calls"));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_mock",
      object: "chat.completion",
      created: 1,
      model: parsed.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: args } }] },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });
});

// ---- helpers ----------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(method, port, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const h = { ...headers };
    if (data) { h["content-type"] = "application/json"; h["content-length"] = data.length; }
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method, headers: h }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(25000, () => req.destroy(new Error(`request timeout ${method} ${pathname}`)));
    if (data) req.write(data);
    req.end();
  });
}

function collectOpenAIToolCalls(sse) {
  let name = "";
  let args = "";
  let finish = null;
  for (const block of sse.split(/\n\n/)) {
    const line = block.split(/\n/).find((l) => l.startsWith("data:"));
    if (!line) continue;
    const d = line.slice(5).trim();
    if (!d || d === "[DONE]") continue;
    let j;
    try { j = JSON.parse(d); } catch (_) { continue; }
    const ch = (j.choices || [])[0] || {};
    if (ch.finish_reason) finish = ch.finish_reason;
    for (const tc of (ch.delta && ch.delta.tool_calls) || []) {
      if (tc.function && tc.function.name) name += tc.function.name;
      if (tc.function && tc.function.arguments) args += tc.function.arguments;
    }
  }
  return { name, args, finish };
}

function collectAnthropicToolUse(sse) {
  let name = "";
  let json = "";
  let sawStop = false;
  for (const block of sse.split(/\n\n/)) {
    const dataLine = block.split(/\n/).find((l) => l.startsWith("data:"));
    if (!dataLine) continue;
    let j;
    try { j = JSON.parse(dataLine.slice(5).trim()); } catch (_) { continue; }
    if (j.type === "content_block_start" && j.content_block && j.content_block.type === "tool_use") name = j.content_block.name || "";
    if (j.type === "content_block_delta" && j.delta && j.delta.type === "input_json_delta") json += j.delta.partial_json || "";
    if (j.type === "message_stop") sawStop = true;
  }
  return { name, json, sawStop };
}

function collectResponsesItems(sse) {
  const items = [];
  let completed = false;
  for (const block of sse.split(/\n\n/)) {
    const dataLine = block.split(/\n/).find((l) => l.startsWith("data:"));
    if (!dataLine) continue;
    const d = dataLine.slice(5).trim();
    if (!d || d === "[DONE]") continue;
    let j;
    try { j = JSON.parse(d); } catch (_) { continue; }
    if (j.type === "response.output_item.done" && j.item) items.push(j.item);
    if (j.type === "response.completed") completed = true;
  }
  return { items, completed };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

let pass = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
  } else {
    failures.push(name + (extra ? ` (${extra})` : ""));
    console.log("FAIL " + name + (extra ? ` -> ${extra}` : ""));
  }
}

const OPENAI_TOOLS = (model) => ({
  model,
  messages: [
    { role: "user", content: "TOOL:write_file hãy đọc file rồi ghi lại" },
    { role: "assistant", content: "", tool_calls: [{ id: "call_prev", type: "function", function: { name: "read_file", arguments: '{"path":"in.txt"}' } }] },
    { role: "tool", tool_call_id: "call_prev", content: "nội dung file gốc" },
  ],
  tools: [
    { type: "function", function: { name: "read_file", description: "read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
    { type: "function", function: { name: "write_file", description: "write", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  ],
});

const ANTHROPIC_TOOLS = (model) => ({
  model,
  max_tokens: 2048,
  messages: [{ role: "user", content: "TOOL:write_file hãy ghi file" }],
  tools: [{ name: "write_file", description: "write", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } }],
});

const RESPONSES_TOOLS = (model, tools) => ({
  model,
  input: [{ role: "user", content: [{ type: "input_text", text: `TOOL:${tools[0].name} hãy thực hiện` }] }],
  tools,
  stream: false,
});

let proxy = null;

async function main() {
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const mockPort = mock.address().port;

  const proxyPort = 47000 + Math.floor(Math.random() * 2000);
  const env = {
    ...process.env,
    DORO_PROXY_PORT: String(proxyPort),
    DORO_DB_PATH: dbPath,
    DORO_API_BASE: `http://127.0.0.1:${mockPort}/v1`,
    DORO_API_KEY: "upstream-key",
    DORO_BACKEND_MODEL: "deepseek-v4-pro",
    DORO_BACKEND1_MODEL: "deepseek-v4-pro",
    DORO_ACTIVE_BACKEND: "1",
    DORO_AUTO_MODE: "0",
    DORO_AUTO_SWITCH: "0",
    DORO_AUTO_BACKUP: "0",
    DORO_IDENTITY_GUARD: "0",
    DORO_IDENTITY_STRICT: "0",
    DORO_IPGUARD_ENABLED: "0",
    DORO_RESPONSE_CACHE: "0",
    DORO_SAFE_STREAM_FAILOVER_CHAT: "0",
    DORO_FORCE_STREAM_NONSTREAM: "0",
    DORO_TRUNCATE_HISTORY: "0",
    DORO_BACKEND1_DISABLE_TOOLS: "0",
    DORO_BACKEND1_USER_ASSISTANT_ONLY: "0",
    DORO_ACCESS_LOG_DIR: logDir,
  };

  let proxyOut = "";
  proxy = spawn(process.execPath, [PROXY_ENTRY], { env, cwd: ROOT });
  proxy.stdout.on("data", (d) => { proxyOut += d.toString(); });
  proxy.stderr.on("data", (d) => { proxyOut += d.toString(); });

  // wait for health
  let healthy = false;
  for (let i = 0; i < 60; i += 1) {
    if (proxy.exitCode !== null) break;
    try {
      const r = await httpJson("GET", proxyPort, "/health");
      if (r.status === 200) { healthy = true; break; }
    } catch (_) {}
    await sleep(200);
  }
  if (!healthy) throw new Error(`proxy did not become healthy.\n--- proxy output ---\n${proxyOut}`);

  const auth = { authorization: `Bearer ${API_KEY}` };

  // ── 1. OpenAI chat non-stream: tools + tool history ────────────────────────
  {
    const before = captured.length;
    const r = await httpJson("POST", proxyPort, "/v1/chat/completions", OPENAI_TOOLS("gpt-5.6-terra"), auth);
    const j = parseJson(r.text) || {};
    check("openai: status 200", r.status === 200, `status=${r.status} body=${r.text.slice(0, 200)}`);
    check("openai: public model masked", j.model === "gpt-5.6-terra", `model=${j.model}`);
    const call = (((j.choices || [])[0] || {}).message || {}).tool_calls || [];
    check("openai: tool_calls present", call.length === 1, JSON.stringify(call).slice(0, 200));
    check("openai: tool name kept", call[0] && call[0].function && call[0].function.name === "write_file", call[0] && call[0].function && call[0].function.name);
    check("openai: args kept", call[0] && call[0].function && call[0].function.arguments === '{"path":"out.txt","content":"hello"}', call[0] && call[0].function && call[0].function.arguments);
    check("openai: finish tool_calls", ((j.choices || [])[0] || {}).finish_reason === "tool_calls");

    const sent = captured[before].body;
    const sentToolNames = (sent.tools || []).map((t) => t.function.name);
    check("openai->backend: tools forwarded", JSON.stringify(sentToolNames) === JSON.stringify(["read_file", "write_file"]), JSON.stringify(sentToolNames));
    const writeSchema = (sent.tools || []).find((t) => t.function.name === "write_file");
    check("openai->backend: schema kept", writeSchema && JSON.stringify(writeSchema.function.parameters.required) === JSON.stringify(["path", "content"]));
    check("openai->backend: backend model used", sent.model === "deepseek-v4-pro", sent.model);
    const toolMsg = (sent.messages || []).find((m) => m.role === "tool");
    check("openai->backend: tool_result history kept", !!toolMsg && toolMsg.tool_call_id === "call_prev" && toolMsg.content === "nội dung file gốc", JSON.stringify(toolMsg));
  }

  // ── 2. OpenAI chat stream: tool call reconstructed ─────────────────────────
  {
    const body = { ...OPENAI_TOOLS("gpt-5.6-terra"), stream: true };
    const r = await httpJson("POST", proxyPort, "/v1/chat/completions", body, auth);
    const got = collectOpenAIToolCalls(r.text);
    check("openai stream: status 200", r.status === 200, `status=${r.status}`);
    check("openai stream: name kept", got.name === "write_file", got.name);
    check("openai stream: args kept", got.args === '{"path":"out.txt","content":"hello"}', got.args);
    check("openai stream: finish tool_calls", got.finish === "tool_calls", String(got.finish));
    check("openai stream: DONE sent", r.text.includes("[DONE]"));
  }

  // ── 3. Anthropic non-stream: tools + tool_use ──────────────────────────────
  {
    const before = captured.length;
    const r = await httpJson("POST", proxyPort, "/v1/messages", ANTHROPIC_TOOLS("claude-opus-4-6"), auth);
    const j = parseJson(r.text) || {};
    check("anthropic: status 200", r.status === 200, `status=${r.status} body=${r.text.slice(0, 200)}`);
    check("anthropic: model masked", j.model === "claude-opus-4-6", j.model);
    const block = (j.content || []).find((b) => b.type === "tool_use");
    check("anthropic: tool_use present", !!block, JSON.stringify(j.content || []).slice(0, 200));
    check("anthropic: tool name kept", block && block.name === "write_file", block && block.name);
    check("anthropic: tool input kept", block && block.input && block.input.path === "out.txt" && block.input.content === "hello", JSON.stringify(block && block.input));
    check("anthropic: stop_reason tool_use", j.stop_reason === "tool_use", j.stop_reason);

    const sent = captured[before].body;
    check("anthropic->backend: tool converted", sent.tools && sent.tools[0].function.name === "write_file", JSON.stringify((sent.tools || []).map((t) => t.function && t.function.name)));
    check("anthropic->backend: input_schema kept", sent.tools && JSON.stringify(sent.tools[0].function.parameters.required) === JSON.stringify(["path", "content"]));
  }

  // ── 4. Anthropic stream: tool_use + input_json_delta ──────────────────────
  {
    const body = { ...ANTHROPIC_TOOLS("claude-opus-4-6"), stream: true };
    const r = await httpJson("POST", proxyPort, "/v1/messages", body, auth);
    const got = collectAnthropicToolUse(r.text);
    check("anthropic stream: status 200", r.status === 200, `status=${r.status}`);
    check("anthropic stream: tool_use name", got.name === "write_file", got.name);
    check("anthropic stream: input json reconstructed", got.json === '{"path":"out.txt","content":"hello"}', got.json);
    check("anthropic stream: message_stop", got.sawStop === true);
  }

  // ── 5. Responses (Codex) function tool non-stream ──────────────────────────
  {
    const before = captured.length;
    const body = RESPONSES_TOOLS("gpt-5.6-terra", [
      { type: "function", name: "write_file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
    ]);
    const r = await httpJson("POST", proxyPort, "/v1/responses", body, auth);
    const j = parseJson(r.text) || {};
    check("responses: status 200", r.status === 200, `status=${r.status} body=${r.text.slice(0, 200)}`);
    check("responses: object response", j.object === "response", j.object);
    check("responses: model masked", j.model === "gpt-5.6-terra", j.model);
    const item = (j.output || []).find((o) => o.type === "function_call");
    check("responses: function_call present", !!item, JSON.stringify((j.output || []).map((o) => o.type)));
    check("responses: function name kept", item && item.name === "write_file", item && item.name);
    check("responses: arguments kept", item && item.arguments === '{"path":"out.txt","content":"hello"}', item && item.arguments);
    const sent = captured[before].body;
    check("responses->backend: tool forwarded", sent.tools && sent.tools[0].function.name === "write_file", JSON.stringify((sent.tools || []).map((t) => t.function && t.function.name)));
  }

  // ── 6. Responses (Codex) custom tool apply_patch non-stream ────────────────
  {
    const before = captured.length;
    const body = RESPONSES_TOOLS("gpt-5.6-terra", [{ type: "custom", name: "apply_patch", description: "patch" }]);
    const r = await httpJson("POST", proxyPort, "/v1/responses", body, auth);
    const j = parseJson(r.text) || {};
    check("responses custom: status 200", r.status === 200, `status=${r.status} body=${r.text.slice(0, 200)}`);
    const item = (j.output || []).find((o) => o.type === "custom_tool_call");
    check("responses custom: custom_tool_call present", !!item, JSON.stringify((j.output || []).map((o) => o.type)));
    check("responses custom: name kept", item && item.name === "apply_patch", item && item.name);
    check("responses custom: input restored", item && item.input === PATCH, item && item.input);
    const sent = captured[before].body;
    const t = (sent.tools || [])[0];
    check("responses custom->backend: wrapped as function(input)", t && t.function.name === "apply_patch" && JSON.stringify(t.function.parameters.required) === JSON.stringify(["input"]), JSON.stringify(t));
  }

  // ── 7. Responses (Codex) stream: function_call item + completed ────────────
  {
    const body = {
      ...RESPONSES_TOOLS("gpt-5.6-terra", [
        { type: "function", name: "write_file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      ]),
      stream: true,
    };
    const r = await httpJson("POST", proxyPort, "/v1/responses", body, auth);
    const got = collectResponsesItems(r.text);
    check("responses stream: status 200", r.status === 200, `status=${r.status}`);
    const item = got.items.find((o) => o.type === "function_call");
    check("responses stream: function_call item", !!item, JSON.stringify(got.items.map((o) => o.type)));
    check("responses stream: name kept", item && item.name === "write_file", item && item.name);
    check("responses stream: arguments kept", item && item.arguments === '{"path":"out.txt","content":"hello"}', item && item.arguments);
    check("responses stream: response.completed", got.completed === true);
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("Failed:\n - " + failures.join("\n - "));
    process.exitCode = 1;
  }
}

async function cleanup() {
  try { if (proxy && proxy.exitCode === null) proxy.kill(); } catch (_) {}
  await new Promise((r) => mock.close(r));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}

main()
  .catch((err) => {
    console.error("UNEXPECTED", err && err.stack || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    process.exit(process.exitCode || 0);
  });
