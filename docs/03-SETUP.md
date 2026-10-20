# 5) الإعداد والتشغيل

## المتطلبات
- Node.js 20 أو أحدث
- MongoDB، ويمكنك استخدام نفس قاعدة Atlas الحالية لأن المحادثات القديمة تُرحَّل تلقائياً
- رقم واتساب على Cloud API (عندك جاهز)
- مفتاح Gemini من Google AI Studio
- توكن زائر **جديد**
- `ffmpeg`، فقط إذا أردت تفعيل الرد الصوتي

---

## أ) التشغيل محلياً (للتجربة)

```bash
# 1. الباك إند
cd backend
cp .env.example .env        # ثم املأ القيم
npm install
npm run dev                 # يعمل على http://localhost:4000

# 2. الواجهة (في نافذة ثانية)
cd frontend
npm install
npm run dev                 # http://localhost:5173 — تمرّر /api تلقائياً للباك إند

# 3. الاختبارات
cd backend && npm test
```

**لربط واتساب محلياً** تحتاج رابط https عاماً:
```bash
ngrok http 4000
# ضع الرابط الناتج https://xxxx.ngrok-free.app/webhook في Meta (الخطوة ج)
# وضع PUBLIC_URL=https://xxxx.ngrok-free.app في .env
```

**محاكاة رسالة بدون واتساب** (يُرسل الرد فعلياً للرقم المحدد):
```bash
node scripts/simulate.js 962790000000 "مرحبا، بدي شقة غرفتين من الخميس للسبت لـ 4 أشخاص"
node scripts/simulate.js 962790000000 "مرحبا" --dup    # اختبار منع التكرار: يجب أن يُعالج مرة واحدة
node scripts/simulate.js 962790000000 --button "act:yes:<id>"       # ضغط زر
node scripts/simulate.js 962790000000 --image receipt.png            # صورة (إيصال/عطل)
node scripts/simulate.js 962790000000 --tts "صرفنا 10 مناشف"         # رسالة صوتية مولّدة (تحتاج ffmpeg)
```
**للاختبار بأرقام وهمية بأمان** ضع في `.env` السطر `WA_SEND_ONLY_TO=<رقمك>`. الرسائل لأي رقم آخر لا تُرسل، بل تُطبع في سجل السيرفر بالشكل `🧪 [WA غير مُرسل] → رقم: النص` مع الأزرار ومعرّفاتها. **احذف السطر قبل التشغيل الفعلي.**

---

## ب) التشغيل على سيرفر (إنتاج)

> ⚠️ **شغّل نسخة واحدة فقط من التطبيق**: تجميع الرسائل والمُجدول يعملان في الذاكرة. لا تفعّل التوسعة الأفقية (أكثر من instance).

### الخيار 1: Render (تستخدمه حالياً)
1. أنشئ **Web Service** واحداً من المستودع.
2. **Build Command**:
   ```
   cd frontend && npm install && npm run build && cd ../backend && npm install
   ```
3. **Start Command**: `cd backend && npm start`
4. **Environment**: انسخ كل متغيرات `.env.example`. اضبط `PUBLIC_URL` على رابط الخدمة، واترك `VITE_API_URL` فارغاً.
5. أضف **Persistent Disk** على المسار `backend/uploads`، وإلا تضيع الصور والصوت عند كل نشر.
6. لا تستخدم الخطة المجانية: الخدمة "تنام" بعد فترة، فيتوقف المُجدول (المتابعة، التصعيد، التقرير الصباحي) ويتأخر الرد.

### الخيار 2: VPS (Ubuntu)
```bash
sudo apt install -y nodejs npm ffmpeg nginx
git clone <repo> && cd sahil-suite
cd frontend && npm install && npm run build
cd ../backend && npm install && cp .env.example .env && nano .env
sudo npm i -g pm2
pm2 start server.js --name sahil && pm2 save && pm2 startup
```
بعدها وجّه nginx (مع HTTPS عبر certbot) إلى `localhost:4000`، وفعّل WebSocket:
```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

الواجهة تُخدم من نفس السيرفر على `/`، والـ API على `/api`، والـ webhook على `/webhook`.

---

## ج) إعداد الـ Webhook في Meta for Developers
1. افتح **App** ← **WhatsApp** ← **Configuration**.
2. **Callback URL**: `https://YOUR-DOMAIN/webhook`
3. **Verify token**: نفس قيمة `VERIFY_TOKEN` في `.env`، ثم اضغط **Verify and save**. يجب أن يظهر `✅ WEBHOOK_VERIFIED` في سجل السيرفر.
4. في **Webhook fields** فعّل **messages**.
5. **App Secret**: من **App settings** ← **Basic** ← **App secret**، وضعه في `META_APP_SECRET`. بدونه يكون التحقق من التوقيع معطّلاً، ويظهر تحذير عند التشغيل.
6. **توكن دائم**: من **Business Settings** ← **System users** ← أنشئ مستخدماً بدور Admin ← **Generate token** بالصلاحيتين `whatsapp_business_messaging` و `whatsapp_business_management`، ثم ضعه في `ACCESS_TOKEN`.
7. `PHONE_NUMBER_ID` تجده في **WhatsApp** ← **API Setup**.
8. اعتمد القوالب في `04-WHATSAPP-TEMPLATES.md` من **WhatsApp Manager** ← **Message templates**، بنفس الأسماء أو عدّل الأسماء من صفحة الإعدادات.

---

## د) إعداد زائر
1. أنشئ توكن API جديداً وضعه في `ZAAER_API_TOKEN`، ثم **ألغِ التوكن القديم** الذي كان مكتوباً في الكود.
2. من اللوحة افتح **الأسعار والتفاوض** ← **أنواع الوحدات في زائر**، وسترى البيانات الخام من `/properties` لمعرفة قيم `unit_type_id`.
3. أضف كل نوع وحدة مع `unit_type_id` والأسعار والحد الأدنى وخطوات التنازل.
4. **الدفع بالبطاقة (اختياري)**: اضبط `ZAAER_CHECKOUT_ENABLED=true`. رابط الـ webhook يُرسل تلقائياً مع كل checkout بهذه الصيغة: `PUBLIC_URL/webhook/zaaer/payments?ref=B-XXXX`. يتحقق الكود من التوقيع بـ `webhook_secret` الذي يُرجعه زائر، ويتجاهل الإشعارات المكررة بـ `Idempotency-Key`، وإذا لم يتحقق التوقيع يقرأ الحالة من `GET /payment-checkouts/{id}`. يوجد أيضاً استطلاع احتياطي كل 5 دقائق.
5. **الإنشاء والتعديل والإلغاء** تتم كلها عبر `POST /reservations` بالحقل `status` (new / modified / cancelled) مع `booking_id` الخاص بنا. لا تحتاج أي إعداد.
6. **نقاط إضافية** (الوصل المالي، تسجيل الوصول والمغادرة، الأرصدة): ضعها في `ZAAER_RECEIPT_*` و `ZAAER_CHECKIN_*` و `ZAAER_CHECKOUT_GUEST_*` و `ZAAER_BALANCES_*` عند توفر توثيقها. حتى ذلك يصل تنبيه بالتفاصيل للموظف المختص لينفّذها يدوياً.

## هـ) إعداد برنامج الدراي كلين (مستودع TheSahilStays)
1. في برنامج الدراي كلين، سجّل مستخدماً خاصاً بالنظام من صفحة التسجيل (تحتاج `SYSTEM_PASSWORD` الخاص بذلك البرنامج).
2. ضع رابط الباك إند الخاص به في `DRYCLEAN_API_URL`، والمستخدم في `DRYCLEAN_API_USER` و `DRYCLEAN_API_PASSWORD`.
3. يجب أن تكون الغرف مسجلة هناك بنفس أرقامها، لأن السعر يُقرأ من `/rooms`.
4. احتياطياً، ضع رقماً في `DRYCLEAN_WHATSAPP`. إذا فشل الـ API يُرسل الطلب لهذا الرقم برسالة مع أزرار.

## و) برنامج التوصيل
- الوضع الافتراضي `DELIVERY_MODE=whatsapp`: يُرسل الطلب إلى `DELIVERY_WHATSAPP` مع زري "👍 استلمت" و"✅ تم التسليم"، وكل ضغطة تبلّغ النزيل تلقائياً.
- عند توفر API: اضبط `DELIVERY_MODE=http` ثم عدّل الدالتين `createOrder` و `getStatus` في `adapters/delivery.js` حسب التوثيق.

## ز) أول دخول للوحة (قائمة تحقق)
1. ادخل باسم المستخدم وكلمة المرور الموجودين في `ADMIN_USERNAME/ADMIN_PASSWORD`، ثم غيّر كلمة المرور من الإعدادات.
2. **الموظفون**: أضف أرقام واتساب لكل موظف ودوره، وفعّل خيار "مشرف" لمن يستلم التصعيدات. المدير المذكور في `MANAGER_PHONE` يُضاف تلقائياً.
3. **الأسعار**: أضف أنواع الوحدات واربطها بزائر.
4. **المخزون**: أضف الأصناف وحد التنبيه لكل صنف.
5. **الإعدادات**: راجع معلومات المنشأة، وتعليمات الدفع، والفترات، وأسماء القوالب.
6. **الموظفون** ← **صلاحيات الأدوار**: عدّل الصلاحيات إن احتجت.

---

## `.env.example`
الملف الكامل موجود في `backend/.env.example`، ومعه شرح لكل متغير.
