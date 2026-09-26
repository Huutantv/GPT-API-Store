"use strict";

// Tests cho backend health theo key: 1 key lỗi (auth/quota/rate-limit) KHÔNG được
// hạ cả backend khi backend còn key khác khả dụng.
// Chạy: node tests/backend-health.test.js

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

const cluster = slice("function isKeyScopedFailure(", "function trackBackendSuccess(");

const stubs = `
var __available = [];
var __errors = [];
var backendKeyInflight = new Map();
var keyHealth = { rankKeys: function(){ return { available: __available.slice(), skipped: [] }; } };
function trackBackendError(id, status, text, code){ __errors.push({ id: id, status: status, text: text, code: code }); }
function addLog(){}
`;

const ctx = { console, process };
vm.createContext(ctx);
vm.runInContext([stubs, cluster].join("\n"), ctx);

const { isKeyScopedFailure, trackBackendFailure } = ctx;

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

// ── isKeyScopedFailure ───────────────────────────────────────────────────────
check("key-scoped: 401", isKeyScopedFailure(401, "", "") === true);
check("key-scoped: 402", isKeyScopedFailure(402, "", "") === true);
check("key-scoped: 403", isKeyScopedFailure(403, "", "") === true);
check("key-scoped: 429", isKeyScopedFailure(429, "", "") === true);
check("key-scoped: quota text", isKeyScopedFailure(400, "quota exceeded", "") === true);
check("key-scoped: exceeded text", isKeyScopedFailure(403, "insufficient balance", "") === true);
check("key-scoped: 500 false", isKeyScopedFailure(500, "", "") === false);
check("key-scoped: 502 false", isKeyScopedFailure(502, "bad gateway", "") === false);
check("key-scoped: 400 invalid false", isKeyScopedFailure(400, "invalid request body", "") === false);
check("key-scoped: network 0 false", isKeyScopedFailure(0, "", "") === false);

// ── trackBackendFailure ──────────────────────────────────────────────────────
// 403 key-level + còn key khác -> KHÔNG hạ backend
ctx.__available = ["k2"];
ctx.__errors = [];
trackBackendFailure("5", ["k1", "k2"], 403, "quota exceeded", "");
check("403 + con key -> khong ha backend", ctx.__errors.length === 0);

// 403 key-level + hết key -> hạ backend
ctx.__available = [];
ctx.__errors = [];
trackBackendFailure("5", ["k1"], 403, "quota exceeded", "");
check("403 + het key -> ha backend", ctx.__errors.length === 1 && ctx.__errors[0].id === "5");

// 429 key-level + còn key khác -> KHÔNG hạ backend
ctx.__available = ["k2"];
ctx.__errors = [];
trackBackendFailure("5", ["k1", "k2"], 429, "", "");
check("429 + con key -> khong ha backend", ctx.__errors.length === 0);

// 502 backend-level + còn key khác -> VẪN hạ backend
ctx.__available = ["k2"];
ctx.__errors = [];
trackBackendFailure("5", ["k1", "k2"], 502, "bad gateway", "");
check("502 + con key -> van ha backend", ctx.__errors.length === 1);

// network (status 0) -> hạ backend
ctx.__available = ["k2"];
ctx.__errors = [];
trackBackendFailure("5", ["k1", "k2"], 0, "socket hang up", "");
check("network -> ha backend", ctx.__errors.length === 1);

// backendId rỗng -> no-op
ctx.__available = [];
ctx.__errors = [];
trackBackendFailure("", ["k1"], 403, "", "");
check("backendId rong -> no-op", ctx.__errors.length === 0);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
