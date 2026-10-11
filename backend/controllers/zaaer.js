
const axios = require("axios");

const ZAAER_BASE_URL =
  process.env.ZAAER_BASE_URL || "https://sahl-suites.zaaer.com/api/v1";

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
    const response = await axios.get(
      `${ZAAER_BASE_URL}${endpoint}`,
      {
        headers: getHeaders(),
        params: {
          ...extraParams,
          page,
          limit,
        },
      }
    );

    const items = extractItems(response.data);

    if (items.length === 0) {
      break;
    }

    // لا نحذف أي حقول من استجابة Zaaer
    allItems.push(...items);

    const meta = extractMeta(response.data);

    if (meta.last_page != null) {
      hasMorePages = page < Number(meta.last_page);
    } else if (meta.current_page != null && meta.last_page != null) {
      hasMorePages =
        Number(meta.current_page) < Number(meta.last_page);
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

    console.log(
      `📊 إجمالي الحجوزات المسترجعة: ${reservations.length}`
    );

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

// 2. جلب بيانات الوحدات/العقارات دون اختصار حقولها
async function getProperties() {
  try {
    const properties = await getAllPages("/properties");

    console.log(
      `🏠 إجمالي العناصر المسترجعة من properties: ${properties.length}`
    );

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

// 3. حساب تسعيرة الحجز وإرجاع كامل بيانات الاستجابة
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

// 4. إنشاء الحجز
async function createReservation(payload) {
  try {
    if (!payload || typeof payload !== "object") {
      throw new Error("Reservation payload must be an object");
    }

    console.log("📤 إرسال طلب إنشاء الحجز إلى Zaaer");

    const response = await axios.post(
      `${ZAAER_BASE_URL}/reservations`,
      payload,
      {
        headers: getHeaders(),
      }
    );

    const responseData = response.data;
    const result = responseData?.result ?? responseData;

    // محاولة استخراج رقم الحجز من أشهر أشكال الاستجابة.
    // يجب التأكد من أسماء الحقول وفق استجابة Zaaer الفعلية.
    const reservationId =
      result?.id ??
      result?.reservation?.id ??
      result?.reservation_id ??
      result?.reservation?.reservation_id ??
      null;

    console.log("📥 Create reservation HTTP status:", response.status);
    console.log(
      "🔎 هل أعاد النظام رقم حجز؟",
      Boolean(reservationId)
    );

    return {
      success: true,
      data: result,
      rawResponse: responseData,
      reservationId,
      requiresVerification: !reservationId,
    };
  } catch (error) {
    console.error("❌ فشل طلب إنشاء الحجز:", {
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

module.exports = {
  getReservations,
  getProperties,
  getReservationQuote,
  createReservation,
};
