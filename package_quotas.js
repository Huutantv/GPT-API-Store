const DEFAULT_TOKEN_PER_REQUEST = 85000;

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

function getPackageDurationDays(packageId) {
  return PACKAGE_DURATION_DAYS[String(packageId || "").trim()] || 0;
}

function tokensToRequestQuota(tokenQuota, tokenPerRequest = getTokenPerRequest()) {
  const quota = positiveInt(tokenQuota);
  const perRequest = positiveInt(tokenPerRequest, DEFAULT_TOKEN_PER_REQUEST);
  return quota > 0 ? Math.floor(quota / perRequest) : 0;
}

module.exports = {
  DEFAULT_TOKEN_PER_REQUEST,
  PACKAGE_DURATION_DAYS,
  getPackageDurationDays,
  getTokenPerRequest,
  tokensToRequestQuota,
};
