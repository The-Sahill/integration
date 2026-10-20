// routes/webhook.js — Webhook واتساب (Meta) + Webhook الدفع من زائر
const express = require('express');
const config = require('../config');
const inbound = require('../services/inbound');
const payments = require('../services/payments');
const zaaer = require('../services/zaaer');
const { Payment, ProcessedEvent } = require('../models');
const { verifyMetaSignature, verifyZaaerSignature } = require('../utils/helpers');

const router = express.Router();

// توثيق الـ Webhook في Meta
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === config.whatsapp.verifyToken) {
    console.log('✅ WEBHOOK_VERIFIED');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// استلام الرسائل — نتحقق من التوقيع ثم نرد 200 فوراً ونعالج في الخلفية
router.post('/', (req, res) => {
  if (!verifyMetaSignature(req.rawBody, req.get('x-hub-signature-256'), config.whatsapp.appSecret)) {
    const now = Date.now();
    if (!global.__sigWarnAt || now - global.__sigWarnAt > 60000) {
      global.__sigWarnAt = now;
      console.warn('⛔ رُفضت رسالة واتساب: توقيع X-Hub-Signature-256 غير مطابق. META_APP_SECRET يجب أن يكون "App secret" من Meta (App settings → Basic) — 32 حرفاً hex. للتجربة اتركه فارغاً.');
    }
    return res.sendStatus(401);
  }
  if (req.body?.object !== 'whatsapp_business_account') return res.sendStatus(404);
  res.sendStatus(200);
  inbound.handlePayload(req.body).catch((err) => console.error('❌ webhook:', err));
});

// نتيجة الدفع بالبطاقة من زائر: payment.paid / payment.failed
router.post('/zaaer/payments', async (req, res) => {
  try {
    const eventId = req.get('x-webhook-event-id') || req.get('idempotency-key');
    const ref = req.query.ref || req.body?.result?.reference_number;
    const payment = await Payment.findOne({ method: 'checkout', bookingRef: ref }).sort({ createdAt: -1 });
    if (!payment) return res.status(200).json({ ignored: true }); // 2xx حتى لا يعيد زائر المحاولة بلا فائدة

    const signed = verifyZaaerSignature(req.rawBody?.toString('utf8'), req.get('x-webhook-timestamp'), req.get('x-webhook-signature'), payment.checkout?.webhookSecret);
    if (eventId) {
      try {
        await ProcessedEvent.create({ key: `zaaer:${eventId}` });
      } catch (err) {
        if (err.code === 11000) return res.status(200).json({ duplicate: true });
        throw err;
      }
    }
    res.status(200).json({ received: true });

    // بدون توقيع صحيح نعامل الإشعار كتلميح فقط ونقرأ الحالة الحقيقية من زائر
    let result = req.body?.result;
    if (!signed) {
      console.warn('⚠️ توقيع زائر غير متحقق — نقرأ الحالة من endpoint الحالة');
      result = await zaaer.getPaymentCheckout(payment.checkout.paymentLinkId);
    }
    await payments.applyCheckoutResult(payment, result, `webhook:${req.get('x-webhook-event')}`);
  } catch (err) {
    console.error('❌ webhook زائر:', err.message);
    if (!res.headersSent) res.sendStatus(500);
  }
});

module.exports = router;
