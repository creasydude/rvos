<div align="center">

# 🧠 آر.وی.او.اس — ابزار تحقیق و ارزش‌گذاری

**مدل زبانی تحلیل را می‌نویسد؛ همهٔ اعداد را موتور TypeScript محاسبه می‌کند.**

آر.وی.او.اس داده‌های خام بورس اوراق بهادار تهران را به گزارش‌های سرمایه‌گذاریِ کاملاً عددی تبدیل می‌کند.
مدل زبانی ورودی شما را ساخت‌دهی می‌کند، یک مغز قطعی (deterministic) *هر* عدد را محاسبه می‌کند،
و مدل زبانی نتیجه را به یک روایت **خرسی / خنثی / گاوی** تبدیل می‌کند — بدون حتی یک محاسبهٔ اشتباه.

[🇺🇸 English](README.md) · [🇮🇷 فارسی](README.fa.md)

![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=for-the-badge&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js%2016-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React%2019-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js%20%E2%89%A5%2022.5-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-node%3A%3Asqlite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Chakra UI](https://img.shields.io/badge/Chakra%20UI-3-319795?style=for-the-badge&logo=chakraui&logoColor=white)
![Tehran Stock Exchange](https://img.shields.io/badge/Tehran%20Stock%20Exchange-1f6feb?style=for-the-badge)
![TSETMC](https://img.shields.io/badge/TSETMC-00a3e0?style=for-the-badge)
![Codal](https://img.shields.io/badge/Codal-8b5cf6?style=for-the-badge)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge)

</div>

---

## 🚀 چکار می‌کند؟

آر.وی.او.اس یک **خط لولهٔ سه مرحله‌ای تحلیل** است:

1. **ساخت‌دهی** — داده‌های خام بنیادی / تکنیکال را paste کنید. مدل زبانی آن را به یادداشت‌هایی تمیز و ساخت‌یافته تبدیل می‌کند.
2. **محاسبه** — یک مغز قطعی به‌زبان TypeScript همهٔ نسبت‌های ارزش‌گذاری، متریک‌های رشد و اندیکاتورهای تکنیکال را محاسبه می‌کند. مدل زبانی **هیچ‌وقت** حساب‌وکتاب نمی‌کند؛ هر عدد از تابع‌های قابل‌بازبینی در `brain/` می‌آید.
3. **تولید گزارش** — مدل زبانی اعداد محاسبه‌شده را می‌خواند و یک تحلیل **خرسی / خنثی / گاوی** می‌نویسد که واقعاً می‌توانید درباره‌اش بحث کنید.

## 📊 ساخته‌شده برای بورس تهران

- **همگام‌سازی TSETMC** — دریافت کندل‌های OHLCV، تعدیلات قیمت، تغییرات سهام، جریان پول حقیقی/حقوقی و قیمت لحظه‌ای از `cdn.tsetmc.com`.
- **بنیادی از کدال** — یافتن، دانلود و پارسِ صورت‌های مالی سالانهٔ شرکت (PDF/Excel) و ذخیره در یک پایگاه متریک نرمال‌شده — حتی برای شرکت‌های **زیان‌ده**، تا هیچ نمادی بی‌دلیل فقط «تکنیکال» نشان داده نشود.
- **آگاه به تقویم شمسی** — دوره‌های گزارشگری در تمام طول مسیر با تقویم جلالی مدیریت می‌شوند.
- **مرکز همگام‌سازی و آموزش** — یک رابط کاربری اختصاصی در `/market` برای همگام‌سازی هر نماد، بازبینی رکوردهای ذخیره‌شده، اجرای مغز و خواندن توضیح سادهٔ هر مدل.

## 🧮 مغز مدل‌ها

| بنیادی (`brain/fundamental.ts`) | تکنیکال (`brain/technical.ts`) |
| --- | --- |
| ارزش‌گذاری DCF (ارزش شرکت + حاشیهٔ امنیت) | میانگین متحرک (SMA / EMA) |
| P/E، P/B، P/S (با حق بیمهٔ همتا) | مکدی MACD (سیگنال، هیستوگرام) |
| EV/EBITDA (با حق بیمهٔ همتا) | RSI(14) با سطوح اشباع خرید/فروش |
| عدد گراهام و حاشیهٔ امنیت | باندهای بولینجر، استوکاستیک |
| DDM (گوردون) و حاشیهٔ امنیت | ATR(14)، ADX / +DI / −DI |
| تحلیل دوپونتِ ROE | OBV، VWAP، نمرهٔ Z |
| نمرهٔ Z آلتمن | شیب روند، R²، کانال‌ها |
| امتیاز پیوتروسکی، بازده FCF | |

هر محاسبه‌ای که رد می‌شود، با دلیل توضیح داده می‌شود — مثلاً *«P/E رد شد: EPS ≤ 0 (شرکت زیان‌ده است)»* — تا خروجی همیشه قابل‌تفسیر باشد، نه ساکت.

## 🛠️ شروع سریع

> نیاز به **Node.js ≥ 22.5** دارد (از `node:sqlite` داخلی استفاده می‌کند — بدون ماژول native).

```bash
npm install
npm run dev
```

[localhost:3000](http://localhost:3000) را باز کنید:

1. از **تنظیمات** (آیکون چرخ‌دنده) یک endpoint سازگار با OpenAI بسازید و آن را به سه نقش (**بنیادی**، **تکنیکال**، **تولید گزارش**) اختصاص دهید.
2. داده‌های خام را در چت paste کنید و یک تحلیل عددی و ساخت‌یافته بگیرید.
3. برای دریافت داده‌های واقعی بازار، به **مرکز همگام‌سازی و آموزش** در `/market` بروید.

## 📡 API دادهٔ بازار

```bash
# همگام‌سازی یک نماد (تکنیکال + بنیادی کدال + پارس)
curl -X POST http://localhost:3000/api/market \
  -H 'Content-Type: application/json' \
  -d '{"action":"sync","symbol":"فولاد"}'

# همگام‌سازی دسته‌ای همهٔ نمادهای شناخته‌شده
curl -X POST http://localhost:3000/api/market \
  -H 'Content-Type: application/json' \
  -d '{"action":"sync"}'

# اطلاعیه‌های اخیر کدال (صورت‌های ردیابی‌شده نیز به fundamentals پارس می‌شوند)
curl -X POST http://localhost:3000/api/market \
  -H 'Content-Type: application/json' \
  -d '{"action":"syncCodal","days":30,"limit":40}'

# تحلیل یک نماد همگام‌سازی‌شده
curl "http://localhost:3000/api/market/analyze?symbol=%D9%81%D9%88%D9%84%D8%A7%D8%AF"
```

## 🗂️ ساختار پروژه

| مسیر | کاربرد |
| --- | --- |
| `brain/` | مدل‌های خالص TypeScript — محاسبات بنیادی و تکنیکال + خودآزمایی |
| `lib/market/` | موتور داده — کلاینت TSETMC/کدال، همگام‌سازی ETL، پارسر صورت مالی، تقویم جلالی |
| `lib/` | اتصال به LLM (سازگار با OpenAI + SSE)، پرامپت‌ها، ارکستراسیون تحلیل، پایگاه SQLite |
| `app/api/` | نقاط پایانی REST — چت، تحلیل، نقش‌ها، endpointها، همگام‌سازی بازار |
| `app/market/` | رابط کاربری مرکز همگام‌سازی و آموزش |
| `app/settings/` | رابط مدیریت endpoint و نقش‌ها |
| `scripts/` | ابزارهای توسعه — سرور LLM شبیه‌سازی‌شده، تست E2E، بررسی‌کنندهٔ همگام‌سازی |

## 🧪 آزمایش

```bash
npm run brain:test                 # راستی‌آزمایی همهٔ محاسبات بنیادی و تکنیکال
node scripts/mock-llm.js           # سرور محلی SSE سازگار با OpenAI (http://localhost:9999/v1)
npx tsx scripts/verify-fundamentals.ts فولاد   # بررسی سرتاسری همگام‌سازی + پارس بازار
```

## ⚠️ سلب مسئولیت

آر.وی.او.اس یک **ابزار پژوهشی و آموزشی است، نه توصیهٔ مالی**. همهٔ خروجی‌ها تخمین‌اند و ممکن است
— به‌ویژه در صورت‌های مالی حاشیه‌ای — خطا داشته باشند. خودتان تحقیق کنید.
کلیدهای API به‌صورت محلی در `data/app.db` ذخیره می‌شوند (TODO در `lib/db.ts` را ببینید).

---

<div align="center">

ساخته‌شده با ❤️ برای بازار ایران — [🇺🇸 English version](README.md)

</div>