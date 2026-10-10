

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
  description:
    'البحث عن الحجوزات الموجودة في زائر. لا تخترع بيانات الحجوزات.',
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
  description:
    'التحقق من التسعيرة والتوفر قبل إنشاء الحجز. استخدم معرفات الوحدة وخطة السعر الحقيقية.',
  parameters: {
    type: 'OBJECT',
    properties: {
      property_id: {
        type: 'NUMBER',
        description: 'معرف العقار الفعلي',
      },
      rental_type: {
        type: 'STRING',
        description: 'نوع الإيجار مثل daily أو monthly',
      },
      check_in_date: {
        type: 'STRING',
        description: 'تاريخ الوصول YYYY-MM-DD',
      },
      check_out_date: {
        type: 'STRING',
        description: 'تاريخ المغادرة YYYY-MM-DD',
      },
      unit_type_id: {
        type: 'NUMBER',
        description: 'معرف نوع الوحدة الفعلي',
      },
      rate_plan_id: {
        type: 'NUMBER',
        description: 'معرف خطة السعر الفعلي',
      },
      unit_count: {
        type: 'NUMBER',
        description: 'عدد الوحدات المطلوبة',
      },
      adults: {
        type: 'NUMBER',
        description: 'عدد البالغين',
      },
      children: {
        type: 'NUMBER',
        description: 'عدد الأطفال',
      },
      coupon_code: {
        type: 'STRING',
        description: 'كود الخصم إن وجد',
      },
    },
    required: [
        'property_id',
        'check_in_date',
        'check_out_date',
        'unit_type_id',
        'rate_plan_id',
      ],
  },
};

const createReservationTool = {
  name: 'createReservation',
  description:
    'إنشاء حجز فعلي بعد التحقق من بيانات العميل والتسعيرة. لا تستخدم أي بيانات افتراضية للعميل أو السعر.',
  parameters: {
    type: 'OBJECT',
    properties: {
      property_id: { type: 'NUMBER' },
      rental_type: { type: 'STRING' },
      check_in_date: { type: 'STRING' },
      check_out_date: { type: 'STRING' },
      first_name: { type: 'STRING' },
      last_name: { type: 'STRING' },
      name: { type: 'STRING' },
      phone: { type: 'STRING' },
      email: { type: 'STRING' },
      unit_type_id: { type: 'NUMBER' },
      rate_plan_id: { type: 'NUMBER' },
      adults: { type: 'NUMBER' },
      children: { type: 'NUMBER' },
      coupon_code: { type: 'STRING' },
    },
    required: [
        'property_id',
        'check_in_date',
        'check_out_date',
        'phone',
        'unit_type_id',
        'rate_plan_id',
      ],
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

  return parts
    .filter((part) => part.functionCall)
    .map((part) => part.functionCall);
}

function getResponseText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];

  return parts
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function isValidDate(value) {
  if (typeof value !== 'string') return false;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function validateDates(checkIn, checkOut) {
  if (!isValidDate(checkIn) || !isValidDate(checkOut)) {
    throw new Error(
      'يجب تحديد تاريخ الوصول والمغادرة بصيغة YYYY-MM-DD'
    );
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
    throw new Error(
      'تعذر التأكد من نجاح التسعيرة. لم يتم إنشاء الحجز.'
    );
  }

  const data = response.data.result ?? response.data;
  const room = data.rooms?.[0];

  if (!room) {
    throw new Error(
      'لم تُرجع التسعيرة بيانات الوحدة المطلوبة'
    );
  }

  const unitTypeId = room.unit_type_id;
  const ratePlanId = room.rate_plan_id;

  if (
    unitTypeId == null ||
    ratePlanId == null ||
    room.amount == null
  ) {
    throw new Error(
      'بيانات التسعيرة لا تحتوي على معرفات الوحدة والسعر الفعليين'
    );
  }

  if (
    !Number.isFinite(Number(room.amount)) ||
    Number(room.amount) < 0
  ) {
    throw new Error('المبلغ المعاد من التسعيرة غير صالح');
  }

  return {
    data,
    room,
    unitTypeId,
    ratePlanId,
  };
}

// لا يكفي أن تكون الاستجابة غير فارغة.
// يجب أن نجد معرّف حجز أو رقم حجز واضحًا.
function findReservationIdentifier(data, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 4) {
    return null;
  }

  const id =
    data.reservation_number ??
    data.reservationNumber ??
    data.reservation_id ??
    data.reservationId ??
    data.reservation?.number ??
    data.reservation?.id ??
    data.result?.reservation_number ??
    data.result?.reservation_id ??
    data.result?.id ??
    data.data?.reservation_number ??
    data.data?.reservation_id ??
    data.data?.id ??
    data.id;

  if (id != null && String(id).trim() !== '') {
    return String(id);
  }

  if (data.success === false || data.error || data.errors) {
    return null;
  }

  if (data.result && typeof data.result === 'object') {
    return findReservationIdentifier(data.result, depth + 1);
  }

  if (data.data && typeof data.data === 'object') {
    return findReservationIdentifier(data.data, depth + 1);
  }

  if (data.reservation && typeof data.reservation === 'object') {
    return findReservationIdentifier(data.reservation, depth + 1);
  }

  return null;
}

function safeError(error) {
  return {
    message: error.message,
    status: error.response?.status,
    details: error.response?.data,
  };
}

// --------------------------------------------------
// واتساب
// --------------------------------------------------

async function sendWhatsAppMessage(recipientID, text) {
  if (!process.env.PHONE_NUMBER_ID || !process.env.ACCESS_TOKEN) {
    throw new Error('Missing WhatsApp API environment variables');
  }

  const message = String(text || '').trim();

  if (!message) {
    throw new Error('WhatsApp message cannot be empty');
  }

  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: recipientID,
      type: 'text',
      text: { body: message },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );

  return response.data;
}

// --------------------------------------------------
// تنفيذ أدوات زائر
// --------------------------------------------------

async function executeTool(name, args) {
  switch (name) {
    case 'getReservations': {
      const reservations = await zaaerService.getReservations();

      const query = String(args.searchQuery || '')
        .trim()
        .toLowerCase();

      const results = (Array.isArray(reservations) ? reservations : [])
        .filter((reservation) => {
          if (!query) return false;

          return [
            reservation.reservation_number,
            reservation.guest_name,
            reservation.id,
          ].some((value) =>
            String(value ?? '').toLowerCase().includes(query)
          );
        });

      return {
        success: true,
        reservations: results,
      };
    }

    case 'getReservationQuote': {
      validateDates(args.check_in_date, args.check_out_date);

      const unitTypeId = requiredPositiveNumber(
        args.unit_type_id,
        'unit_type_id'
      );

      const ratePlanId = requiredPositiveNumber(
        args.rate_plan_id,
        'rate_plan_id'
      );

      const unitCount = requiredPositiveNumber(
        args.unit_count ?? 1,
        'unit_count'
      );

      const adults = requiredPositiveNumber(
        args.adults ?? 1,
        'adults'
      );

      const children = Number(args.children ?? 0);

      if (!Number.isInteger(children) || children < 0) {
        throw new Error('عدد الأطفال غير صحيح');
      }
      const propertyId = requiredPositiveNumber(
        args.property_id,
        'property_id'
      );
      const quotePayload = {
        property_id: propertyId,
        rental_type: args.rental_type || 'daily',
        check_in_date: args.check_in_date,
        check_out_date: args.check_out_date,
        rooms: [{
          unit_type_id: unitTypeId,
          rate_plan_id: ratePlanId,
          unit_count: unitCount,
          occupancy: {
            adults,
            children,
            infants: 0,
          },
        }],
      };

      if (args.coupon_code) {
        quotePayload.coupon = { code: args.coupon_code };
      }

      const quote = await zaaerService.getReservationQuote(quotePayload);

      // لا ترسل نجاحًا إلى Gemini عند فشل التسعيرة.
      const normalized = normalizeQuote(quote);

      return {
        success: true,
        quote: normalized.data,
        message: 'تم التحقق من التسعيرة بنجاح',
      };
    }

    case 'createReservation': {
      validateDates(args.check_in_date, args.check_out_date);

      const phone = String(args.phone || '').trim();
      const fullName = [
        args.first_name,
        args.last_name,
      ].filter(Boolean).join(' ').trim() ||
        String(args.name || '').trim();

      if (!phone || !fullName) {
        throw new Error('يجب توفير اسم الضيف ورقم هاتفه');
      }

      const unitTypeId = requiredPositiveNumber(
        args.unit_type_id,
        'unit_type_id'
      );

      const ratePlanId = requiredPositiveNumber(
        args.rate_plan_id,
        'rate_plan_id'
      );

      const adults = requiredPositiveNumber(
        args.adults ?? 1,
        'adults'
      );

      const children = Number(args.children ?? 0);

      if (!Number.isInteger(children) || children < 0) {
        throw new Error('عدد الأطفال غير صحيح');
      }

      // الخطوة الأولى: احسب السعر الفعلي من زائر.
      const quotePayload = {
        property_id: args.property_id,
        rental_type: args.rental_type || 'daily',
        check_in_date: args.check_in_date,
        check_out_date: args.check_out_date,
        rooms: [{
          unit_type_id: unitTypeId,
          rate_plan_id: ratePlanId,
          unit_count: 1,
          occupancy: {
            adults,
            children,
            infants: 0,
          },
        }],
      };

      if (args.coupon_code) {
        quotePayload.coupon = { code: args.coupon_code };
      }

      const quoteResult =
        await zaaerService.getReservationQuote(quotePayload);

      const quote = normalizeQuote(quoteResult);

      // الخطوة الثانية: تأكد من أن المعرفات تطابق التسعيرة.
      const realUnitTypeId = requiredPositiveNumber(
        quote.unitTypeId,
        'quote.unit_type_id'
      );

      const realRatePlanId = requiredPositiveNumber(
        quote.ratePlanId,
        'quote.rate_plan_id'
      );

      // استخدم الأسعار الحقيقية فقط، دون اختراع أسعار أو totals.
      const room = quote.room;

      const reservationPayload = {
        property_id: args.property_id,
        rental_type: args.rental_type || 'daily',
        check_in_date: args.check_in_date,
        check_out_date: args.check_out_date,

        guest: {
          name: fullName,
          phone,
          ...(args.email ? { email: args.email } : {}),
        },

        rooms: [{
          unit_type_id: realUnitTypeId,
          rate_plan_id: realRatePlanId,
          unit_count: 1,
          occupancy: {
            adults,
            children,
            infants: 0,
          },
          amount: room.amount,
          ...(Array.isArray(room.daily_rates)
            ? { daily_rates: room.daily_rates }
            : {}),
        }],
      };

      if (args.coupon_code) {
        reservationPayload.coupon = quote.data.coupon || {
          code: args.coupon_code,
        };
      }

      console.log('Submitting reservation to Zaaer', {
        check_in_date: args.check_in_date,
        check_out_date: args.check_out_date,
        unit_type_id: realUnitTypeId,
        rate_plan_id: realRatePlanId,
      });

      // الخطوة الثالثة: أرسل طلب الحجز الفعلي.
      const bookingResult =
        await zaaerService.createReservation(reservationPayload);

      console.log(
        'Zaaer reservation response:',
        JSON.stringify(bookingResult)
      );

      if (
        !bookingResult ||
        bookingResult.success === false ||
        bookingResult.error ||
        bookingResult.errors
      ) {
        throw new Error(
          'رفض زائر إنشاء الحجز. راجع تفاصيل استجابة API في Render.'
        );
      }

      const reservationId = findReservationIdentifier(bookingResult);

      if (!reservationId) {
        // لا تعِد إرسال الطلب تلقائيًا هنا؛ قد يكون الحجز
        // أُنشئ بالفعل ولكن الاستجابة لا تحتوي على المعرّف المتوقع.
        console.error(
          'Reservation outcome requires verification: no reservation ID returned'
        );

        return {
          success: false,
          needsVerification: true,
          message:
            'أُرسل الطلب إلى زائر، لكن لم يمكن التحقق من رقم الحجز. لا تؤكد النجاح ولا تعاود الإرسال قبل مراجعة النظام.',
        };
      }

      return {
        success: true,
        reservation_number: reservationId,
        message: 'تم إنشاء الحجز وإرجاع معرّفه من زائر.',
      };
    }

    default:
      throw new Error(`Unknown function call: ${name}`);
  }
}

// --------------------------------------------------
// Gemini: دورة Function Calling كاملة
// --------------------------------------------------

async function generateAIContentWithRetry(
  prompt,
  retries = 3,
  delay = 1000
) {
  const textPrompt = typeof prompt === 'string'
    ? prompt
    : String(prompt || '');

  if (!textPrompt.trim()) {
    throw new Error('Prompt cannot be empty');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const chat = ai.chats.create({
        model: MODEL,
        config: {
          tools,
          systemInstruction: `
أنت مساعد حجوزات فندقية يتعامل مع نظام زائر.

قواعد إلزامية:
- لا تقل إن الحجز نجح إلا إذا أعادت أداة createReservation
  success=true ورقم حجز واضحًا.
- إذا كانت نتيجة الأداة success=false أو تحتاج إلى تحقق،
  أخبر العميل بوضوح أن الحجز لم يتأكد بعد.
- لا تخترع تواريخ أو أسعارًا أو أرقام حجوزات أو معرفات غرف.
- اجمع معلومات العميل والتواريخ ونوع الوحدة قبل الحجز.
- استخدم أداة التسعيرة قبل إنشاء الحجز.
- لا تعتبر استدعاء الأداة نفسه دليلًا على نجاح العملية.
- أجب باللغة التي يستخدمها العميل.
          `.trim(),
        },
      });

      let response = await chat.sendMessage({
        message: textPrompt,
      });

      let bookingOutcomeUnverified = false;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const calls = getFunctionCalls(response);

        if (!calls.length) {
          break;
        }

        const functionResponses = [];

        for (const call of calls) {
          const name = call.name;
          const args = call.args || {};

          try {
            const result = await executeTool(name, args);

            if (
              name === 'createReservation' &&
              result?.needsVerification
            ) {
              bookingOutcomeUnverified = true;
            }

            functionResponses.push({
              functionResponse: {
                name,
                response: result,
              },
            });
          } catch (error) {
            console.error(
              `Tool ${name} failed:`,
              JSON.stringify(safeError(error))
            );

            functionResponses.push({
              functionResponse: {
                name,
                response: {
                  success: false,
                  message: error.message,
                  reservationCreated: false,
                },
              },
            });
          }
        }

        // إرسال جميع نتائج الأدوات إلى Gemini وتحديث response.
        response = await chat.sendMessage({
          message: functionResponses,
        });
      }

      // استخرج النص من آخر استجابة فقط.
      const remainingCalls = getFunctionCalls(response);

      if (remainingCalls.length) {
        console.error(
          'Gemini reached the tool-call limit with pending calls'
        );

        return 'عذرًا، لم أتمكن من إكمال العملية والتحقق منها. لم يتم تأكيد الحجز.';
      }

      const finalText = getResponseText(response);

      if (!finalText) {
        console.error('Gemini returned no final text', {
          finishReason: response.candidates?.[0]?.finishReason,
        });

        return 'عذرًا، لم أتمكن من تأكيد العملية. يرجى المحاولة لاحقًا.';
      }

      if (bookingOutcomeUnverified) {
        return 'تم إرسال طلب الحجز، لكن لم نتمكن من تأكيد إنشائه في النظام بعد. لن نعتبر الحجز مؤكدًا قبل التحقق من زائر.';
      }

      return finalText;
    } catch (error) {
      console.error(
        `Gemini attempt ${attempt} failed:`,
        JSON.stringify(safeError(error))
      );

      if (attempt === retries) {
        return 'عذرًا، حدث خطأ أثناء معالجة طلبك. لم أتمكن من تأكيد الحجز.';
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return 'عذرًا، لم أتمكن من إكمال طلبك.';
}

module.exports = {
  sendWhatsAppMessage,
  generateAIContentWithRetry,
};
