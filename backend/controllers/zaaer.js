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

    // بناء الـ Body المعتمد المتوافق مع توثيق Zaaer API
    const formattedPayload = {
      property_id: Number(payload.property_id),
      booking_id: payload.booking_id || `BOOK_${Date.now()}`, // معرف فريد إجباري
      status: payload.status || "new",                         // new, modified, cancelled
      rental_type: payload.rental_type || "daily",             // daily or monthly
      check_in_date: payload.check_in_date,                    // YYYY-MM-DD
      check_out_date: payload.check_out_date,                  // YYYY-MM-DD
      
      // تفاصيل العميل (الاسم إجباري)
      guest: {
        name: payload.guest?.name || `${payload.guest?.first_name || "Guest"} ${payload.guest?.last_name || ""}`.trim(),
        phone: payload.guest?.phone || null,
        email: payload.guest?.email || null,
        gender: payload.guest?.gender || null,
        address: payload.guest?.address || null,
      },

      // تجهيز مصفوفة الغرف وتطبيق القواعد
      rooms: (payload.rooms || []).map((room) => {
        // إزالة unit_count لحظر زائر له
        const { unit_count, ...cleanRoom } = room;
        
        return {
          unit_type_id: Number(cleanRoom.unit_type_id),
          rate_plan_id: cleanRoom.rate_plan_id ? Number(cleanRoom.rate_plan_id) : null,
          amount: Number(cleanRoom.amount || 0),
          occupancy: {
            adults: cleanRoom.occupancy?.adults ?? 1,
            children: cleanRoom.occupancy?.children ?? 0,
            infants: cleanRoom.occupancy?.infants ?? 0,
          },
          daily_rates: cleanRoom.daily_rates || [],
        };
      }),

      // تجهيز الإجماليات الحسابية
      totals: payload.totals || {
        room_charges: Number(payload.rooms?.reduce((acc, r) => acc + (r.amount || 0), 0) || 0),
        additional_charges: 0,
        discount: 0,
        total: Number(payload.rooms?.reduce((acc, r) => acc + (r.amount || 0), 0) || 0),
      },

      booking_payment_method: payload.booking_payment_method || "pay_at_hotel",
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