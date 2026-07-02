const DEFAULT_TOKEN_PER_REQUEST = 85000;

const PACKAGE_TOKEN_QUOTAS = Object.freeze({
  starter: 30000000,
  pro: 900000000,
  pro_v2: 1000000000,
});

const PACKAGE_DURATION_DAYS = Object.freeze({
  starter: 1,
  pro: 30,
  pro_v2: 30,
  ultra: 30,
});

function positiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function getTokenPerRequest() {
  return positiveInt(
    process.env.DORO_TOKEN_PER_REQUEST || process.env.DORO_TOKEN_PER_REQUEST_MIN,
    DEFAULT_TOKEN_PER_REQUEST,
  );
}

function getPackageTokenQuota(packageId) {
  return PACKAGE_TOKEN_QUOTAS[String(packageId || "").trim()] || 0;
}

function getPackageDurationDays(packageId) {
  return PACKAGE_DURATION_DAYS[String(packageId || "").trim()] || 0;
}

function tokensToRequestQuota(tokenQuota, tokenPerRequest = getTokenPerRequest()) {
  const quota = positiveInt(tokenQuota);
  const perRequest = positiveInt(tokenPerRequest, DEFAULT_TOKEN_PER_REQUEST);
  return quota > 0 ? Math.floor(quota / perRequest) : 0;
}

function getPackageRequestQuota(packageId, tokenPerRequest = getTokenPerRequest()) {
  return tokensToRequestQuota(getPackageTokenQuota(packageId), tokenPerRequest);
}

function withComputedPackageQuota(pkg) {
  if (!pkg) return pkg;
  const tokenQuota = getPackageTokenQuota(pkg.id);
  if (!tokenQuota) return pkg;
  return {
    ...pkg,
    credit: getPackageRequestQuota(pkg.id),
    token_quota: tokenQuota,
    token_per_request: getTokenPerRequest(),
  };
}

module.exports = {
  DEFAULT_TOKEN_PER_REQUEST,
  PACKAGE_DURATION_DAYS,
  PACKAGE_TOKEN_QUOTAS,
  getPackageDurationDays,
  getTokenPerRequest,
  getPackageTokenQuota,
  tokensToRequestQuota,
  getPackageRequestQuota,
  withComputedPackageQuota,
};
