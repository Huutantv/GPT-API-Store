# Redesign Plan - GPT API Store

## Overview
Redesign landing page với CSS-only animations, glow effects, scroll reveals.

## File Changes
- `index.html` - Update toàn bộ nội dung

---

## Step 1: Thêm CSS Variables & Animations

Thêm vào `<style>` section:

```css
:root {
  --primary: #6366f1;
  --primary-glow: rgba(99, 102, 241, 0.4);
  --purple: #8b5cf6;
  --pink: #ec4899;
  --dark-900: #0a0a0f;
  --dark-800: #12121a;
  --dark-700: #1a1a2e;
  --dark-600: #252540;
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-smooth: 300ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-bounce: 500ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

/* Smooth scroll */
html {
  scroll-behavior: smooth;
  scroll-padding-top: 80px;
}

/* Scroll animations */
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes slideInLeft {
  from {
    opacity: 0;
    transform: translateX(-30px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(30px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* Hero animations */
@keyframes gradientShift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

@keyframes pulse-glow {
  0%, 100% {
    box-shadow: 0 0 20px var(--primary-glow);
  }
  50% {
    box-shadow: 0 0 40px var(--primary-glow), 0 0 60px rgba(139, 92, 246, 0.2);
  }
}

@keyframes shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}

@keyframes float-orb {
  0%, 100% {
    transform: translate(0, 0) scale(1);
    opacity: 0.5;
  }
  25% {
    transform: translate(30px, -20px) scale(1.1);
    opacity: 0.7;
  }
  50% {
    transform: translate(-20px, -40px) scale(0.9);
    opacity: 0.4;
  }
  75% {
    transform: translate(-30px, 10px) scale(1.05);
    opacity: 0.6;
  }
}

@keyframes badge-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

/* Scroll reveal class */
.reveal {
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}

/* Stagger delays */
.reveal-delay-1 { transition-delay: 100ms; }
.reveal-delay-2 { transition-delay: 200ms; }
.reveal-delay-3 { transition-delay: 300ms; }
.reveal-delay-4 { transition-delay: 400ms; }
.reveal-delay-5 { transition-delay: 500ms; }
.reveal-delay-6 { transition-delay: 600ms; }
```

---

## Step 2: Enhanced Hero Section

```css
/* Hero glow background */
.hero-glow {
  background: radial-gradient(ellipse at 50% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 60%);
  position: relative;
}

.hero-glow::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 800px;
  height: 800px;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.1) 0%, transparent 70%);
  animation: float-orb 8s ease-in-out infinite;
  pointer-events: none;
}

.hero-glow::after {
  content: '';
  position: absolute;
  top: 100px;
  right: 10%;
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, rgba(236, 72, 153, 0.08) 0%, transparent 70%);
  animation: float-orb 10s ease-in-out infinite reverse;
  pointer-events: none;
}
```

HTML Hero update:
```html
<section class="relative pt-24 md:pt-32 pb-12 md:pb-20 overflow-hidden">
  <div class="hero-glow absolute inset-0"></div>
  <div class="absolute inset-0 overflow-hidden pointer-events-none">
    <div class="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl animate-pulse"></div>
    <div class="absolute bottom-20 right-10 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style="animation-delay: 1s;"></div>
  </div>
  <!-- Content with reveal classes -->
  <div class="max-w-7xl mx-auto px-6 text-center relative z-10">
    <div class="reveal">
      <div class="inline-flex items-center gap-2 px-4 py-2 bg-dark-700 rounded-full text-sm text-gray-300 mb-8 border border-white/10">
        <span class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
        Hệ thống hoạt động bình thường
      </div>
    </div>
    <h1 class="reveal reveal-delay-1 text-3xl sm:text-4xl md:text-7xl font-black leading-tight mb-6">
      Truy cập <span class="gradient-text">GPT-5.6</span> API<br>
      <span class="text-gray-400 text-2xl sm:text-3xl md:text-5xl font-bold">Không giới hạn. Nhanh. Giá tốt.</span>
    </h1>
    <p class="reveal reveal-delay-2 text-sm md:text-xl text-gray-400 max-w-2xl mx-auto mb-8 md:mb-10 leading-relaxed">
      API key truy cập GPT-5.6, GPT-5.5, GPT-5.4, Qwen-3.6 với giá tốt nhất. Hỗ trợ streaming, function calling, vision qua backend tương thích.
    </p>
    <!-- Buttons -->
    <div class="reveal reveal-delay-3">
      <div class="max-w-4xl mx-auto mt-2">
        <div class="flex flex-col items-stretch gap-3 sm:items-center">
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 w-full sm:w-auto">
            <a href="#pricing" class="btn-primary min-w-[220px] px-8 py-4 bg-primary hover:bg-primary/90 rounded-xl text-base font-semibold text-center transition-all duration-300 shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:scale-105">
              Mua API Key ngay
            </a>
            <a href="#docs" class="min-w-[190px] px-8 py-4 bg-dark-700 hover:bg-dark-600 border border-white/10 rounded-xl text-base font-semibold text-center transition-all duration-300 hover:border-white/20">
              Xem hướng dẫn
            </a>
          </div>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 w-full sm:w-auto">
            <a href="/key-check" class="min-w-[190px] px-6 py-3.5 bg-primary/10 hover:bg-primary/15 border border-primary/30 rounded-xl text-sm font-semibold text-primary text-center transition-all duration-300 hover:scale-105">
              Kiểm tra API Key
            </a>
            <a href="/lookup" class="min-w-[190px] px-6 py-3.5 bg-yellow-500/10 hover:bg-yellow-500/15 border border-yellow-500/30 rounded-xl text-sm font-semibold text-yellow-300 text-center transition-all duration-300 hover:scale-105">
              Kiểm tra đơn hàng
            </a>
          </div>
        </div>
      </div>
    </div>
    <!-- Stats with animation -->
    <div class="reveal reveal-delay-4 grid grid-cols-2 md:grid-cols-4 gap-4 mt-12 md:mt-16 max-w-3xl mx-auto">
      <div class="text-center group">
        <div class="text-3xl font-bold transition-transform duration-300 group-hover:scale-110">99.9%</div>
        <div class="text-sm text-gray-500 mt-1">Uptime</div>
      </div>
      <div class="text-center group">
        <div class="text-3xl font-bold transition-transform duration-300 group-hover:scale-110">&lt;2s</div>
        <div class="text-sm text-gray-500 mt-1">Phản hồi</div>
      </div>
      <div class="text-center group">
        <div class="text-3xl font-bold transition-transform duration-300 group-hover:scale-110">15</div>
        <div class="text-sm text-gray-500 mt-1">Models</div>
      </div>
      <div class="text-center group">
        <div class="text-3xl font-bold transition-transform duration-300 group-hover:scale-110">24/7</div>
        <div class="text-sm text-gray-500 mt-1">Hỗ trợ</div>
      </div>
    </div>
  </div>
</section>
```

---

## Step 3: Model Cards với Glow & Stagger

```css
/* Card glow effect */
.card-glow {
  position: relative;
  transition: all var(--transition-smooth);
}

.card-glow::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: linear-gradient(135deg, var(--primary), var(--purple), var(--pink));
  opacity: 0;
  transition: opacity var(--transition-smooth);
  z-index: -1;
}

.card-glow:hover {
  transform: translateY(-5px);
  box-shadow: 0 20px 40px rgba(99, 102, 241, 0.15);
}

.card-glow:hover::before {
  opacity: 1;
}

/* Featured card glow */
.card-featured {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), var(--dark-700));
  border: 1px solid rgba(99, 102, 241, 0.4);
}

.card-featured:hover {
  box-shadow: 0 0 30px rgba(99, 102, 241, 0.3), 0 0 60px rgba(139, 92, 246, 0.15);
}
```

Cards HTML update:
```html
<section id="models" class="py-12 md:py-20">
  <div class="max-w-7xl mx-auto px-4 md:px-6">
    <div class="text-center mb-14">
      <h2 class="reveal text-3xl md:text-4xl font-bold mb-4">Các Model Có Sẵn</h2>
      <p class="reveal reveal-delay-1 text-gray-400 text-lg">Truy cập các model mạnh nhất qua một API key duy nhất</p>
    </div>
    <div class="grid md:grid-cols-3 gap-6">
      <!-- Card 1 - Featured -->
      <div class="reveal card-featured card-glow rounded-2xl p-8 transition-all duration-300">
        <div class="text-2xl mb-3">🌍</div>
        <h3 class="text-xl font-bold mb-2">GPT-5.6 Terra</h3>
        <p class="text-gray-300 text-sm mb-4">Model đa dụng cho phân tích, lập trình và các tác vụ cần suy luận ổn định.</p>
        <div class="flex flex-wrap gap-2">
          <span class="px-3 py-1 bg-primary/20 text-primary text-xs rounded-full font-medium">Suy luận</span>
          <span class="px-3 py-1 bg-primary/20 text-primary text-xs rounded-full font-medium">Coding</span>
          <span class="px-3 py-1 bg-primary/20 text-primary text-xs rounded-full font-medium">Tools</span>
        </div>
      </div>
      <!-- Card 2 -->
      <div class="reveal reveal-delay-1 card-glow bg-gradient-to-br from-violet-500/15 to-dark-700 border border-violet-400/30 rounded-2xl p-8 transition-all duration-300">
        <div class="text-2xl mb-3">🌙</div>
        <h3 class="text-xl font-bold mb-2">GPT-5.6 Luna</h3>
        <p class="text-gray-300 text-sm mb-4">Lựa chọn linh hoạt cho hội thoại, sáng tạo nội dung và xử lý workflow hằng ngày.</p>
        <div class="flex flex-wrap gap-2">
          <span class="px-3 py-1 bg-violet-500/15 text-violet-300 text-xs rounded-full font-medium">Hội thoại</span>
          <span class="px-3 py-1 bg-violet-500/15 text-violet-300 text-xs rounded-full font-medium">Sáng tạo</span>
          <span class="px-3 py-1 bg-violet-500/15 text-violet-300 text-xs rounded-full font-medium">Streaming</span>
        </div>
      </div>
      <!-- Card 3 -->
      <div class="reveal reveal-delay-2 card-glow bg-gradient-to-br from-amber-500/15 to-dark-700 border border-amber-400/30 rounded-2xl p-8 transition-all duration-300">
        <div class="text-2xl mb-3">☀️</div>
        <h3 class="text-xl font-bold mb-2">GPT-5.6 Sol</h3>
        <p class="text-gray-300 text-sm mb-4">Tối ưu cho phản hồi nhanh, tóm tắt thông tin và các tác vụ hỗ trợ khách hàng.</p>
        <div class="flex flex-wrap gap-2">
          <span class="px-3 py-1 bg-amber-500/15 text-amber-300 text-xs rounded-full font-medium">Nhanh</span>
          <span class="px-3 py-1 bg-amber-500/15 text-amber-300 text-xs rounded-full font-medium">Tóm tắt</span>
          <span class="px-3 py-1 bg-amber-500/15 text-amber-300 text-xs rounded-full font-medium">Hiệu quả</span>
        </div>
      </div>
      <!-- Card 4 -->
      <div class="reveal reveal-delay-3 card-glow bg-dark-700 border border-white/10 rounded-2xl p-8 transition-all duration-300">
        <div class="text-2xl mb-3">🚀</div>
        <h3 class="text-xl font-bold mb-2">GPT-5.5</h3>
        <p class="text-gray-400 text-sm mb-4">Model mạnh nhất, hỗ trợ vision, function calling, 200K context. Phù hợp cho mọi tác vụ phức tạp.</p>
        <div class="flex flex-wrap gap-2">
          <span class="px-3 py-1 bg-primary/10 text-primary text-xs rounded-full font-medium">Vision</span>
          <span class="px-3 py-1 bg-primary/10 text-primary text-xs rounded-full font-medium">200K ctx</span>
          <span class="px-3 py-1 bg-primary/10 text-primary text-xs rounded-full font-medium">Tools</span>
        </div>
      </div>
      <!-- Card 5 -->
      <div class="reveal reveal-delay-4 card-glow bg-dark-700 border border-white/10 rounded-2xl p-8 transition-all duration-300">
        <div class="text-2xl mb-3">⚡</div>
        <h3 class="text-xl font-bold mb-2">GPT-5.5 Turbo</h3>
        <p class="text-gray-400 text-sm mb-4">Nhanh hơn GPT-5.5, tối ưu cho streaming và real-time. Giá rẻ hơn 40%.</p>
        <div class="flex flex-wrap gap-2">
          <span class="px-3 py-1 bg-green-500/10 text-green-400 text-xs rounded-full font-medium">Nhanh</span>
          <span class="px-3 py-1 bg-green-500/10 text-green-400 text-xs rounded-full font-medium">128K ctx</span>
          <span class="px-3 py-1 bg-green-500/10 text-green-400 text-xs rounded-full font-medium">Tools</span>
        </div>
      </div>
      <!-- Card 6 -->
      <div class="reveal reveal-delay-5 card-glow bg-dark-700 border border-white/10 rounded-2xl p-8 transition-all duration-300">
        <div class="text-2xl mb-3">💡</div>
        <h3 class="text-xl font-bold mb-2">GPT-5.4</h3>
        <p class="text-gray-400 text-sm mb-4">Cân bằng giữa hiệu năng và chi phí. Phù hợp cho chatbot, tóm tắt, Q&A.</p>
        <div class="flex flex-wrap gap-2">
          <span class="px-3 py-1 bg-yellow-500/10 text-yellow-400 text-xs rounded-full font-medium">Cân bằng</span>
          <span class="px-3 py-1 bg-yellow-500/10 text-yellow-400 text-xs rounded-full font-medium">128K ctx</span>
          <span class="px-3 py-1 bg-yellow-500/10 text-yellow-400 text-xs rounded-full font-medium">Tiết kiệm</span>
        </div>
      </div>
    </div>
  </div>
</section>
```

---

## Step 4: Pricing Cards Enhancement

```css
/* Pricing card hover */
.pricing-card {
  transition: all var(--transition-smooth);
}

.pricing-card:hover {
  transform: translateY(-8px);
}

.pricing-card-featured {
  position: relative;
}

.pricing-card-featured::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 1rem;
  background: linear-gradient(135deg, var(--primary), var(--purple));
  z-index: -1;
  opacity: 0;
  transition: opacity var(--transition-smooth);
}

.pricing-card-featured:hover::before {
  opacity: 1;
}

/* Badge pulse */
.badge-pulse {
  animation: badge-pulse 2s ease-in-out infinite;
}

/* Button hover glow */
.btn-glow {
  position: relative;
  overflow: hidden;
}

.btn-glow::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  transform: translateX(-100%);
  transition: transform 0.5s ease;
}

.btn-glow:hover::after {
  transform: translateX(100%);
}
```

Pricing HTML update:
```html
<section id="pricing" class="py-12 md:py-20 bg-dark-800/50">
  <div class="max-w-7xl mx-auto px-4 md:px-6">
    <div class="text-center mb-14">
      <h2 class="reveal text-3xl md:text-4xl font-bold mb-4">Bảng Giá</h2>
      <p class="reveal reveal-delay-1 text-gray-400 text-lg">Mua credit, dùng thoải mái — không lo hết hạn tháng</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8 max-w-7xl mx-auto">
      <!-- Starter -->
      <div class="reveal pricing-card bg-dark-700 border-2 border-primary rounded-2xl p-8 flex flex-col relative">
        <div class="badge-pulse absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-primary rounded-full text-xs font-bold">ĐANG MỞ BÁN</div>
        <h3 class="text-lg font-bold mb-1">Starter</h3>
        <p class="text-gray-500 text-sm mb-2">Dùng thử, cá nhân</p>
        <div class="mb-1">
          <span class="text-4xl font-black text-red-400" data-package-price="starter">20K</span>
          <span class="text-gray-400 text-sm ml-1">VNĐ</span>
        </div>
        <p class="text-xs text-red-400 mb-1">🔥 Sale có thời hạn</p>
        <ul class="text-sm text-gray-300 space-y-3 mb-8 flex-1">
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 1 API Key</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 30M token</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 30 RPM</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> GPT-5.5, DeepSeek v4-pro, GLM 5.2, GPT-5.4, Qwen-3.6</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> Streaming, Vision, Tools</li>
          <li class="flex items-center gap-2"><span class="text-green-400">⏱️</span> Thời hạn: <strong>1 ngày</strong></li>
        </ul>
        <a href="/checkout?pkg=starter" class="btn-glow block text-center px-6 py-3 bg-primary hover:bg-primary/90 rounded-xl font-semibold text-sm transition-all duration-300 shadow-lg shadow-primary/25 hover:shadow-primary/40">
          Mua ngay
        </a>
      </div>
      <!-- Pro -->
      <div class="reveal reveal-delay-1 pricing-card pricing-card-featured bg-dark-700 border border-primary/40 rounded-2xl p-8 flex flex-col relative">
        <div class="absolute top-3 right-3 px-2 py-0.5 bg-primary/20 border border-primary/30 rounded text-xs text-primary font-bold">MỚI BÁN</div>
        <h3 class="text-lg font-bold mb-1">Pro</h3>
        <p class="text-gray-500 text-sm mb-2">Developer, freelancer</p>
        <div class="mb-1">
          <span class="text-4xl font-black" data-package-price="pro">270K</span>
          <span class="text-gray-400 text-sm ml-1">VNĐ/tháng</span>
        </div>
        <p class="text-xs text-primary mb-6">30M token / ngày trong 30 ngày</p>
        <ul class="text-sm text-gray-300 space-y-3 mb-8 flex-1">
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 1 API Key</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 900M token / 30 ngày</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 30M token / ngày</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 30 RPM</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> GPT-5.5, DeepSeek v4-pro, GLM 5.2, GPT-5.4, Qwen-3.6</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> Streaming, Vision, Tools</li>
          <li class="flex items-center gap-2"><span class="text-green-400">⏱️</span> Thời hạn: <strong>30 ngày</strong></li>
        </ul>
        <a href="/checkout?pkg=pro" class="btn-glow block text-center px-6 py-3 bg-primary hover:bg-primary/90 rounded-xl font-semibold text-sm transition-all duration-300 shadow-lg shadow-primary/25 hover:shadow-primary/40">
          Mua ngay
        </a>
      </div>
      <!-- Pro v2 -->
      <div class="reveal reveal-delay-2 pricing-card bg-dark-700 border border-blue-400/40 rounded-2xl p-8 flex flex-col relative">
        <div class="absolute top-3 right-3 px-2 py-0.5 bg-blue-500/15 border border-blue-400/30 rounded text-xs text-blue-300 font-bold">GÓI MỚI</div>
        <h3 class="text-lg font-bold mb-1">Pro v2</h3>
        <p class="text-gray-500 text-sm mb-2">Developer, freelancer</p>
        <div class="mb-1">
          <span class="text-4xl font-black" data-package-price="pro_v2">290K</span>
          <span class="text-gray-400 text-sm ml-1">VNĐ/tháng</span>
        </div>
        <p class="text-xs text-blue-300 mb-6">900M token trong 30 ngày</p>
        <ul class="text-sm text-gray-300 space-y-3 mb-8 flex-1">
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 1 API Key</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 900M token / 30 ngày</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 30 RPM</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> GPT-5.5, DeepSeek v4-pro, GLM 5.2, GPT-5.4, Qwen-3.6</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> Streaming, Vision, Tools</li>
          <li class="flex items-center gap-2"><span class="text-green-400">⏱️</span> Thời hạn: <strong>30 ngày</strong></li>
        </ul>
        <a href="/checkout?pkg=pro_v2" class="btn-glow block text-center px-6 py-3 bg-blue-500 hover:bg-blue-400 rounded-xl font-semibold text-sm transition-all duration-300 shadow-lg shadow-blue-500/20">
          Mua Pro v2
        </a>
      </div>
      <!-- Ultra (locked) -->
      <div class="reveal reveal-delay-3 pricing-card bg-dark-700 border border-white/10 rounded-2xl p-8 flex flex-col opacity-50 relative">
        <div class="absolute top-3 right-3 px-2 py-0.5 bg-dark-600 border border-white/10 rounded text-xs text-gray-500">Sắp ra mắt</div>
        <h3 class="text-lg font-bold mb-1">Ultra</h3>
        <p class="text-gray-500 text-sm mb-2">Team, doanh nghiệp</p>
        <div class="mb-1">
          <span class="text-4xl font-black" data-package-price="ultra">450K</span>
          <span class="text-gray-400 text-sm ml-1">VNĐ</span>
        </div>
        <p class="text-xs text-gray-500 mb-6">Sắp công bố</p>
        <ul class="text-sm text-gray-400 space-y-3 mb-8 flex-1">
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 5 API Keys</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> 60 RPM</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> GPT-5.5, DeepSeek v4-pro, GLM 5.2, GPT-5.4, Qwen-3.6</li>
          <li class="flex items-center gap-2"><span class="text-green-400">✓</span> Streaming, Vision, Tools</li>
        </ul>
        <button disabled class="block w-full text-center px-6 py-3 bg-dark-600 border border-white/10 rounded-xl font-semibold text-sm text-gray-500 cursor-not-allowed">
          Chưa mở bán
        </button>
      </div>
    </div>
    <!-- Portal link -->
    <div class="reveal text-center mt-10">
      <p class="text-gray-500 text-sm mb-3">Đã có API key?</p>
      <a href="/portal" class="inline-flex items-center gap-2 px-6 py-3 bg-dark-700 border border-white/10 hover:bg-dark-600 rounded-xl text-sm font-semibold transition-all duration-300 hover:border-white/20 hover:scale-105">
        🔒 Xem số dư & lịch sử sử dụng
      </a>
    </div>
  </div>
</section>
```

---

## Step 5: FAQ Accordion Animation

```css
/* FAQ accordion */
.faq-item {
  transition: all var(--transition-smooth);
}

.faq-item:hover {
  border-color: rgba(99, 102, 241, 0.3);
}

.faq-item summary {
  transition: color var(--transition-fast);
}

.faq-item summary:hover {
  color: var(--primary);
}

.faq-item summary .faq-icon {
  transition: transform var(--transition-smooth);
}

.faq-item[open] summary .faq-icon {
  transform: rotate(45deg);
}

.faq-item p {
  animation: fadeIn 0.3s ease;
}
```

FAQ HTML update:
```html
<section id="faq" class="py-12 md:py-20 bg-dark-800/50">
  <div class="max-w-3xl mx-auto px-4 md:px-6">
    <div class="text-center mb-10 md:mb-14">
      <h2 class="reveal text-3xl md:text-4xl font-bold mb-4">Câu Hỏi Thường Gặp</h2>
    </div>
    <div class="space-y-4">
      <details class="reveal faq-item bg-dark-700 border border-white/10 rounded-xl p-4 md:p-6 group">
        <summary class="font-semibold cursor-pointer flex items-center justify-between list-none">
          API này tương thích với OpenAI SDK không?
          <span class="faq-icon text-gray-500 text-xl transition-transform duration-300">+</span>
        </summary>
        <p class="text-gray-400 text-sm mt-4">Có. Bạn chỉ cần thay base_url và api_key. Tương thích hoàn toàn với openai Python/Node SDK.</p>
      </details>
      <details class="reveal reveal-delay-1 faq-item bg-dark-700 border border-white/10 rounded-xl p-4 md:p-6 group">
        <summary class="font-semibold cursor-pointer flex items-center justify-between list-none">
          Hỗ trợ streaming không?
          <span class="faq-icon text-gray-500 text-xl transition-transform duration-300">+</span>
        </summary>
        <p class="text-gray-400 text-sm mt-4">Có. Hỗ trợ đầy đủ SSE streaming cho OpenAI chat completions format.</p>
      </details>
      <details class="reveal reveal-delay-2 faq-item bg-dark-700 border border-white/10 rounded-xl p-4 md:p-6 group">
        <summary class="font-semibold cursor-pointer flex items-center justify-between list-none">
          Có hỗ trợ function calling / tools không?
          <span class="faq-icon text-gray-500 text-xl transition-transform duration-300">+</span>
        </summary>
        <p class="text-gray-400 text-sm mt-4">Có. Hỗ trợ đầy đủ function calling tương thích OpenAI format.</p>
      </details>
      <details class="reveal reveal-delay-3 faq-item bg-dark-700 border border-white/10 rounded-xl p-4 md:p-6 group">
        <summary class="font-semibold cursor-pointer flex items-center justify-between list-none">
          Thanh toán bằng gì?
          <span class="faq-icon text-gray-500 text-xl transition-transform duration-300">+</span>
        </summary>
        <p class="text-gray-400 text-sm mt-4">Chuyển khoản ngân hàng, Momo, ZaloPay. Nhận API key trong 5 phút sau thanh toán.</p>
      </details>
      <details class="reveal reveal-delay-4 faq-item bg-dark-700 border border-white/10 rounded-xl p-4 md:p-6 group">
        <summary class="font-semibold cursor-pointer flex items-center justify-between list-none">
          Dùng được với Cline, Kilo Code, Cursor không?
          <span class="faq-icon text-gray-500 text-xl transition-transform duration-300">+</span>
        </summary>
        <p class="text-gray-400 text-sm mt-4">Có. Chọn provider OpenAI Compatible, nhập Base URL <code class="text-primary">https://zplay.io.vn/v1</code>, API key và model <code class="text-primary">gpt-5.5</code> là xong.</p>
      </details>
    </div>
  </div>
</section>
```

---

## Step 6: IntersectionObserver Script

Thêm vào cuối `<body>`:

```javascript
<script>
// Scroll reveal
document.addEventListener('DOMContentLoaded', function() {
  const reveals = document.querySelectorAll('.reveal');
  
  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  });
  
  reveals.forEach(function(el) {
    observer.observe(el);
  });
});

// Tab switching (keep existing)
function showTab(id) {
  document.querySelectorAll('.tab-content').forEach(function(el) {
    el.classList.add('hidden');
  });
  document.getElementById(id).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    if (btn.dataset.tab === id) {
      btn.className = 'tab-btn px-3 py-2 rounded-lg text-xs md:text-sm font-medium bg-primary text-white transition-all duration-300';
    } else {
      btn.className = 'tab-btn px-3 py-2 rounded-lg text-xs md:text-sm font-medium bg-dark-700 text-gray-400 border border-white/10 transition-all duration-300';
    }
  });
}

// Dynamic pricing
fetch('/api/orders/packages')
  .then(function(response) { return response.ok ? response.json() : null; })
  .then(function(data) {
    (data && data.packages || []).forEach(function(pkg) {
      document.querySelectorAll('[data-package-price="' + pkg.id + '"]').forEach(function(element) {
        var price = Number(pkg.price || 0);
        element.textContent = price % 1000 === 0 ? (price / 1000).toLocaleString('vi-VN') + 'K' : price.toLocaleString('vi-VN');
      });
    });
  })
  .catch(function() {});
</script>
```

---

## Summary of Effects

| Feature | Effect |
|---------|--------|
| Hero | Gradient orbs floating, pulse glow |
| Cards | Hover lift + glow border |
| Pricing | Featured card border glow |
| Stats | Scale on hover |
| FAQ | Smooth accordion + icon rotate |
| Scroll | FadeUp reveal with stagger |
| Buttons | Shimmer on hover |
| Nav | Blur + border on scroll |

## Implementation Steps

1. Copy CSS variables & animations vào `<style>`
2. Update HTML sections với reveal classes
3. Thêm IntersectionObserver script
4. Test scroll animations
5. Adjust timing/delays as needed
