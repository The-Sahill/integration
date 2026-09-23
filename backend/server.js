const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios'); // تأكد من تثبيتها عبر: npm install axios

const app = express();
app.use(bodyParser.json());

// بيانات الاعتماد الخاصة بك في واتساب
const PHONE_NUMBER_ID = '1328425043688424'; 
const ACCESS_TOKEN = 'EAAXC7VrGWOBSsoAXJXQuG6SPrArrrMkKiBvTTnFZBUyNl8SpxkRG1ZAMNslmRnafSTKFZBU6f0VgZAWEGqtj6tdpoJNIG00RzSj7Bj27EzpJAD01Ua'; // التوكن الدائم الخاص بك

app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = "yhihkuhyga"; // تأكد أن الرمز هنا يطابق ما كتبته في لوحة ميتا تماماً
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// 2. استقبال الرسائل والإشعارات (Receive Messages - POST)
app.post('/webhook', async (req, res) => {
    console.log("test");
    
    const body = req.body;

    // التأكد من أنه حدث متعلق بـ WhatsApp Business API
    if (body.object === 'whatsapp_business_account') {
        try {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    if (change.field === 'messages') {
                        const value = change.value;
                        
                        // التحقق مما إذا كانت هناك رسالة واردة جديدة
                        if (value.messages && value.messages.length > 0) {
                            const message = value.messages[0];
                            const senderID = message.from; // رقم المرسل
                            const messageText = message.text ? message.text.body : 'محتوى ليس بنص'; // نص الرسالة

                            console.log(`رسالة جديدة من: ${senderID}`);
                            console.log(`نص الرسالة: ${messageText}`);

                            // دالة الرد التلقائي باستخدام Axios
                            await axios({
                                method: 'POST',
                                url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
                                headers: {
                                    'Authorization': `Bearer ${ACCESS_TOKEN}`,
                                    'Content-Type': 'application/json',
                                },
                                data: {
                                    messaging_product: 'whatsapp',
                                    to: senderID, // إرسال الرد لنفس رقم العميل
                                    type: 'text',
                                    text: {
                                        body: `أهلاً بك! لقد استلامنا رسالتك: "${messageText}" وسنرد عليك قريباً.` // نص الرد
                                    }
                                }
                            });

                            console.log('تم إرسال الرد بنجاح إلى العميل');
                        }
                    }
                }
            }
        } catch (error) {
            console.error('خطأ أثناء إرسال الرد:', error.response ? error.response.data : error.message);
        }

        // الرد على ميتا فوراً بأننا استلمنا الطلب بنجاح (ضروري جداً لتجنب إعادة إرسال الطلب)
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// تشغيل السيرفر على المنفذ 3000
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});