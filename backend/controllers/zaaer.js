const axios = require("axios");

const ZAAER_BASE_URL = "https://sahl-suites.zaaer.com/api/v1";
const ZAAER_TOKEN = "1|bykZSg9iLODV6jITNRHx1rCAhEoYMpEYOHbfKKGRd522b0ea";

// إعدادات الاتصال الموحدة
const getHeaders = () => {
  if (!ZAAER_TOKEN || !ZAAER_TOKEN.trim()) {
    throw new Error("ZAAER_API_TOKEN is missing or empty");
  }

  return {
    Authorization: `Bearer ${ZAAER_TOKEN.trim()}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
};

// استخراج العناصر من أشكال الاستجابة المحتملة
function extractItems(responseData) {
  const candidates = [
    responseData?.result?.items,
    responseData?.items,
    responseData?.data?.items,
    responseData?.data,
    responseData?.result,
  ];

  return candidates.find(Array.isArray) || [];
}

// استخراج بيانات التصفح
function extractMeta(responseData) {
  return (
    responseData?.result?.meta ||
    responseData?.meta ||
    responseData?.data?.meta ||
    {}
  );
}

// جلب جميع صفحات endpoint مع الاحتفاظ بجميع الحقول الأصلية
async function getAllPages(endpoint, extraParams = {}) {
  const allItems = [];
  const limit = 100;
  let page = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const response = await axios.get(`${ZAAER_BASE_URL}${endpoint}`, {
      headers: getHeaders(),
      params: {
        ...extraParams,
        page,
        limit,
      },
    });

    const items = extractItems(response.data);

    if (items.length === 0) {
      break;
    }

    allItems.push(...items);

    const meta = extractMeta(response.data);

    if (meta.last_page != null) {
      hasMorePages = page < Number(meta.last_page);
    } else if (meta.current_page != null && meta.last_page != null) {
      hasMorePages = Number(meta.current_page) < Number(meta.last_page);
    } else {
      hasMorePages = items.length === limit;
    }

    page++;
  }

  return allItems;
}

// 1. جلب الحجوزات بجميع حقولها
async function getReservations() {
  try {
    const reservations = await getAllPages("/reservations");

    console.log(`📊 إجمالي الحجوزات المسترجعة: ${reservations.length}`);

    return reservations;
  } catch (error) {
    console.error("❌ خطأ أثناء جلب الحجوزات:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    throw error;
  }
}

// 2. جلب بيانات الوحدات/العقارات
async function getProperties() {
  try {
    const properties = await getAllPages("/properties");

    console.log(`🏠 إجمالي العناصر المسترجعة من properties: ${properties.length}`);

    return properties;
  } catch (error) {
    console.error("❌ خطأ أثناء جلب properties:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    throw error;
  }
}

// 3. حساب تسعيرة الحجز
async function getReservationQuote(quoteData) {
  try {
    console.log("📤 إرسال طلب التسعير إلى Zaaer");

    const response = await axios.post(
      `${ZAAER_BASE_URL}/reservations/quote`,
      quoteData,
      {
        headers: getHeaders(),
      }
    );

    console.log("✅ Quote response status:", response.status);

    return {
      success: true,
      data: response.data?.result ?? response.data,
      rawResponse: response.data,
    };
  } catch (error) {
    console.error("❌ خطأ أثناء حساب التسعيرة:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return {
      success: false,
      error: error.response?.data ?? error.message,
      status: error.response?.status ?? null,
    };
  }
}

// 4. إنشاء حجز جديد مع مطابقة شروط Zaaer Documentation
async function createReservation(payload) {
  try {
    if (!payload || typeof payload !== "object") {
      throw new Error("Reservation payload must be an object");
    }

    // بناء الـ Payload بصيغة مطابقة تماماً للاختبار الناجح وبشكل ديناميكي
    const formattedPayload = {
      property_id: Number(payload.property_id || 1),
      booking_id: payload.booking_id || `BOOK_${Date.now()}`,
      status: payload.status || "new",
      rental_type: payload.rental_type || "daily",
      check_in_date: payload.check_in_date,
      check_out_date: payload.check_out_date,
      currency: payload.currency || "JOD", // 👈 الحقل في الجذر
      
      guest: {
        name: payload.guest?.name || "Guest",
        phone: payload.guest?.phone || null,
        email: payload.guest?.email || null,
        gender: payload.guest?.gender || "male"
      },

      rooms: (payload.rooms || []).map((room) => ({
        unit_type_id: Number(room.unit_type_id),
        rate_plan_id: room.rate_plan_id ? Number(room.rate_plan_id) : null,
        amount: Number(room.amount || 0),
        occupancy: {
          adults: room.occupancy?.adults ?? 1,
          children: room.occupancy?.children ?? 0,
          infants: room.occupancy?.infants ?? 0
        },
        daily_rates: room.daily_rates || []
      })),

      totals: {
        room_charges: Number(payload.totals?.room_charges || payload.rooms?.[0]?.amount || 0),
        additional_charges: Number(payload.totals?.additional_charges || 0),
        discount: Number(payload.totals?.discount || 0),
        total: Number(payload.totals?.total || payload.rooms?.[0]?.amount || 0),
        currency: "JOD" // 👈 الحقل داخل الإجماليات
      },

      booking_payment_method: payload.booking_payment_method || "pay_at_hotel"
    };

    console.log("📤 Sending formatted reservation request to Zaaer:");
    console.log(JSON.stringify(formattedPayload, null, 2));

    const response = await axios.post(
      `${ZAAER_BASE_URL}/reservations`,
      formattedPayload,
      {
        headers: getHeaders(),
      }
    );

    const responseData = response.data;
    const result = responseData?.result ?? responseData;

    const reservationId =
      result?.id ??
      result?.reservation?.id ??
      result?.reservation_id ??
      null;

    console.log("📥 Zaaer HTTP status:", response.status);
    console.log("📥 Zaaer response:", JSON.stringify(responseData, null, 2));

    return {
      success: true,
      data: result,
      reservationId,
    };
  } catch (error) {
    console.error("❌ Zaaer reservation creation failed:");
    console.error("Status:", error.response?.status);
    console.error("Details:", JSON.stringify(error.response?.data, null, 2));

    return {
      success: false,
      error: error.response?.data ?? error.message,
      status: error.response?.status ?? null,
    };
  }
}

module.exports = {
  getReservations,
  getProperties,
  getReservationQuote,
  createReservation,
};