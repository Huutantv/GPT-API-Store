"use strict";

// Tests cho tổng quát hoá Backend 5+5v thành nhiều context+vision (5/6/7 + 5v/6v/7v).
// Chạy: node tests/backend-vision.test.js

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

const constCluster = slice("const BACKEND_IDS", "const BACKUP_BACKEND_IDS");
const visionProfileCluster = slice("function backendVisionProfile(", "function resolveBackendModel(");
const resolveCluster = slice("function activeVisionBackendIds(", "const _backendHealth");

const stubs = `
function splitEnvList(v){ return String(v || "").split(",").map(function(s){ return s.trim(); }).filter(Boolean); }
function normalizeOpenAIBaseUrl(v){ return String(v || "").replace(/\\/+$/, ""); }
function optionalPositiveInt(v){ var n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
function envFlag(v, f){ var r = String(v == null ? "" : v).trim().toLowerCase(); if (["1","true","yes","on"].includes(r)) return true; if (["0","false","no","off"].includes(r)) return false; return !!f; }
function normalizeApiStyle(v){ return String(v || "").trim().toLowerCase() === "anthropic" ? "anthropic" : "openai"; }
var __activeIds = [];
var __img = 0;
function activeBackendIds(){ return __activeIds.slice(); }
function orderActiveBackendIds(ids){ return ids; }
function backendProfile(id){ return { id: String(id), label: "Backend " + id, apiKeys: ["k"], backendModel: "m", baseUrl: "http://x", apiStyle: "openai" }; }
function profileToSettings(p){ return { profileId: p.id, profileLabel: p.label, apiKeys: p.apiKeys, isVision: !!p.isVision, backendModel: p.backendModel, baseUrl: p.baseUrl, apiStyle: p.apiStyle }; }
function latestUserImageCount(){ return __img; }
function totalImageCount(){ return __img; }
function stripHistoricalImages(m){ return m; }
`;

const ctx = { console, process };
vm.createContext(ctx);
vm.runInContext(
  [stubs, constCluster, visionProfileCluster, resolveCluster,
    "var __BACKEND_IDS = BACKEND_IDS; var __VISION_BACKEND_IDS = VISION_BACKEND_IDS;"].join("\n"),
  ctx,
);

const BACKEND_IDS = ctx.__BACKEND_IDS;
const VISION_BACKEND_IDS = ctx.__VISION_BACKEND_IDS;
const { backendVisionProfile, resolveContextVisionPair } = ctx;

let pass = 0;
const failures = [];
function check(name, cond) {
  if (cond) pass += 1;
  else { failures.push(name); console.log("FAIL " + name); }
}

// ── Constants ────────────────────────────────────────────────────────────────
check("BACKEND_IDS has 1..7", Array.isArray(BACKEND_IDS) && BACKEND_IDS.length === 7
  && ["1","2","3","4","5","6","7"].every((id) => BACKEND_IDS.includes(id)));
check("VISION_BACKEND_IDS = 5,6,7", Array.isArray(VISION_BACKEND_IDS)
  && VISION_BACKEND_IDS.join(",") === "5,6,7");

// ── backendVisionProfile ─────────────────────────────────────────────────────
function clearVisionEnv(id) {
  for (const f of ["BASE_URL", "MODEL", "AUTH_TOKEN", "API_STYLE", "NAME", "MAX_TOKENS"]) {
    delete process.env[`DORO_BACKEND${id}_VISION_${f}`];
  }
}
clearVisionEnv("5"); clearVisionEnv("6"); clearVisionEnv("7");

process.env.DORO_BACKEND6_VISION_BASE_URL = "https://v6.example/v1";
process.env.DORO_BACKEND6_VISION_MODEL = "gpt-4o";
process.env.DORO_BACKEND6_VISION_AUTH_TOKEN = "sk-a,sk-b";
{
  const p = backendVisionProfile("6");
  check("vision profile id 6v", p.id === "6v");
  check("vision profile keys parsed", p.apiKeys.length === 2);
  check("vision profile configured", p.configured === true);
  check("vision profile apiStyle default openai", p.apiStyle === "openai");
  check("vision profile label default", p.label === "Backend 6 Vision");
}
{
  const p = backendVisionProfile("6v");
  check("vision profile accepts 6v too", p.id === "6v");
}
{
  const p = backendVisionProfile("5");
  check("vision profile 5 unconfigured", p.configured === false && p.id === "5v");
}

// ── resolveContextVisionPair: image -> vision chain (failover order) ──────────
ctx.__img = 1;
ctx.__activeIds = ["5", "6"];
clearVisionEnv("5"); clearVisionEnv("6");
process.env.DORO_BACKEND5_VISION_BASE_URL = "https://v5.example/v1";
process.env.DORO_BACKEND5_VISION_MODEL = "qwen-vl";
process.env.DORO_BACKEND5_VISION_AUTH_TOKEN = "sk-5";
process.env.DORO_BACKEND6_VISION_BASE_URL = "https://v6.example/v1";
process.env.DORO_BACKEND6_VISION_MODEL = "gpt-4o";
process.env.DORO_BACKEND6_VISION_AUTH_TOKEN = "sk-6";
{
  const r = resolveContextVisionPair([], "m");
  check("image chain has 5v,6v", r.requestType === "image"
    && r.chain.length === 2
    && r.chain[0].profileId === "5v" && r.chain[1].profileId === "6v");
}
{
  // 5v chưa cấu hình -> chỉ còn 6v
  clearVisionEnv("5");
  const r = resolveContextVisionPair([], "m");
  check("image chain skips unconfigured 5v", r.chain.length === 1 && r.chain[0].profileId === "6v");
}
{
  // không vision nào cấu hình -> lỗi
  clearVisionEnv("6");
  const r = resolveContextVisionPair([], "m");
  check("image no vision -> error", !!r.error && r.error.code === "vision_backend_not_configured");
}

// ── resolveContextVisionPair: text -> normal chain ───────────────────────────
ctx.__img = 0;
ctx.__activeIds = ["2", "5"];
{
  const r = resolveContextVisionPair([], "m");
  check("text chain normal", r.requestType === "text" && r.chain.length === 2
    && r.chain[0].profileId === "2" && r.chain[1].profileId === "5");
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
