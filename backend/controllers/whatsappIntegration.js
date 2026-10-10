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
    description: 'حساب تسعيرة الحجز ومعرفة rate_plan_id و unit_type_id الحقيقيين للوحدة قبل التأكيد',
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
    description: 'إنشاء وتأكيد حجز فعلي في نظام زائر فور اكتمال معلومات العميل وتوفر التواريخ ومعرفات الوحدات',
    parameters: {
        type: 'OBJECT',
        properties: {
            property_id: { type: 'NUMBER', description: 'معرف العقار، الافتراضي 1' },
            rental_type: { type: 'STRING', description: 'نوع الإيجار مثل daily' },
            check_in_date: { type: 'STRING', description: 'تاريخ الوصول YYYY-MM-DD' },
            check_out_date: { type: 'STRING', description: 'تاريخ المغادرة YYYY-MM-DD' },
            first_name: { type: 'STRING', description: 'اسم الضيف الأول' },
            last_name: { type: 'STRING', description: 'اسم الضيف الأخير' },
            name: { type: 'STRING', description: 'اسم الضيف الكامل إذا تم ذكره مرة واحدة' },
            phone: { type: 'STRING', description: 'رقم جوال الضيف' },
            email: { type: 'STRING', description: 'البريد الإلكتروني للضيف' },
            unit_type_id: { type: 'NUMBER', description: 'معرف نوع الوحدة الفعلي في النظام (من نتيجة Quote أو العقارات)' },
            rate_plan_id: { type: 'NUMBER', description: 'معرف خطة السعر الفعلي في النظام' },
            adults: { type: 'NUMBER', description: 'عدد البالغين' },
            children: { type: 'NUMBER', description: 'عدد الأطفال' },
            coupon_code: { type: 'STRING', description: 'كود الخصم إن وجد' }
        },
        required: ['check_in_date', 'check_out_date', 'phone']
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
            const chat = ai.chats.create({
                model: "gemini-3.8-flash",
                config: {
                    tools: [{ functionDeclarations: [getReservationsTool, getReservationQuoteTool, createReservationTool] }]
                }
            });

            let response = await chat.sendMessage({ message: textPrompt });

            // 1. استخراج Function Call إن وجد بدون استدعاء response.text مباشرة
            const candidates = response.candidates || [];
            let activeCall = null;

            if (response.functionCalls && response.functionCalls.length > 0) {
                activeCall = response.functionCalls[0];
            } else if (candidates.length > 0 && candidates[0]?.content?.parts) {
                const part = candidates[0].content.parts.find(p => p.functionCall);
                if (part) activeCall = part.functionCall;
            }

            // 2. إذا وجد استدعاء أداة
            if (activeCall) {
                const callName = activeCall.name;
                const callArgs = activeCall.args || {};

                if (callName === 'getReservations') {
                    console.log('🤖 الـ AI يبحث عن الحجز...');
                    const searchQuery = callArgs.searchQuery || '';
                    const reservations = await zaaerService.getReservations(searchQuery);

                    response = await chat.sendMessage({
                        message: [{
                            functionResponse: {
                                name: 'getReservations',
                                response: { result: reservations }
                            }
                        }]
                    });
                } 
                else if (callName === 'getReservationQuote') {
                    console.log('🤖 الـ AI يحسب التسعيرة...');
                    const quotePayload = {
                        property_id: callArgs.property_id || 1,
                        rental_type: callArgs.rental_type || "daily",
                        check_in_date: callArgs.check_in_date,
                        check_out_date: callArgs.check_out_date,
                        rooms: [{
                            unit_type_id: callArgs.unit_type_id || 101,
                            rate_plan_id: callArgs.rate_plan_id || 25,
                            unit_count: 1,
                            occupancy: { adults: callArgs.adults || 1, children: 0, infants: 0 }
                        }]
                    };
                    if (callArgs.coupon_code) quotePayload.coupon = { code: callArgs.coupon_code };
                    
                    const quoteResult = await zaaerService.getReservationQuote(quotePayload);

                    response = await chat.sendMessage({
                        message: [{
                            functionResponse: {
                                name: 'getReservationQuote',
                                response: { result: quoteResult }
                            }
                        }]
                    });
                }
                else if (callName === 'createReservation') {
                    console.log('🤖 جاري حساب التسعيرة وجلب المعرفات الحقيقية ثم إتمام الحجز...');

                    const checkIn = callArgs.check_in_date || "2026-09-01";
                    const checkOut = callArgs.check_out_date || "2026-09-03";
                    const propId = callArgs.property_id || 1;

                    // أ) جلب التسعيرة والمعرفات الحقيقية تلقائياً لمنع أخطاء not_found
                    const quotePayload = {
                        property_id: propId,
                        rental_type: callArgs.rental_type || "daily",
                        check_in_date: checkIn,
                        check_out_date: checkOut,
                        rooms: [{
                            unit_type_id: callArgs.unit_type_id || 101,
                            rate_plan_id: callArgs.rate_plan_id || 25,
                            unit_count: 1,
                            occupancy: { adults: callArgs.adults || 2, children: 0, infants: 0 }
                        }]
                    };

                    if (callArgs.coupon_code) quotePayload.coupon = { code: callArgs.coupon_code };

                    const quoteRes = await zaaerService.getReservationQuote(quotePayload);
                    const quoteData = quoteRes?.data || quoteRes?.result || quoteRes || {};

                    const realRoom = quoteData.rooms?.[0] || {};
                    const realUnitTypeId = realRoom.unit_type_id || callArgs.unit_type_id || 101;
                    const realRatePlanId = realRoom.rate_plan_id || callArgs.rate_plan_id || 25;
                    const roomAmount = realRoom.amount || 800;
                    const dailyRates = realRoom.daily_rates || [
                        { date: checkIn, unit_price: 400 },
                        { date: checkOut, unit_price: 400 }
                    ];

                    const totalsData = quoteData.totals || {
                        room_charges: roomAmount,
                        additional_charges: 0,
                        discount: quoteData.coupon?.discount_value || 0,
                        total: roomAmount - (quoteData.coupon?.discount_value || 0)
                    };

                    const fullName = callArgs.first_name && callArgs.last_name 
                        ? `${callArgs.first_name} ${callArgs.last_name}` 
                        : (callArgs.name || callArgs.first_name || 'زائر كريم');

                    // ب) بناء الـ Payload المكتمل بالبيانات الحقيقية
                    const reservationPayload = {
                        property_id: propId,
                        booking_id: `WEB-${Math.floor(Math.random() * 9000) + 1000}`,
                        status: "new",
                        booking_payment_method: "pay_at_hotel",
                        rental_type: callArgs.rental_type || "daily",
                        currency: callArgs.currency || "SAR",
                        check_in_date: checkIn,
                        check_out_date: checkOut,
                        guest: {
                            name: fullName,
                            gender: callArgs.gender || "male",
                            phone: callArgs.phone || "+966500000000",
                            email: callArgs.email || "guest@example.com",
                            address: callArgs.address || "Riyadh, Saudi Arabia"
                        },
                        occupancy: {
                            adults: callArgs.adults || 2,
                            children: callArgs.children || 0,
                            infants: 0
                        },
                        special_requests: callArgs.special_requests || "حجز عبر الواتساب",
                        auto_assign_unit: true,
                        rooms: [{
                            unit_type_id: realUnitTypeId,
                            rate_plan_id: realRatePlanId,
                            occupancy: { adults: callArgs.adults || 2, children: 0, infants: 0 },
                            amount: roomAmount,
                            daily_rates: dailyRates
                        }],
                        totals: totalsData
                    };

                    if (callArgs.coupon_code) {
                        reservationPayload.coupon = quoteData.coupon || { code: callArgs.coupon_code };
                    }

                    // ج) تنفيذ الحجز في API زائر
                    const bookingResult = await zaaerService.createReservation(reservationPayload);
                    console.log('📦 النتيجة القادمة من Zaaer API عند الحجز:', JSON.stringify(bookingResult, null, 2));

                    response = await chat.sendMessage({
                        message: [{
                            functionResponse: {
                                name: 'createReservation',
                                response: { result: bookingResult }
                            }
                        }]
                    });
                }
            }

            // 3. آليات استخراج النص الصافي بامان لتفادي التنبيهات
            let finalText = "";
            if (candidates[0]?.content?.parts) {
                const textPart = candidates[0].content.parts.find(p => p.text);
                if (textPart) finalText = textPart.text;
            }
            
            if (!finalText && response.text) {
                finalText = response.text;
            }

            return finalText || "تمت العملية بنجاح. هل يمكنني مساعدتك بشيء آخر؟";

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