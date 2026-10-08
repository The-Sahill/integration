// controllers/webhookController.js
const { getPrompt } = require('./prompt');
const { sendWhatsAppMessage, generateAIContentWithRetry } = require('../controllers/whatsappIntegration');
const zaaerService = require('../controllers/zaaer'); // استدعاء خدمة Zaaer

// معالجة طلب التحقق (GET)
const verifyWebhook = (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "yhihkuhyga"; 
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            return res.status(200).send(challenge);
        } else {
            return res.sendStatus(403);
        }
    }
    return res.sendStatus(400);
};

// معالجة الرسائل الواردة (POST)
const handleIncomingMessage = async (req, res) => {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        // إرسال 200 فوراً لفيسبوك لمنع إشعار التكرار
        res.status(200).send('EVENT_RECEIVED');

        try {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    if (change.field === 'messages') {
                        const value = change.value;
                        
                        if (value.messages && value.messages.length > 0) {
                            const message = value.messages[0];
                            const senderID = message.from; 
                            const messageText = message.text ? message.text.body : ''; 

                            if (!messageText) continue;

                            console.log(`رسالة جديدة من: ${senderID} -> النص: ${messageText}`);

                            // 1. جلب بيانات الحجوزات والغرف بشكل متوازي لسريعة الأداء
                            const [reservationsData, roomsData] = await Promise.all([
                                zaaerService.getReservations(),
                                zaaerService.getProperties()
                            ]);

                            // 2. بناء الـ Prompt المخصص وملاحظة استخدام await لأن getPrompt دالة async
                            const prompt = await getPrompt(messageText, reservationsData, roomsData);

                            let replyText = "";

                            // 3. توليد الرد عبر الذكاء الاصطناعي
                            try {
                                const aiText = await generateAIContentWithRetry(prompt, 3, 1000);
                                replyText = aiText || "أهلاً بك، كيف يمكنني مساعدتك اليوم؟";
                            } catch (aiError) {
                                console.error('فشلت جميع محاولات الاتصال بالذكاء الاصطناعي:', aiError.message);
                                replyText = "يوجد عطل فني في الرد التلقائي للحجوزات والاستفسار، يرجى التواصل على الرقم 00962791772424";
                            }

                            // 4. إرسال الرد للعميل عبر الواتساب
                            await sendWhatsAppMessage(senderID, replyText);
                            console.log('تم إرسال الرد بنجاح إلى العميل');
                        }
                    }
                }
            }
        } catch (error) {
            console.error('خطأ عام أثناء معالجة الرسالة:', error.message);
        }
    } else {
        res.sendStatus(404);
    }
};

module.exports = {
    verifyWebhook,
    handleIncomingMessage
};