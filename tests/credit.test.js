"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DB_PATH = path.join(os.tmpdir(), `doro-credit-test-${process.pid}-${Date.now()}.db`);
process.env.DORO_DB_PATH = DB_PATH;

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch (_) {}
  }
}

let pass = 0;
const failures = [];
function check(name, cond) {
  if (cond) pass += 1;
  else {
    failures.push(name);
    console.log("FAIL " + name);
  }
}

try {
  const credit = require("../credit");

  // 1. Bug chính: credit về 0 nhưng token còn dư do reservation "treo" (crash/restart)
  //    làm pending phình to -> token bị chia nhỏ, không về 0.
  const k1 = credit.createKey({ credit: 2, tokenRemaining: 1000 });
  credit.reserveRequest(k1.key, "stale-1", "m");   // credit 2 -> 1, reservation treo
  credit.reserveRequest(k1.key, "last-1", "m");    // credit 1 -> 0
  credit.settleRequest("last-1", 100, 100, "m");
  const row1 = credit.getKey(k1.key);
  check("settle: credit ve 0", Number(row1.credit) === 0);
  check("settle: token ve 0 khi het credit", Number(row1.token_remaining) === 0);

  // 2. Admin giảm credit về 0 -> token cũng phải về 0.
  const k2 = credit.createKey({ credit: 5, tokenRemaining: 5000 });
  credit.adjustCredit(k2.key, -5, "test");
  const row2 = credit.getKey(k2.key);
  check("adjustCredit: token ve 0 khi het credit", Number(row2.credit) === 0 && Number(row2.token_remaining) === 0);

  // 3. Key cũ đã lệch (credit=0, token>0) -> hàm reconcile phải kéo token về 0.
  check("co reconcileQuotaInvariant", typeof credit.reconcileQuotaInvariant === "function");
  const k3 = credit.createKey({ credit: 0, tokenRemaining: 1000 });
  if (typeof credit.reconcileQuotaInvariant === "function") credit.reconcileQuotaInvariant();
  const row3 = credit.getKey(k3.key);
  check("reconcile: token ve 0 khi credit 0", Number(row3.token_remaining) === 0);

  // 4. getQuotaInfo (dùng cho /api/credit/balance) không được trả token > 0 khi credit = 0.
  const k4 = credit.createKey({ credit: 0, tokenRemaining: 777 });
  const info4 = credit.getQuotaInfo(credit.getKey(k4.key));
  check("quotaInfo: token 0 khi credit 0", Number(info4.token_remaining) === 0);

  // 5. Reservation treo phải được refund khi khởi động lại -> credit không bị mất oan.
  check("co refundStaleReservations", typeof credit.refundStaleReservations === "function");
  const k5 = credit.createKey({ credit: 3, tokenRemaining: 3000 });
  credit.reserveRequest(k5.key, "orphan-1", "m"); // credit 3 -> 2
  if (typeof credit.refundStaleReservations === "function") credit.refundStaleReservations();
  const row5 = credit.getKey(k5.key);
  check("refundStale: credit duoc hoan", Number(row5.credit) === 3);
} catch (err) {
  failures.push("exception: " + err.message);
  console.log("FAIL exception: " + err.stack);
} finally {
  cleanup();
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
