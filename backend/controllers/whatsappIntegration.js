const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// 1. نقطة التحقق (Webhook Verification - GET)
// هذه الطريقة تستخدمها ميتا للتحقق من صحة الرابط (Callback URL) عند الضغط على Verify and save
app.webhook('/webhook', (req, res) => { // أو app.get
});

app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = "yhihkuhyga"; // استبدل هذا الرمز بنفس الرمز الذي كتبته في لوحة تحكم ميتا

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // تحقق من أن الـ mode والـ token صحيحة
    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge); // الرد بالـ challenge لإتمام التوثيق بنجاح
        } else {
            res.sendStatus(403); // الرمز غير صحيح
        }
    } else {
        res.sendStatus(400);
    }
});

// 2. استقبال الرسائل والإشعارات (Receive Messages - POST)
// هذا الـ Endpoint الذي سترسل ميتا إليه رسائل المستخدمين وبيانات التوصيل
app.post('/webhook', (req, res) => {
    const body = req.body;

    // التأكد من أنه حدث متعلق بـ WhatsApp Business API
    if (body.object === 'whatsapp_business_account') {
        body.entry.forEach(entry => {
            entry.changes.forEach(change => {
                if (change.field === 'messages') {
                    const value = change.value;
                    
                    // التحقق مما إذا كانت هناك رسالة واردة جديدة
                    if (value.messages && value.messages.length > 0) {
                        const message = value.messages[0];
                        const senderID = message.from; // رقم المرسل
                        const messageText = message.text ? message.text.body : 'محتوى ليس بنص'; // نص الرسالة

                        console.log(`رسالة جديدة من: ${senderID}`);
                        console.log(`نص الرسالة: ${messageText}`);
                    }
                }
            });
        });

        // الرد على ميتا فوراً بأننا استلمنا الطلب بنجاح (ضروري جداً لتجنب إعادة إرسال الطلب)
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// تشغيل السيرفر على المنفذ 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});