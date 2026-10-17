// controllers/webhookController.js
const { getPrompt } = require('./prompt');
const { sendWhatsAppMessage, generateAIContentWithRetry } = require('../controllers/whatsappIntegration');
const zaaerService = require('../controllers/zaaer'); // استدعاء خدمة Zaaer
const Conversation = require('../models/Conversation'); // 👈 استدعاء موديل المحادثات في MongoDB

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
                            const senderID = message.from; // الرقم بدون +
                            const customerPhone = `+${senderID}`; // الرقم مع علامة + للتخزين
                            const messageText = message.text ? message.text.body : ''; 
                            const contactName = value.contacts?.[0]?.profile?.name || 'عميل واتساب';

                            if (!messageText) continue;

                            console.log(`\n==================================================`);
                            console.log(`📩 رسالة جديدة من: ${customerPhone} -> النص: ${messageText}`);

                            const currentTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

                            // 1. حفظ رسالة العميل في MongoDB وجلب حالة المحادثة
                            const customerMsg = {
                                sender: 'customer',
                                text: messageText,
                                time: currentTime
                            };

                            const conversation = await Conversation.findOneAndUpdate(
                                { customerPhone: customerPhone },
                                {
                                    $set: {
                                        customerName: contactName,
                                        lastMessage: messageText,
                                        lastTime: currentTime
                                    },
                                    $push: { messages: customerMsg },$setOnInsert: { aiEnabled: true, status: 'active' }
                                },
                                { upsert: true, new: true }
                            );

                            console.log(`💾 تم حفظ رسالة العميل في MongoDB (${customerPhone})`);

                            // 2. التحقق مما إذا كان الـ AI مفعلاً للمحادثة
                            if (!conversation.aiEnabled) {
                                console.log(`⏸️ الـ AI معطل للمحادثة ${customerPhone}. لن يتم توليد رد آلي.`);
                                continue;
                            }

                            // 3. جلب بيانات الحجوزات والغرف بشكل متوازي عند تفعيل الـ AI
                            const [reservationsData, roomsData] = await Promise.all([
                                zaaerService.getReservations(),
                                zaaerService.getProperties()
                            ]);

                            // 4. بناء الـ Prompt المخصص
                            const prompt = await getPrompt(messageText, reservationsData, roomsData);

                            let replyText = "";

                            // 5. توليد الرد عبر الذكاء الاصطناعي
                            try {
                                const aiText = await generateAIContentWithRetry(prompt, 3, 1000);
                                replyText = aiText || "أهلاً بك، كيف يمكنني مساعدتك اليوم؟";
                            } catch (aiError) {
                                console.error('فشلت جميع محاولات الاتصال بالذكاء الاصطناعي:', aiError.message);
                                replyText = "يوجد عطل فني في الرد التلقائي للحجوزات والاستفسار، يرجى التواصل على الرقم 00962791772424";
                            }

                            const aiTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

                            // 6. حفظ رد الـ AI في MongoDB
                            const aiMsg = {
                                sender: 'ai',
                                text: replyText,
                                time: aiTime
                            };

                            await Conversation.findOneAndUpdate(
                                { customerPhone: customerPhone },
                                {
                                    $set: { lastMessage: replyText, lastTime: aiTime },$push: { messages: aiMsg }
                                }
                            );

                            // 7. إرسال الرد للعميل عبر الواتساب
                            await sendWhatsAppMessage(senderID, replyText);
                            console.log('✅ تم إرسال وحفظ رد الـ AI بنجاح للعميل');
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