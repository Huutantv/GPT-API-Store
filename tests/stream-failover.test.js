"use strict";

// Tests cho buffered-failover chat/messages.
// Cách chạy: node tests/stream-failover.test.js
//
// Trọng tâm: khi bật DORO_SAFE_STREAM_FAILOVER_CHAT và còn backend kế tiếp,
// stream bị cắt (không có finish_reason/[DONE]) KHÔNG được gửi gì cho khách mà
// phải throw để handler failover sang backend khác.

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
const optionalIntCluster = slice("function optionalPositiveInt(", "function vnDateTimeAfterDays(");
const sseCluster = slice("function setSseHeaders(", "function incompleteBackendStreamError(");
const incompleteCluster = slice("function incompleteBackendStreamError(", "function safeStreamFailoverEnabled(");
const flagCluster = slice("function safeStreamFailoverEnabled(", "function forceStreamNonstreamEnabled(");
const bufferCluster = slice("function ssePayloadHasCompletionMarker(", "function emitAnthropicBufferedStream(");
const streamOpenAICluster = slice("async function streamOpenAIWithFailover(", "function friendlyErrorMessage(");
const streamAnthropicCluster = slice("async function streamAnthropicWithFailover(", "async function streamOpenAIWithFailover(");

const stubs = `
function orderedBackendKeys(keys){ return Array.isArray(keys) ? keys : []; }
function backendChatUrl(settings, fallbackUrl){ return fallbackUrl || ((settings && settings.baseUrl) + "/chat/completions"); }
function backendWireHeaders(){ return {}; }
function backendWirePayload(payload){ return payload; }
const backendStreamTimeoutMs = 300000;
async function withBackendKeySlot(key, fn){ return fn(); }
async function fetchWithTimeout(){ return globalThis.__nextResp; }
async function rejectHtmlUpstreamResponse(resp){ return resp; }
function addLog(){}
function logPreview(t){ return String(t || "").slice(0, 40); }
function recordBackendErrorObservation(){}
function backendErrorFromPayload(){ return null; }
function anthropicStreamEventToOpenAIChunks(parsed){ return [parsed]; }
function filterHiddenReasoningDelta(t){ return t; }
function sanitizeAssistantIdentityChunk(t){ return t; }
function flushAssistantIdentityChunk(){ return ""; }
function assertNoMojibakeForSourceEdit(){}
function normalizeOpenAIAssistantPayload(){}
function hasOpenAIAssistantOutput(item){ const d=((item.choices||[{}])[0]||{}).delta||{}; return !!(d.content || d.tool_calls); }
function trackBackendSuccess(){}
function trackBackendKeyResult(){}
function clearBackendErrorObservation(){}
function trackBackendError(){}
function backendFailureSignal(){ return null; }
function isRetryableStatus(s){ return [408,401,402,403,429,500,502,503,504,524].includes(Number(s)); }
function isRetryableAcrossKeys(s){ return [408,429,500,502,503,504,524].includes(Number(s)); }
function shouldFailoverBackend(){ return true; }
function retryDelayMs(){ return 0; }
const backendStreamRetryCount = 3;
function publicBackendError(){ return { message: "public-error", type: "api_error", code: "" }; }
function clientBackendStatus(s){ return Number(s) || 502; }
function openaiErrorPayload(status, message){ return { error: { message: message || "err", type: "api_error", code: "" } }; }
function publicBackendFallbackMessage(){ return "fallback"; }
const credit = { settleRequest(){} };
function startSseHeartbeat(res){ res.__heartbeats = (res.__heartbeats || 0) + 1; return function stop(){}; }
function sseWrite(res, event, data){ res._chunks.push("event: " + event + "\\ndata: " + JSON.stringify(data) + "\\n\\n"); }
function anthropicErrorPayload(status, message){ return { type: "error", error: { type: "api_error", message: message || "err" } }; }
function messagesLookLikeSourceEdit(){ return false; }
async function pipeOpenAIStreamToAnthropic(resp, res){ res._piped = true; }
async function pipeAnthropicStreamToAnthropic(resp, res){ res._piped = true; }
`;

const ctx = {
  console,
  process,
  Buffer,
  Response,
  ReadableStream,
  Headers,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  [envFlagCluster, optionalIntCluster, sseCluster, incompleteCluster, flagCluster, bufferCluster, stubs, streamAnthropicCluster, streamOpenAICluster].join("\n"),
  ctx,
);

const {
  safeStreamFailoverChatEnabled,
  safeStreamFailoverEnabled,
  bufferCompleteBackendStream,
  streamOpenAIWithFailover,
  streamAnthropicWithFailover,
} = ctx;

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

function makeRes() {
  return {
    headersSent: false,
    _chunks: [],
    _ended: false,
    _json: null,
    _status: 200,
    setHeader() {},
    flushHeaders() { this.headersSent = true; },
    write(c) { this._chunks.push(String(c)); return true; },
    end(c) { if (c !== undefined) this._chunks.push(String(c)); this._ended = true; },
    status(s) { this._status = s; return this; },
    json(o) { this._json = o; this._ended = true; return this; },
    once() {},
    getHeader() { return "text/event-stream"; },
  };
}

function sseResponse(bodyText, status = 200) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bodyText));
      controller.close();
    },
  });
  return { ok: status < 400, status, body: stream, headers: new Headers(), text: async () => bodyText };
}

const TRUNCATED_OPENAI =
  'data: {"id":"x","choices":[{"index":0,"delta":{"content":"hello "},"finish_reason":null}]}\n\n' +
  'data: {"id":"x","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":null}]}\n\n';

const COMPLETE_OPENAI =
  'data: {"id":"x","choices":[{"index":0,"delta":{"content":"hello "},"finish_reason":null}]}\n\n' +
  'data: {"id":"x","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":null}]}\n\n' +
  'data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
  "data: [DONE]\n\n";

const settings = { apiStyle: "openai", profileId: "2", profileLabel: "Backend 2", backendModel: "m", baseUrl: "http://x/v1" };
const payload = { model: "m", stream: true, messages: [{ role: "user", content: "hi" }] };

async function runStream(res, deferErrorToCaller) {
  return streamOpenAIWithFailover(
    res,
    "http://x/v1/chat/completions",
    payload,
    ["k1"],
    "gpt-public",
    "m",
    null,
    null,
    "gpt-public",
    "req1",
    settings,
    deferErrorToCaller,
  );
}

async function runMessages(res, deferErrorToCaller) {
  return streamAnthropicWithFailover(
    res,
    "http://x/v1/chat/completions",
    payload,
    ["k1"],
    "gpt-public",
    "m",
    null,
    null,
    "gpt-public",
    "req1",
    settings,
    deferErrorToCaller,
  );
}

(async () => {
  // ── Flag ──────────────────────────────────────────────────────────────────
  delete process.env.DORO_SAFE_STREAM_FAILOVER_CHAT;
  check("flag default off", safeStreamFailoverChatEnabled() === false);
  process.env.DORO_SAFE_STREAM_FAILOVER_CHAT = "1";
  check("flag on with 1", safeStreamFailoverChatEnabled() === true);
  process.env.DORO_SAFE_STREAM_FAILOVER_CHAT = "0";
  check("flag off with 0", safeStreamFailoverChatEnabled() === false);
  process.env.DORO_SAFE_STREAM_FAILOVER_CHAT = "1";

  // ── bufferCompleteBackendStream ────────────────────────────────────────────
  {
    const resp = await bufferCompleteBackendStream(sseResponse(COMPLETE_OPENAI), false);
    const body = await resp.text();
    check("buffer: complete openai preserved", body.includes("hello ") && body.includes("[DONE]"));
  }
  {
    let threw = null;
    try {
      await bufferCompleteBackendStream(sseResponse(TRUNCATED_OPENAI), false);
    } catch (e) {
      threw = e;
    }
    check("buffer: truncated throws incomplete_backend_stream", !!threw && threw.code === "incomplete_backend_stream");
  }
  {
    const anthropicComplete =
      'event: message_start\ndata: {"type":"message_start"}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    const resp = await bufferCompleteBackendStream(sseResponse(anthropicComplete), true);
    check("buffer: complete anthropic ok", (await resp.text()).includes("message_stop"));
  }
  {
    const prev = process.env.DORO_SAFE_STREAM_MAX_BYTES;
    process.env.DORO_SAFE_STREAM_MAX_BYTES = "10";
    let threw = null;
    try {
      await bufferCompleteBackendStream(sseResponse(COMPLETE_OPENAI), false);
    } catch (e) {
      threw = e;
    }
    if (prev === undefined) delete process.env.DORO_SAFE_STREAM_MAX_BYTES;
    else process.env.DORO_SAFE_STREAM_MAX_BYTES = prev;
    check("buffer: over limit throws", !!threw && threw.code === "incomplete_backend_stream");
  }

  // ── Buffered chat failover behavior ────────────────────────────────────────
  {
    // 2 backends (còn backend kế): truncated phải throw, KHÔNG gửi gì cho khách.
    const res = makeRes();
    ctx.__nextResp = sseResponse(TRUNCATED_OPENAI);
    let threw = null;
    try {
      await runStream(res, true);
    } catch (e) {
      threw = e;
    }
    check("chat buffered: truncated throws to caller", !!threw);
    check("chat buffered: no content written", res._chunks.length === 0);
    check("chat buffered: headers flushed before buffering", res.headersSent === true);
    check("chat buffered: marker set", res.__chatStreamFlushed === true);
  }
  {
    // 2 backends: stream hoàn chỉnh -> phát cho khách bình thường.
    const res = makeRes();
    ctx.__nextResp = sseResponse(COMPLETE_OPENAI);
    await runStream(res, true);
    const out = res._chunks.join("");
    check("chat buffered: complete content sent", out.includes("hello ") && out.includes("world"));
    check("chat buffered: DONE sent", out.includes("[DONE]"));
    check("chat buffered: ended", res._ended === true);
    check("chat buffered: marker set on success", res.__chatStreamFlushed === true);
  }
  {
    // 1 backend (không còn backend kế): giữ hành vi cũ — gửi partial + error.
    const res = makeRes();
    ctx.__nextResp = sseResponse(TRUNCATED_OPENAI);
    await runStream(res, false);
    const out = res._chunks.join("");
    check("single backend: no throw, error sent", out.includes("[DONE]"));
    check("single backend: not buffered", !res.__chatStreamFlushed);
  }

  // ── Buffered messages (/v1/messages) failover behavior ─────────────────────
  {
    // 2 backends: truncated phải throw, KHÔNG gửi gì cho khách.
    const res = makeRes();
    ctx.__nextResp = sseResponse(TRUNCATED_OPENAI);
    let threw = null;
    try {
      await runMessages(res, true);
    } catch (e) {
      threw = e;
    }
    check("messages buffered: truncated throws to caller", !!threw);
    check("messages buffered: no content written", res._chunks.length === 0);
    check("messages buffered: headers flushed before buffering", res.headersSent === true);
    check("messages buffered: marker set", res.__chatStreamFlushed === true);
    check("messages buffered: pipe not called on truncation", !res._piped);
  }
  {
    // 2 backends: stream hoàn chỉnh -> pipe cho khách.
    const res = makeRes();
    ctx.__nextResp = sseResponse(COMPLETE_OPENAI);
    await runMessages(res, true);
    check("messages buffered: piped on complete", res._piped === true);
    check("messages buffered: marker set on success", res.__chatStreamFlushed === true);
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})().catch((err) => {
  console.error("UNEXPECTED", err);
  process.exit(1);
});
