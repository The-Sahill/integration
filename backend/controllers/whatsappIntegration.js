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

// 3. أداة إنشاء وحجز الغرفة فعلياً في النظام
const createReservationTool = {
    name: 'createReservation',
    description: 'إنشاء وتأكيد حجز فعلي في نظام زائر فور اكتمال معلومات العميل، التواريخ، ونوع الوحدة أو الغرفة',
    parameters: {
        type: 'OBJECT',
        properties: {
            property_id: { type: 'NUMBER', description: 'معرف العقار، الافتراضي 1' },
            rental_type: { type: 'STRING', description: 'نوع الإيجار مثل daily' },
            check_in_date: { type: 'STRING', description: 'تاريخ الوصول YYYY-MM-DD' },
            check_out_date: { type: 'STRING', description: 'تاريخ المغادرة YYYY-MM-DD' },
            first_name: { type: 'STRING', description: 'اسم الضيف الأول' },
            last_name: { type: 'STRING', description: 'اسم الضيف الأخير' },
            phone: { type: 'STRING', description: 'رقم جوال الضيف' },
            email: { type: 'STRING', description: 'البريد الإلكتروني للضيف' },
            unit_type_id: { type: 'NUMBER', description: 'معرف نوع الوحدة أو الغرفة' },
            rate_plan_id: { type: 'NUMBER', description: 'معرف خطة السعر، الافتراضي 25' },
            unit_count: { type: 'NUMBER', description: 'عدد الوحدات' },
            adults: { type: 'NUMBER', description: 'عدد البالغين' },
            children: { type: 'NUMBER', description: 'عدد الأطفال' },
            coupon_code: { type: 'STRING', description: 'كود الخصم إن وجد' }
        },
        required: ['check_in_date', 'check_out_date', 'first_name', 'phone']
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
            // 1. إنشاء المحادثة وتزويدها بالأدوات الثلاث (القراءة، التسعيرة، والحجز الفعلي)
            const chat = ai.chats.create({
                model: "gemini-3.8-flash",
                config: {
                    tools: [{ functionDeclarations: [getReservationsTool, getReservationQuoteTool, createReservationTool] }]
                }
            });

            // 2. إرسال طلب المستخدم
            let response = await chat.sendMessage({ message: textPrompt });

            // 3. التحقق من وجود Function Call بطريقة آمنة
            const candidates = response.candidates || [];
            let activeCall = null;

            if (response.functionCalls && response.functionCalls.length > 0) {
                activeCall = response.functionCalls[0];
            } else if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
                const part = candidates[0].content.parts.find(p => p.functionCall);
                if (part) activeCall = part.functionCall;
            }

            if (activeCall) {
                const callName = activeCall.name;
                const callArgs = activeCall.args || {};

                // أ) معالجة استدعاء الحجوزات
                if (callName === 'getReservations') {
                    console.log('🤖 الـ AI يبحث عن الحجز في Zaaer API...');
                    const searchQuery = callArgs.searchQuery || '';
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
                else if (callName === 'getReservationQuote') {
                    console.log('🤖 الـ AI يقوم بحساب تسعيرة الحجز في Zaaer API...');
                    
                    const quotePayload = {
                        property_id: callArgs.property_id || 1,
                        rental_type: callArgs.rental_type || "daily",
                        check_in_date: callArgs.check_in_date,
                        check_out_date: callArgs.check_out_date,
                        rooms: [
                            {
                                unit_type_id: callArgs.unit_type_id || 101,
                                rate_plan_id: callArgs.rate_plan_id || 25,
                                unit_count: callArgs.unit_count || 1,
                                occupancy: {
                                    adults: callArgs.adults || 1,
                                    children: callArgs.children || 0,
                                    infants: 0
                                }
                            }
                        ]
                    };

                    if (callArgs.coupon_code) {
                        quotePayload.coupon = { code: callArgs.coupon_code };
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
                // ج) معالجة إنشاء الحجز الفعلي وتأكيده مباشرة
                else if (callName === 'createReservation') {
                    console.log('🤖 الـ AI يقوم بإنشاء وتأكيد الحجز الفعلي في Zaaer API...');
                    
                    const reservationPayload = {
                        property_id: callArgs.property_id || 1,
                        rental_type: callArgs.rental_type || "daily",
                        check_in_date: callArgs.check_in_date,
                        check_out_date: callArgs.check_out_date,
                        guest: {
                            first_name: callArgs.first_name || 'زائر',
                            last_name: callArgs.last_name || 'كريم',
                            phone: callArgs.phone || '0000000000',
                            email: callArgs.email || 'guest@example.com'
                        },
                        rooms: [
                            {
                                unit_type_id: callArgs.unit_type_id || 101,
                                rate_plan_id: callArgs.rate_plan_id || 25,
                                unit_count: callArgs.unit_count || 1,
                                occupancy: {
                                    adults: callArgs.adults || 1,
                                    children: callArgs.children || 0,
                                    infants: 0
                                }
                            }
                        ]
                    };

                    if (callArgs.coupon_code) {
                        reservationPayload.coupon = { code: callArgs.coupon_code };
                    }

                    const bookingResult = await zaaerService.createReservation(reservationPayload);

                    response = await chat.sendMessage({
                        message: [
                            {
                                functionResponse: {
                                    name: 'createReservation',
                                    response: { result: bookingResult }
                                }
                            }
                        ]
                    });
                }
            }

            // استخراج النص النهائي بشكل آمن يتجنب تحذيرات الـ non-text parts
            let finalText = "";
            if (response.text) {
                finalText = response.text;
            } else if (response.candidates && response.candidates[0]?.content?.parts) {
                const textPart = response.candidates[0].content.parts.find(p => p.text);
                if (textPart) finalText = textPart.text;
            }

            return finalText || "أهلاً بك، تم تنفيذ وإتمام الحجز بنجاح. كيف يمكنني مساعدتك بشيء آخر؟";

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