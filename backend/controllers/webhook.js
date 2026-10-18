// controllers/webhookController.js
const { getPrompt } = require('./prompt');
const { sendWhatsAppMessage, generateAIContentWithRetry } = require('../controllers/whatsappIntegration');
const zaaerService = require('../controllers/zaaer');
const Conversation = require('../models/Conversation');

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

const handleIncomingMessage = async (req, res) => {
    const body = req.body;
    const io = req.app.get('io'); // 👈 جلب كائن الـ Socket.io

    if (body.object === 'whatsapp_business_account') {
        res.status(200).send('EVENT_RECEIVED');

        try {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    if (change.field === 'messages') {
                        const value = change.value;
                        
                        if (value.messages && value.messages.length > 0) {
                            const message = value.messages[0];
                            const senderID = message.from; 
                            const customerPhone = `+${senderID}`; 
                            const messageText = message.text ? message.text.body : ''; 
                            const contactName = value.contacts?.[0]?.profile?.name || 'عميل واتساب';

                            if (!messageText) continue;

                            console.log(`\n📩 رسالة جديدة من: ${customerPhone} -> النص: ${messageText}`);
                            const currentTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

                            const customerMsg = {
                                sender: 'customer',
                                text: messageText,
                                time: currentTime
                            };

                            // 1. حفظ رسالة العميل
                            let conversation = await Conversation.findOneAndUpdate(
                                { customerPhone: customerPhone },
                                {
                                    $set: {
                                        customerName: contactName,
                                        lastMessage: messageText,
                                        lastTime: currentTime
                                    },
                                    $push: { messages: customerMsg },$setOnInsert: { aiEnabled: true, status: 'active' }
                                },
                                { upsert: true, returnDocument: 'after' }
                            );

                            // 👈 بث المحادثة المحدثة فوراً للفرونت إند عبر الـ Socket
                            io.emit('new_message_received', conversation);

                            if (!conversation.aiEnabled) {
                                console.log(`⏸️ الـ AI معطل للمحادثة ${customerPhone}.`);
                                continue;
                            }

                            // 2. معالجة الـ AI
                            const [reservationsData, roomsData] = await Promise.all([
                                zaaerService.getReservations(),
                                zaaerService.getProperties()
                            ]);

                            const prompt = await getPrompt(messageText, reservationsData, roomsData);
                            let replyText = "";

                            try {
                                const aiText = await generateAIContentWithRetry(prompt, 3, 1000);
                                replyText = aiText || "أهلاً بك، كيف يمكنني مساعدتك اليوم؟";
                            } catch (aiError) {
                                console.error('فشل الاتصال بالذكاء الاصطناعي:', aiError.message);
                                replyText = "يوجد عطل فني في الرد التلقائي للحجوزات، يرجى التواصل على الرقم 00962791772424";
                            }

                            const aiTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                            const aiMsg = {
                                sender: 'ai',
                                text: replyText,
                                time: aiTime
                            };

                            // 3. حفظ رد الـ AI
                            conversation = await Conversation.findOneAndUpdate(
                                { customerPhone: customerPhone },
                                {
                                    $set: { lastMessage: replyText, lastTime: aiTime },$push: { messages: aiMsg }
                                },
                                { returnDocument: 'after' }
                            );

                            // 👈 بث رد الـ AI للفرونت إند فوراً
                            io.emit('new_message_received', conversation);

                            await sendWhatsAppMessage(senderID, replyText);
                            console.log('✅ تم إرسال وحفظ رد الـ AI بنجاح');
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