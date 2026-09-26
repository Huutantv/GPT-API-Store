"use strict";

// Tests cho Auto Backup: khi main 1-7 fail het -> dung backup, probe main 60s.
// Chay: node tests/auto-backup.test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "doro_proxy_node.js"), "utf8");

function slice(fromMarker, toMarker) {
  const start = SRC.indexOf(fromMarker);
  const end = SRC.indexOf(toMarker);
  if (start === -1 || end === -1 || end <= start) throw new Error(`cannot slice ${fromMarker} -> ${toMarker}`);
  return SRC.slice(start, end);
}

const cluster = slice("function autoBackupEnabled(", "function trackAutoSwitchError(");

const stubs = `
var BACKEND_IDS = ["1", "2", "3"];
var BACKUP_BACKEND_IDS = ["backup1", "backup2"];
var __autoSwitchOn = false;
var __backups = [{ profileId: "backup1" }, { profileId: "backup2" }];
var __notifications = [];
function autoSwitchEnabled(){ return __autoSwitchOn; }
function autoSwitchBackupSettings(){ return __backups.slice(); }
function autoSwitchBackupLabel(){ return "Backup 1 + Backup 2"; }
function addLog(){}
function notifyTelegram(m){ __notifications.push(m); }
function vnNowText(){ return "now"; }
`;

const ctx = { console, process, Date };
vm.createContext(ctx);
vm.runInContext([stubs, cluster, "var __autoBackup = _autoBackup;"].join("\n"), ctx);

const { withAutoBackup, noteAutoBackupAttempt, noteAutoBackupExhausted, exitAutoBackup } = ctx;

const M1 = { profileId: "1" }, M2 = { profileId: "2" }, B1 = { profileId: "backup1" }, B2 = { profileId: "backup2" };
const ids = (chain) => chain.map((s) => s.profileId).join(",");

let pass = 0;
const failures = [];
function check(name, cond) { if (cond) pass += 1; else { failures.push(name); console.log("FAIL " + name); } }
function resetState() {
  ctx.__autoSwitchOn = false;
  ctx.__backups = [B1, B2];
  ctx.__autoBackup.active = false;
  ctx.__autoBackup.since = null;
  ctx.__autoBackup.lastProbeAt = null;
  ctx.__autoBackup.bothDownNotified = false;
}

// ── flag off ─────────────────────────────────────────────────────────────────
delete process.env.DORO_AUTO_BACKUP;
resetState();
check("flag off -> chain unchanged", ids(withAutoBackup([M1, M2], "m")) === "1,2");

// ── flag on, not active: mains + backups ─────────────────────────────────────
process.env.DORO_AUTO_BACKUP = "1";
resetState();
check("not active -> mains+backups", ids(withAutoBackup([M1, M2], "m")) === "1,2,backup1,backup2");

// ── auto-switch on -> skip ───────────────────────────────────────────────────
resetState();
ctx.__autoSwitchOn = true;
check("auto-switch on -> unchanged", ids(withAutoBackup([M1], "m")) === "1");
ctx.__autoSwitchOn = false;

// ── enter when backup attempted ──────────────────────────────────────────────
resetState();
noteAutoBackupAttempt("backup1");
check("attempt backup1 -> active", ctx.__autoBackup.active === true);
check("enter -> notified", ctx.__notifications.length >= 1);
noteAutoBackupAttempt("1");
check("attempt main -> still active", ctx.__autoBackup.active === true);

// ── active, not probe: backups + mains ───────────────────────────────────────
ctx.__autoBackup.lastProbeAt = Date.now();
check("active not probe -> backups+mains", ids(withAutoBackup([M1, M2], "m")) === "backup1,backup2,1,2");

// ── active, probe due: mains + backups ───────────────────────────────────────
ctx.__autoBackup.lastProbeAt = Date.now() - 61000;
check("active probe -> mains+backups", ids(withAutoBackup([M1, M2], "m")) === "1,2,backup1,backup2");

// ── dedupe ───────────────────────────────────────────────────────────────────
resetState();
ctx.__autoBackup.active = false;
check("dedupe existing backup", ids(withAutoBackup([M1, B1], "m")) === "1,backup1,backup2");

// ── exit when main succeeds ──────────────────────────────────────────────────
resetState();
noteAutoBackupAttempt("backup1");
check("active before exit", ctx.__autoBackup.active === true);
exitAutoBackup("test");
check("exit clears active", ctx.__autoBackup.active === false);

// ── backups empty while active -> exit ───────────────────────────────────────
resetState();
noteAutoBackupAttempt("backup1");
ctx.__backups = [];
const chainWhenEmpty = withAutoBackup([M1], "m");
check("no backups -> returns mains", ids(chainWhenEmpty) === "1");
check("no backups -> exit", ctx.__autoBackup.active === false);

// ── both-down notify only once ───────────────────────────────────────────────
resetState();
noteAutoBackupAttempt("backup1");
ctx.__notifications = [];
noteAutoBackupExhausted();
noteAutoBackupExhausted();
check("both-down notified once", ctx.__notifications.length === 1);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
