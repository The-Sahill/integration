const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const zaaerService = require('../controllers/zaaer');

if (!process.env.GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY environment variable');
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MAX_TOOL_ROUNDS = 8;

// --------------------------------------------------
// أدوات Gemini
// --------------------------------------------------

const getReservationsTool = {
  name: 'getReservations',
  description: 'البحث عن الحجوزات الموجودة في زائر.',
  parameters: {
    type: 'OBJECT',
    properties: {
      searchQuery: {
        type: 'STRING',
        description: 'رقم الحجز أو اسم النزيل',
      },
    },
    required: ['searchQuery'],
  },
};

const getReservationQuoteTool = {
  name: 'getReservationQuote',
  description: 'التحقق من التسعيرة والتوفر قبل إنشاء الحجز.',
  parameters: {
    type: 'OBJECT',
    properties: {
      property_id: { type: 'NUMBER' },
      rental_type: { type: 'STRING' },
      check_in_date: { type: 'STRING' },
      check_out_date: { type: 'STRING' },
      unit_type_id: { type: 'NUMBER' },
      rate_plan_id: { type: 'NUMBER' },
      unit_count: { type: 'NUMBER' },
      adults: { type: 'NUMBER' },
      children: { type: 'NUMBER' },
      coupon_code: { type: 'STRING' },
    },
    required: ['property_id', 'check_in_date', 'check_out_date', 'unit_type_id'],
  },
};

const createReservationTool = {
  name: 'createReservation',
  description: 'إنشاء حجز فعلي بعد التحقق من بيانات العميل والتسعيرة.',
  parameters: {
    type: 'OBJECT',
    properties: {
      property_id: { type: 'NUMBER' },
      rental_type: { type: 'STRING' },
      check_in_date: { type: 'STRING' },
      check_out_date: { type: 'STRING' },
      name: { type: 'STRING' },
      phone: { type: 'STRING' },
      email: { type: 'STRING' },
      unit_type_id: { type: 'NUMBER' },
      rate_plan_id: { type: 'NUMBER' },
      adults: { type: 'NUMBER' },
      children: { type: 'NUMBER' },
    },
    required: ['property_id', 'check_in_date', 'check_out_date', 'phone', 'unit_type_id', 'name'],
  },
};

const tools = [{
  functionDeclarations: [
    getReservationsTool,
    getReservationQuoteTool,
    createReservationTool,
  ],
}];

// --------------------------------------------------
// أدوات مساعدة
// --------------------------------------------------

function getFunctionCalls(response) {
  if (Array.isArray(response?.functionCalls)) {
    return response.functionCalls;
  }
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => part.functionCall).map((part) => part.functionCall);
}

function getResponseText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => typeof part.text === 'string').map((part) => part.text).join('\n').trim();
}

function isValidDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}\$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateDates(checkIn, checkOut) {
  if (!isValidDate(checkIn) || !isValidDate(checkOut)) {
    throw new Error('يجب تحديد تاريخ الوصول والمغادرة بصيغة YYYY-MM-DD');
  }
  if (checkOut <= checkIn) {
    throw new Error('تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول');
  }
}

function requiredPositiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`قيمة ${field} غير صحيحة أو غير موجودة`);
  }
  return number;
}

function normalizeQuote(response) {
  if (!response || response.success !== true || !response.data) {
    throw new Error('تعذر التأكد من نجاح التسعيرة. لم يتم إنشاء الحجز.');
  }
  const data = response.data.result ?? response.data;
  const room = data.rooms?.[0];
  if (!room) {
    throw new Error('لم تُرجع التسعيرة بيانات الوحدة المطلوبة');
  }
  return {
    data,
    room,
    unitTypeId: room.unit_type_id,
    ratePlanId: room.rate_plan_id || 1, // قيمة احتياطية إن لم تُرجعها التسعيرة
  };
}

function findReservationIdentifier(data, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 4) return null;
  const id = data.reservation_number ?? data.reservationNumber ?? data.reservation_id ?? data.reservationId ?? data.id;
  if (id != null && String(id).trim() !== '') return String(id);
  if (data.result) return findReservationIdentifier(data.result, depth + 1);
  if (data.data) return findReservationIdentifier(data.data, depth + 1);
  return null;
}

function safeError(error) {
  return {
    message: error.message,
    status: error.response?.status,
    details: error.response?.data,
  };
}

async function sendWhatsAppMessage(recipientID, text) {
  if (!process.env.PHONE_NUMBER_ID || !process.env.ACCESS_TOKEN) {
    throw new Error('Missing WhatsApp API environment variables');
  }
  const message = String(text || '').trim();
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to: recipientID, type: 'text', text: { body: message } },
    { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  return response.data;
}

// --------------------------------------------------
// تنفيذ أدوات زائر
// --------------------------------------------------

async function executeTool(name, args) {
  console.log("🔧 AI tool call:", name);
  console.log("📥 AI arguments:", JSON.stringify(args, null, 2));

  switch (name) {
    case 'getReservationQuote': {
      validateDates(args.check_in_date, args.check_out_date);
      const quotePayload = {
        property_id: Number(args.property_id || 1),
        rental_type: args.rental_type || 'daily',
        check_in_date: args.check_in_date,
        check_out_date: args.check_out_date,
        rooms: [{
          unit_type_id: Number(args.unit_type_id),
          rate_plan_id: args.rate_plan_id ? Number(args.rate_plan_id) : undefined,
          unit_count: Number(args.unit_count || 1),
          occupancy: { adults: Number(args.adults || 1), children: Number(args.children || 0), infants: 0 },
        }],
      };
      const quote = await zaaerService.getReservationQuote(quotePayload);
      const normalized = normalizeQuote(quote);
      return { success: true, quote: normalized.data, message: 'تم التحقق من التسعيرة بنجاح' };
    }

    case 'createReservation': {
      validateDates(args.check_in_date, args.check_out_date);
      const phone = String(args.phone || '').trim();
      const fullName = String(args.name || '').trim();

      if (!phone || !fullName) {
        throw new Error('يجب توفير اسم الضيف ورقم هاتفه');
      }

      // جلب التسعيرة أولاً لضمان الحصول على الأسعار والمعرفات المطابقة لـ Zaaer
      const quotePayload = {
        property_id: Number(args.property_id || 1),
        rental_type: args.rental_type || 'daily',
        check_in_date: args.check_in_date,
        check_out_date: args.check_out_date,
        rooms: [{
          unit_type_id: Number(args.unit_type_id),
          rate_plan_id: args.rate_plan_id ? Number(args.rate_plan_id) : undefined,
          unit_count: 1,
          occupancy: { adults: Number(args.adults || 1), children: Number(args.children || 0), infants: 0 },
        }],
      };

      const quoteResult = await zaaerService.getReservationQuote(quotePayload);
      const quote = normalizeQuote(quoteResult);
      const room = quote.room;

      const reservationPayload = {
        property_id: Number(args.property_id || 1),
        booking_id: `WA_BOOK_${Date.now()}`,
        status: 'new',
        rental_type: args.rental_type || 'daily',
        check_in_date: args.check_in_date,
        check_out_date: args.check_out_date,
        currency: "JOD", // 👈 ضروري جداً لتجنب خطأ 422

        guest: { name: fullName, phone },

        rooms: [{
          unit_type_id: Number(quote.unitTypeId),
          rate_plan_id: Number(quote.ratePlanId),
          unit_count: 1,
          occupancy: { adults: Number(args.adults || 1), children: Number(args.children || 0), infants: 0 },
          amount: room.amount,
          daily_rates: room.daily_rates || [],
        }],

        totals: {
          room_charges: room.amount,
          additional_charges: 0,
          discount: 0,
          total: room.amount,
          currency: "JOD"
        },
      };

      console.log('📤 Submitting reservation payload to Zaaer:', JSON.stringify(reservationPayload, null, 2));

      const bookingResult = await zaaerService.createReservation(reservationPayload);

      if (!bookingResult || bookingResult.success === false) {
        throw new Error('رفض زائر إنشاء الحجز.');
      }

      const reservationId = findReservationIdentifier(bookingResult);
      return {
        success: true,
        reservation_number: reservationId || 'مؤكد',
        message: 'تم إنشاء الحجز بنجاح.',
      };
    }

    default:
      throw new Error(`Unknown function call: ${name}`);
  }
}

// --------------------------------------------------
// Gemini الدورة الرئيسية
// --------------------------------------------------

async function generateAIContentWithRetry(prompt, retries = 3, delay = 1000) {
  const textPrompt = typeof prompt === 'string' ? prompt : String(prompt || '');
  if (!textPrompt.trim()) throw new Error('Prompt cannot be empty');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const chat = ai.chats.create({
        model: MODEL,
        config: {
          tools,
          systemInstruction: `أنت مساعد حجوزات فندقية لنظام زائر. اجمع تفاصيل الحجز (التواريخ، العقار، نوع الوحدة، اسم الضيف، ورقم الهاتف) ثم استخدم أدوات التسعيرة والحجز بدقة. أجب دائماً بلغة العميل.`.trim(),
        },
      });

      let response = await chat.sendMessage({ message: textPrompt });

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const calls = getFunctionCalls(response);
        if (!calls.length) break;

        const functionResponses = [];
        for (const call of calls) {
          try {
            const result = await executeTool(call.name, call.args || {});
            functionResponses.push({ functionResponse: { name: call.name, response: result } });
          } catch (error) {
            console.error(`Tool ${call.name} failed:`, error.message);
            functionResponses.push({ functionResponse: { name: call.name, response: { success: false, message: error.message } } });
          }
        }

        response = await chat.sendMessage({ message: functionResponses });
      }

      const finalText = getResponseText(response);
      if (!finalText) return 'عذرًا، لم أتمكن من تأكيد الحجز. يرجى المحاولة لاحقًا.';
      return finalText;

    } catch (error) {
      console.error(`Gemini attempt ${attempt} failed:`, error.message);
      if (attempt === retries) return 'عذرًا، حدث خطأ أثناء معالجة طلبك. لم أتمكن من تأكيد الحجز.';
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return 'عذرًا، لم أتمكن من إكمال طلبك.';
}

module.exports = {
  sendWhatsAppMessage,
  generateAIContentWithRetry,
};