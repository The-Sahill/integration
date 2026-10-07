// whatsappService.js
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const zaaerService = require('../controllers/zaaer');

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

// تعريف الأداة للذكاء الاصطناعي
const checkAvailableRoomsTool = {
    name: 'checkAvailableRooms',
    description: 'استعلام عن الغرف الشاغرة والمتاحة للحجز في الفندق',
    parameters: {
        type: 'OBJECT',
        properties: {
            checkInDate: { type: 'STRING', description: 'تاريخ الوصول إذا ذكره العميل (YYYY-MM-DD)' },
            checkOutDate: { type: 'STRING', description: 'تاريخ المغادرة إذا ذكره العميل (YYYY-MM-DD)' }
        }
    }
};

async function sendWhatsAppMessage(recipientID, text) {
    await axios({
        method: 'POST',
        url: `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
        headers: {
            'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        data: {
            messaging_product: 'whatsapp',
            to: recipientID,
            type: 'text',
            text: { body: text }
        }
    });
}

async function generateAIContentWithRetry(prompt, retries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // 1. إنشاء محادثة جديدة وتزويدها بالأدوات
            const chat = ai.chats.create({
                model: MODEL_NAME,
                config: {
                    tools: [{ functionDeclarations: [checkAvailableRoomsTool] }]
                }
            });

            // 2. إرسال النص الأول
            let response = await chat.sendMessage({ message: prompt });

            // 3. التحقق مما إذا كان النموذج يطلب استدعاء دالة
            if (response.functionCalls && response.functionCalls.length > 0) {
                const call = response.functionCalls[0];

                if (call.name === 'checkAvailableRooms') {
                    console.log('🤖 الـ AI يستعلم الآن عن الغرف المتاحة من Zaaer API...');

                    // جلب البيانات من زائر
                    const roomsData = await zaaerService.getAvailableRooms(
                        call.args?.checkInDate,
                        call.args?.checkOutDate
                    );

                    // 4. إرسال نتيجة الدالة عبر الـ chat مباشرة دون إعداد الـ parts يدوياً
                    response = await chat.sendMessage([
                        {
                            functionResponse: {
                                name: 'checkAvailableRooms',
                                response: { content: roomsData }
                            }
                        }
                    ]);
                }
            }

            return response.text;

        } catch (error) {
            console.warn(`المحاولة رقم ${attempt} فشلت:`, error.message);
            if (attempt === retries) throw error;
            await new Promise(res => setTimeout(res, delay));
        }
    }
}


module.exports = {
    sendWhatsAppMessage,
    generateAIContentWithRetry
};