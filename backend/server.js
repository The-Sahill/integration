const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai'); 
const { getPrompt } = require('./controllers/prompt'); // استدعاء ملف البرومبت الخارجي

const app = express();
app.use(bodyParser.json());

// بيانات الاعتماد الخاصة بـ WhatsApp Business API
const PHONE_NUMBER_ID = '1328425043688424'; 
const ACCESS_TOKEN = 'EAAXC7VrGWOQBSj9ZBmZBhTqF14avsAbngIyrFHSAZBrRsJamNjNboQpvVftNuMaVtKRkkHkiYJCoGoIt67SW4Y2g1Mdi94zMADWeXrNfYH5ZAZCgyH6DjoZAQi3EjcDcIcWETabrzCnZAB3Nhyplztqn8ZBIsAlLBGaRHZCJpt5mBsCnDQZByPvZCnTHcptxmTGHcTVgwZDZD'; 

// إعداد الذكاء الاصطناعي
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = "yhihkuhyga"; 
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

// استقبال الرسائل عبر الـ Webhook والرد عليها باستخدام الذكاء الاصطناعي
app.post('/webhook', async (req, res) => {
    // 1. الرد فوراً على ميتا لمنع تكرار الطلب وتجنب التاخير
    res.status(200).send('EVENT_RECEIVED');

    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        try {
            for (const entry of body.entry) {
                if (!entry.changes) continue;
                for (const change of entry.changes) {
                    if (change.field === 'messages') {
                        const value = change.value;
                        
                        if (value.messages && value.messages.length > 0) {
                            const message = value.messages[0];
                            
                            // تجاهل إشعارات الحالة (مثل delivered أو read)
                            if (message.type !== 'text') continue;

                            const senderID = message.from; // رقم هاتف العميل
                            const messageText = message.text.body; // نص الرسالة الواردة

                            console.log(`رسالة جديدة من: ${senderID} -> النص: ${messageText}`);

                            // 2. جلب البرومبت الصحيح بتمرير نص رسالة العميل للدالة
                            const prompt = getPrompt(messageText);

                            // 3. توليد الرد باستخدام نموذج جيميناي
                            const aiResponse = await ai.models.generateContent({
                                model: "gemini-2.5-flash", // استخدم النموذج المتوفر لديك
                                contents: prompt,
                            });

                            const replyText = aiResponse.text || "أهلاً بك في The Sahill Stays، كيف يمكنني مساعدتك اليوم؟";

                            // 4. إرسال الرد للعميل عبر WhatsApp Cloud API باستخدام Axios
                            await axios({
                                method: 'POST',
                                url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
                                headers: {
                                    'Authorization': `Bearer ${ACCESS_TOKEN}`,
                                    'Content-Type': 'application/json',
                                },
                                data: {
                                    messaging_product: 'whatsapp',
                                    to: senderID,
                                    type: 'text',
                                    text: {
                                        body: replyText
                                    }
                                }
                            });

                            console.log('تم إرسال رد الذكاء الاصطناعي بنجاح إلى العميل');
                        }
                    }
                }
            }
        } catch (error) {
            console.error('خطأ أثناء معالجة رسالة الواتساب أو الـ AI:', error.response ? error.response.data : error.message);
        }
    }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});