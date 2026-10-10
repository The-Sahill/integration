// whatsappService.js
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const zaaerService = require('../controllers/zaaer');

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

// 1. أداة جلب بيانات الحجوزات
const getReservationsTool = {
    name: 'getReservations',
    description: 'جلب وقراءة بيانات الحجوزات من نظام زائر للتحقق من تفاصيل حجز العميل مثل رقم الحجز، تاريخ الدخول والخروج، واسم النزيل',
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

// 2. أداة حساب تسعيرة الحجز (Quote)
const getReservationQuoteTool = {
    name: 'getReservationQuote',
    description: 'حساب تسعيرة الحجز والخصومات المتاحة بناءً على التواريخ وعدد الأفراد ونوع الشقة أو الكوبون',
    parameters: {
        type: 'OBJECT',
        properties: {
            property_id: { type: 'NUMBER', description: 'معرف العقار، الافتراضي هو 1' },
            rental_type: { type: 'STRING', description: 'نوع الإيجار مثل daily أو monthly' },
            check_in_date: { type: 'STRING', description: 'تاريخ الوصول بصيغة YYYY-MM-DD' },
            check_out_date: { type: 'STRING', description: 'تاريخ المغادرة بصيغة YYYY-MM-DD' },
            unit_type_id: { type: 'NUMBER', description: 'معرف نوع الغرفة/الوحدة' },
            rate_plan_id: { type: 'NUMBER', description: 'معرف خطة السعر' },
            unit_count: { type: 'NUMBER', description: 'عدد الوحدات المطلوبة' },
            adults: { type: 'NUMBER', description: 'عدد البالغين' },
            children: { type: 'NUMBER', description: 'عدد الأطفال' },
            coupon_code: { type: 'STRING', description: 'كود الخصم/الكوبون إن وجد' }
        },
        required: ['check_in_date', 'check_out_date']
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
            // 1. إنشاء المحادثة وتزويدها بالأدوات المتاحة
            const chat = ai.chats.create({
                model: "gemini-3.8-flash",
                config: {
                    tools: [{ functionDeclarations: [getReservationsTool, getReservationQuoteTool] }]
                }
            });

            // 2. إرسال طلب المستخدم
            let response = await chat.sendMessage({ message: textPrompt });

            // 3. التحقق من وجود Function Call
            if (response.functionCalls && response.functionCalls.length > 0) {
                const call = response.functionCalls[0];

                // أ) معالجة استدعاء الحجوزات
                if (call.name === 'getReservations') {
                    console.log('🤖 الـ AI يبحث عن الحجز في Zaaer API...');
                    const searchQuery = call.args?.searchQuery || '';
                    const reservations = await zaaerService.getReservations(searchQuery);

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
                // ب) معالجة استدعاء تسعيرة الحجز (Quote)
                else if (call.name === 'getReservationQuote') {
                    console.log('🤖 الـ AI يقوم بحساب تسعيرة الحجز في Zaaer API...');
                    const args = call.args || {};

                    // تجهيز البنية المطلوبة لـ API زائر
                    const quotePayload = {
                        property_id: args.property_id || 1,
                        rental_type: args.rental_type || "daily",
                        check_in_date: args.check_in_date,
                        check_out_date: args.check_out_date,
                        rooms: [
                            {
                                unit_type_id: args.unit_type_id || 101,
                                rate_plan_id: args.rate_plan_id || 25,
                                unit_count: args.unit_count || 1,
                                occupancy: {
                                    adults: args.adults || 1,
                                    children: args.children || 0,
                                    infants: 0
                                }
                            }
                        ]
                    };

                    // إضافة الكوبون إذا قام العميل بتقديمه
                    if (args.coupon_code) {
                        quotePayload.coupon = { code: args.coupon_code };
                    }

                    const quoteResult = await zaaerService.getReservationQuote(quotePayload);

                    response = await chat.sendMessage({
                        message: [
                            {
                                functionResponse: {
                                    name: 'getReservationQuote',
                                    response: { result: quoteResult }
                                }
                            }
                        ]
                    });
                }
            }

            // إرجاع النص النهائي للمستخدم
            return response.text || "أهلاً بك، كيف يمكنني مساعدتك اليوم؟";

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