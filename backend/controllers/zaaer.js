// services/zaaerService.js
const axios = require('axios');

const ZAAER_BASE_URL ='https://sahl-suites.zaaer.com/api/v1';
const ZAAER_TOKEN ='1|bykZSg9iLODV6jITNRHx1rCAhEoYMpEYOHbfKKGRd522b0ea';

// إعداد الترويسات الموحدة
const getHeaders = () => {
    if (
      typeof ZAAER_TOKEN !== 'string' ||
      !ZAAER_TOKEN.trim()
    ) {
      throw new Error('ZAAER_TOKEN is missing or empty');
    }
  
    return {
      Authorization: `Bearer ${ZAAER_TOKEN.trim()}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  };

/**
 * 1. جلب قائمة الحجوزات واستخراج رقم الغرفة ونوعها بدقة من مصفوفة rooms
 */
async function getReservations() {
    try {
      let allReservations = [];
      let currentPage = 1;
      let hasMorePages = true;
      const limitPerPage = 100;
  
      // جلب جميع صفحات الحجوزات من Zaaer
      while (hasMorePages) {
        const response = await axios.get(
          `${ZAAER_BASE_URL}/reservations`,
          {
            headers: getHeaders(),
            params: {
              page: currentPage,
              limit: limitPerPage,
            },
          }
        );
  
        const items =
          response.data?.result?.items ??
          response.data?.items ??
          [];
  
        if (!Array.isArray(items) || items.length === 0) {
          hasMorePages = false;
          break;
        }
  
        // الاحتفاظ بجميع الحقول الأصلية لكل حجز
        allReservations.push(...items);
  
        const meta =
          response.data?.result?.meta ??
          response.data?.meta;
  
        if (meta?.last_page != null) {
          hasMorePages = currentPage < meta.last_page;
        } else {
          hasMorePages = items.length === limitPerPage;
        }
  
        currentPage++;
      }
  
      // إرجاع جميع الحجوزات دون تحديد حقول معينة
      const allReservationsData = allReservations.map(
        (item) => ({ ...item })
      );
  
      console.log(
        `📊 إجمالي الحجوزات المسترجعة: ${allReservationsData.length}`
      );
  
      return allReservationsData;
  
    } catch (error) {
      console.error(
        '❌ خطأ أثناء جلب الحجوزات من Zaaer:',
        {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        }
      );
  
      return [];
    }
  }
  

/**
 * 2. جلب قائمة الغرف/الوحدات مع التفاصيل الكاملة (الأسعار، الطاقة الاستيعابية، والمواصفات)
 */
async function getProperties() {
    try {
        // يجلب مسار properties التفاصيل المتاحة
        const response = await axios.get(`${ZAAER_BASE_URL}/properties`, {
            headers: getHeaders(),
            params: { page: 1, limit: 50 }
        });

        const items = response.data?.result?.items || response.data?.items || response.data?.data || [];

        // تمرير التفاصيل الشاملة للغرف حتى يتعرف الذكاء الاصطناعي على مواصفاتها
        return items.map(item => ({
            id: item.id,
            unit_name: item.name || item.title || item.unit_number || `شقة ${item.id}`,
            type: item.type || item.category_name || item.rate_plan || item.unit_type_name || 'غير محدد',
            capacity: item.capacity || item.max_guests || 'حسب نوع الشقة',
            beds: item.bedrooms_count || item.beds || 'غير محدد',
            price_per_night: item.base_price || item.rate || item.price || 'يتحدد حسب التواريخ',
            description: item.description || item.notes || '',
            status: item.status || 'متاحة'
        }));
    } catch (error) {
        console.error('خطأ أثناء جلب الوحدات من Zaaer:', error.response?.data || error.message);
        return [];
    }
}

async function getReservationQuote(quoteData) {
    const url = `${ZAAER_BASE_URL}/reservations/quote`;
  
    try {
      console.log(
        '📤 Quote request payload:',
        JSON.stringify(quoteData, null, 2)
      );
  
      const response = await axios.post(url, quoteData, {
        headers: {
          ...getHeaders(),
          'Content-Type': 'application/json',
        },
      });
  
      console.log('✅ Quote response status:', response.status);
      console.log(
        '📥 Quote response data:',
        JSON.stringify(response.data, null, 2)
      );
  
      const quoteResult =
        response.data?.result ?? response.data ?? {};
  
      return {
        success: true,
        data: quoteResult,
      };
    } catch (error) {
      console.error('❌ Zaaer quote diagnostic:', {
        message: error.message,
        status: error.response?.status,
        responseData: error.response?.data,
        requestUrl: error.config?.url,
        requestMethod: error.config?.method,
        responseContentType:
          error.response?.headers?.['content-type'],
        requestId:
          error.response?.headers?.['x-request-id'],
      });
  
      return {
        success: false,
        error: error.response?.data ?? error.message,
        status: error.response?.status ?? null,
      };
    }
  }
  

/**
 * 4. إنشاء حجز فعلي مؤكد في النظام
 * @param {Object} reservationData - بيانات الحجز الكاملة (العميل، الغرف، التواريخ)
 */
// داخل zaaerService.js (أو ملف الـ API الخاص بـ Zaaer)
async function createReservation(payload) {
    try {
        const response = await axios.post('https://sahl-suites.zaaer.com/api/v1/reservations', payload, {
            headers: {
                'Authorization': `Bearer ${ZAAER_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        // هذا السطر سيلتقط رسالة الخطأ الحقيقية من زائر (حتى لو كانت 409 أو 404 أو 422)
        if (error.response && error.response.data) {
            console.error('❌ خطأ تفصيلي من Zaaer API:', JSON.stringify(error.response.data, null, 2));
            return error.response.data; // إرجاع كائن الخطأ للـ AI ليقرأه ويعرف السبب
        }
        throw error;
    }
}

// ولا تنسَ إضافتها في module.exports في نهاية الملف:
module.exports = {
    getReservations,
    getProperties,
    getReservationQuote,
    createReservation 
};