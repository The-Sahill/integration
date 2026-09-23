const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai'); // تأكد من تثبيت الحزمة الخاصة بي آي
const { getPrompt } = require('./controllers/prompt')

const app = express();
app.use(bodyParser.json());

// بيانات الاعتماد الخاصة بـ WhatsApp Business API
const PHONE_NUMBER_ID = '1328425043688424'; 
const ACCESS_TOKEN = 'EAAXC7VrGWOQBSj9ZBmZBhTqF14avsAbngIyrFHSAZBrRsJamNjNboQpvVftNuMaVtKRkkHkiYJCoGoIt67SW4Y2g1Mdi94zMADWeXrNfYH5ZAZCgyH6DjoZAQi3EjcDcIcWETabrzCnZAB3Nhyplztqn8ZBIsAlLBGaRHZCJpt5mBsCnDQZByPvZCnTHcptxmTGHcTVgwZDZD'; 

// إعداد الذكاء الاصطناعي
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// سياق منصة سوقية مخصص لموظف الحجوزات والاستقبال
const RECEPTION_CONTEXT = `
`;

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
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        try {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    if (change.field === 'messages') {
                        const value = change.value;
                        
                        if (value.messages && value.messages.length > 0) {
                            const message = value.messages[0];
                            const senderID = message.from; // رقم هاتف العميل
                            const messageText = message.text ? message.text.body : ''; // نص الرسالة الواردة

                            if (!messageText) continue;

                            console.log(`رسالة جديدة من: ${senderID} -> النص: ${messageText}`);

                            // بناء برومبت موظف الحجوزات والاستقبال
                            const prompt = `
${getPrompt}

العميل يسأل عبر الواتساب:
"${messageText}"

أنت موظف الحجوزات ومكتب الاستقبال في "The Sahill Stays".

يتمثل دورك في الترحيب بالضيوف بحفاوة ومساعدتهم في الرد على استفساراتهم المتعلقة بالشقق، وأنواع الغرف، والمرافق، والخدمات، والموقع، وإجراءات تسجيل الوصول والمغادرة، وطرق الدفع، وسياسة التدخين، والحجوزات.

احرص دائماً على الرد بأسلوب مهني وودود ومرحب ومتعاون.

استخدم اللغة العربية إذا كان الضيف يتواصل بالعربية، واستخدم اللغة الإنجليزية إذا كان الضيف يتواصل بالإنجليزية؛ أي التزم دائماً باللغة التي يستخدمها الضيف.

يتمثل هدفك الرئيسي في توفير تجربة سلسة ومفيدة للضيوف، مع تقديم معلومات دقيقة حول...
`;

                            // توليد الرد باستخدام نموذج جيميناي
                            const aiResponse = await ai.models.generateContent({
                                model: "gemini-3.6-flash", // أو gemini-3.6-flash حسب المتاح لديك
                                contents: prompt,
                            });

                            const replyText = aiResponse.text || "أهلاً بك في منصة سوقية، كيف يمكنني مساعدتك اليوم؟";

                            // إرسال الرد للعميل عبر WhatsApp Cloud API باستخدام Axios
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

        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});