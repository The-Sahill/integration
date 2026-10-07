// whatsappService.js
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const zaaerService = require('../controllers/zaaer');

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

// 1. أداة الاستعلام عن الحجوزات
const getReservationsTool = {
    name: 'getReservations',
    description: 'جلب وقراءة بيانات الحجوزات من نظام زائر للتحقق من تفاصيل حجز العميل مثل رقم الحجز، تاريخ الدخول والخروج، وحالة الدفع',
    parameters: {
        type: 'OBJECT',
        properties: {
            searchQuery: { 
                type: 'STRING', 
                description: 'رقم الحجز مثل REV2026024 أو اسم النزيل للبحث عنه' 
            }
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
    const textPrompt = typeof prompt === 'string' ? prompt : String(prompt || '');

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // إنشاء محادثة جديدة
            const chat = ai.chats.create({
                model: "gemini-3.8-flash",
                config: {
                    tools: [{ functionDeclarations: [getReservationsTool] }]
                }
            });

            // إرسال النص الصريح
            let response = await chat.sendMessage({ message: textPrompt });

            // الاستجابة لاستدعاء الدوال
            if (response.functionCalls && response.functionCalls.length > 0) {
                const call = response.functionCalls[0];

                if (call.name === 'getReservations') {
                    console.log('🤖 الـ AI يبحث عن الحجز في Zaaer API...');

                    const searchQuery = call.args?.searchQuery || '';
                    const reservations = await zaaerService.getReservations(searchQuery);

                    // إرسال نتائج الحجوزات للـ AI بقالب سليم
                    response = await chat.sendMessage({
                        message: [
                            {
                                functionResponse: {
                                    name: 'getReservations',
                                    response: { result: reservations }
                                }
                            }
                        ]
                    });
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