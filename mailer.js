/**
 * mailer.js — Gửi email qua Gmail SMTP
 * Cấu hình: MAIL_USER, MAIL_PASS trong .env
 */
const nodemailer = require("nodemailer");

function createTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.MAIL_USER || "",
      pass: process.env.MAIL_PASS || "",
    },
  });
}

async function sendApiKey({ to, customerName, packageName, apiKey, credit, rpmLimit, baseUrl }) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.warn("[mailer] MAIL_USER/MAIL_PASS chưa cấu hình, bỏ qua gửi email");
    return false;
  }
  const transport = createTransport();
  const html = `
<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Inter,sans-serif;color:#e1e4ed">
<div style="max-width:560px;margin:40px auto;background:#12121a;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 40px;text-align:center">
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff">🚀 GPT API Store</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px">Thanh toán thành công</p>
  </div>
  <div style="padding:32px 40px">
    <p style="margin:0 0 16px;font-size:15px">Xin chào <strong>${customerName || "bạn"}</strong>,</p>
    <p style="margin:0 0 24px;color:#9ca3af;font-size:14px;line-height:1.6">
      Cảm ơn bạn đã mua gói <strong style="color:#6366f1">${packageName}</strong>. Dưới đây là thông tin API key của bạn.
    </p>
    <div style="background:#0a0a0f;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;margin-bottom:24px">
      <p style="margin:0 0 8px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">API Key</p>
      <code style="font-size:13px;color:#a78bfa;word-break:break-all;font-family:monospace">${apiKey}</code>
    </div>
    <div style="display:grid;gap:12px;margin-bottom:24px">
      <div style="background:#1a1a2e;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between">
        <span style="font-size:13px;color:#9ca3af">Base URL</span>
        <code style="font-size:13px;color:#34d399">${baseUrl}/v1</code>
      </div>
      <div style="background:#1a1a2e;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between">
        <span style="font-size:13px;color:#9ca3af">Credit</span>
        <strong style="font-size:13px;color:#fff">${Number(credit).toLocaleString()} credit</strong>
      </div>
      <div style="background:#1a1a2e;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between">
        <span style="font-size:13px;color:#9ca3af">RPM Limit</span>
        <strong style="font-size:13px;color:#fff">${rpmLimit} req/phút</strong>
      </div>
    </div>
    <div style="background:#1a1a2e;border-radius:12px;padding:20px;margin-bottom:24px">
      <p style="margin:0 0 12px;font-size:13px;font-weight:600">Cài đặt nhanh (Python)</p>
      <pre style="margin:0;font-size:12px;color:#9ca3af;overflow-x:auto">from openai import OpenAI
client = OpenAI(
    api_key="${apiKey}",
    base_url="${baseUrl}/v1"
)
response = client.chat.completions.create(
    model="gpt-5.5",
    messages=[{"role":"user","content":"Hello!"}]
)</pre>
    </div>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${baseUrl}/portal" style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px">Xem số dư & lịch sử</a>
    </div>
    <p style="margin:0;font-size:12px;color:#4b5563;text-align:center;line-height:1.6">
      Cần hỗ trợ? Liên hệ qua Zalo hoặc Telegram.<br>
      Lưu email này để tra cứu API key khi cần.
    </p>
  </div>
</div>
</body>
</html>`;

  await transport.sendMail({
    from: `"GPT API Store" <${process.env.MAIL_USER}>`,
    to,
    subject: `[GPT API] API Key gói ${packageName} của bạn`,
    html,
  });
  return true;
}

module.exports = { sendApiKey };
