# 2) هيكل المجلدات

```
sahil-suite/
├── backend/                      ← عملية واحدة (node server.js)
│   ├── server.js                 ← Express + Socket.io + المُجدول + تقديم واجهة اللوحة المبنية
│   ├── config.js                 ← قراءة كل الإعدادات من .env
│   ├── .env.example
│   ├── models/                   ← مخططات MongoDB (Mongoose)
│   ├── services/
│   │   ├── inbound.js            ← استقبال واتساب: منع التكرار، القراءة، الصوت، الصور، تجميع 4 ثوانٍ
│   │   ├── agent.js              ← بناء السياق المختصر + حلقة Gemini والأدوات
│   │   ├── tools.js              ← تعريف الأدوات + الصلاحيات + التنفيذ + التأكيد قبل التغيير
│   │   ├── gemini.js             ← توليد، تفريغ صوت، قراءة إيصال، ملخص، رد صوتي
│   │   ├── whatsapp.js           ← استدعاءات Cloud API (نص، أزرار، قوالب، وسائط)
│   │   ├── messenger.js          ← إرسال ذكي يراعي نافذة 24 ساعة + تسجيل + بث
│   │   ├── buttons.js            ← معالجة الأزرار مباشرة في الكود (بدون AI)
│   │   ├── zaaer.js              ← تكامل زائر + cache + روابط الدفع
│   │   ├── pricing.js            ← المنطق الحسابي للسعر والتفاوض (دوال نقية + اختبارات)
│   │   ├── bookings.js           ← الشواغر، عرض السعر، التفاوض، الحجز المبدئي، الإدخال في زائر
│   │   ├── payments.js           ← الإيصالات (مراجعة المالية) والدفع بالبطاقة
│   │   ├── approvals.js          ← تأكيد الموظف (نعم/لا) + موافقة المدير على السعر
│   │   ├── tickets.js            ← دورة التذاكر والتصعيد وتقرير الأعطال المتكررة
│   │   ├── inventory.js          ← المخزون وتنبيه انخفاض الكمية
│   │   ├── serviceOrders.js      ← الديلفري والدراي كلين ومتابعة الحالة
│   │   ├── scheduler.js          ← المتابعة، انتهاء الحجز، التصعيد، التقرير الصباحي
│   │   ├── reports.js            ← بناء التقرير اليومي
│   │   ├── settings.js           ← إعدادات قابلة للتعديل من اللوحة (مع القيم الافتراضية)
│   │   ├── bootstrap.js          ← أول تشغيل + ترحيل بيانات النسخة القديمة
│   │   └── audit.js, media.js, realtime.js
│   ├── adapters/
│   │   ├── dryClean.js           ← برنامج الدراي كلين (مستودع TheSahilStays) ← وإلا واتساب
│   │   └── delivery.js           ← برنامج التوصيل: واتساب (افتراضي) أو HTTP
│   ├── prompts/system.js         ← System prompt مختصر وثابت (نزيل / موظف)
│   ├── routes/webhook.js         ← GET/POST /webhook (Meta) + POST /webhook/zaaer/payments
│   ├── routes/api.js             ← API لوحة التحكم (محمي بـ JWT)
│   ├── middleware/auth.js
│   ├── scripts/simulate.js       ← محاكاة رسالة واتساب موقّعة للاختبار
│   ├── tests/                    ← npm test (التسعير، التواقيع، الأرقام)
│   └── uploads/                  ← الصور والصوت المستلمة
├── frontend/                     ← لوحة التحكم (React + Vite + Tailwind، عربية RTL متجاوبة)
│   └── src/
│       ├── pages/                ← Overview, Chat, Pipeline, Payments, Tickets, Services,
│       │                           Pricing, Inventory, Staff, Settings, Audit, Login
│       ├── components/           ← Layout, ui
│       └── lib/                  ← api (axios + socket)، labels
└── docs/
```

---

# 3) مخطط قاعدة البيانات (MongoDB)

```
Conversation 1───* Message
     │ 1
     ├───* Negotiation ───1 PricingRule
     ├───* Booking ───* Payment
     │
Staff ──(assignedTo)── Ticket
ServiceOrder (delivery / dryclean)
PendingAction (staff_confirm / manager_approval / payment_review)
InventoryItem · AuditLog · Setting · ProcessedEvent · Counter · User
```

| المجموعة | أهم الحقول | الغرض |
|---|---|---|
| **conversations** | `customerPhone` (فريد، أرقام فقط)، `customerName`، `isStaff`، `aiEnabled`، `stage` (new ← quoted ← negotiating ← hold ← awaiting_payment ← paid ← zaaer_entered ← confirmed / lost / in_house)، `summary`، `summarizedCount`، `messageCount`، `state` {checkIn, checkOut, adults, children, unitId, unitName, quotedPrice, agreedPrice, negotiationId, activeBookingRef, roomNumber, recentImages}، `lastInboundAt` (نافذة 24 ساعة)، `followUp` {count, lastAt}، `handoff` {active, reason, at}، `unread` | المحادثة كوحدة كاملة وحالة العميل |
| **messages** | `conversationId`، `direction` in/out، `sender` customer/staff/ai/agent/system، `type` text/audio/image/document/button/template، `text`، `transcript`، `mediaId`، `mediaPath`، `waMessageId`، `status` sent/delivered/read/failed، `meta` {analysis, buttons, error} | كل رسالة واردة وصادرة |
| **processedevents** | `key` (فريد) مثل `wa:<message_id>` أو `zaaer:<event_id>`، ويُحذف تلقائياً بعد 7 أيام (TTL) | منع التكرار |
| **staff** | `name`، `phone` (فريد)، `role` (manager/reception/finance/maintenance/housekeeping/delivery)، `isSupervisor`، `active` | الموظفون. أي رقم غير موجود هنا يُعامل كعميل |
| **users** | `username`، `passwordHash` (scrypt)، `role` | تسجيل دخول اللوحة |
| **pricingrules** | `name`، `aliases[]`، `zaaerUnitTypeId`، `ratePlanId`، `baseRate`، `weekendRate`، `weekendNights[]`، `seasons[{from,to,rate}]`، `minRate` 🔒، `maxDiscountPct`، `concessionSteps[]`، `alternatives`، `unitsCount`، `useZaaerPrice` | نوع الوحدة وقواعد السعر |
| **negotiations** | `conversationId`، `pricingRuleId`، التواريخ، `listPrice`، `floorPrice`، `currentOffer`، `round`، `offers[{by: hotel/guest/manager, amount}]`، `status` (open/accepted/approval_pending/approved/rejected/lost/booked)، `finalPrice` | سجل التفاوض للتحليل |
| **bookings** | `ref` (B-XXXXXX، ويُرسل كـ `booking_id`/`reference_number` لزائر)، `unitTypeId`، التواريخ، `listPrice`، `agreedPrice`، `status` (hold/awaiting_payment/paid/zaaer_entered/confirmed/expired/cancelled/failed)، `holdExpiresAt`، `zaaerReservationId`، `history[]` | الحجز المحلي في مسار المبيعات |
| **payments** | `bookingId`، `method` receipt/checkout/manual، `amount`، `extracted` (ما قرأه Gemini)، `mediaPath`، `status`، `reviewedBy`، `checkout` {paymentLinkId, url, webhookSecret} | الإيصالات والدفع بالبطاقة |
| **pendingactions** | `type`، `requestedBy`، `targetPhones[]`، `tool`، `args`، `summary`، `status`، `expiresAt` | عمليات بانتظار "نعم/لا" أو موافقة المدير |
| **tickets** | `number` (متسلسل)، `kind` request/maintenance، `category`، `priority`، `roomNumber`، `guestPhone`، `media[]`، `assignedTo`، `status` (open/assigned/acknowledged/done/closed/reopened/cancelled)، `reminderCount`، `escalated`، `satisfied`، `history[]` | الطلبات والصيانة (وسجل صيانة كل وحدة) |
| **inventoryitems** | `name`، `aliases[]`، `category`، `unit`، `quantity`، `minQuantity`، `history[]` | المخزون |
| **serviceorders** | `ref` (DL-/DC-)، `provider` delivery/dryclean، `channel` api/whatsapp، `externalId`، `status`، `history[]` | طلبات الديلفري والدراي كلين |
| **auditlogs** | `actorType` staff/guest/ai/system/dashboard، `actorName`، `actorPhone`، `action`، `target`، `details`، `success`، `at` | سجل التدقيق |
| **settings** | `key`، `value` | الإعدادات القابلة للتعديل (الفترات، القوالب، الصلاحيات...) |
| **counters** | `_id`، `seq` | أرقام التذاكر |
