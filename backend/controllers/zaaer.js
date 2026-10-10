// services/zaaerService.js
const axios = require('axios');

const ZAAER_BASE_URL = process.env.ZAAER_BASE_URL || 'https://sahl-suites.zaaer.com/api/v1';
const ZAAER_TOKEN = process.env.ZAAER_API_TOKEN || '1|bykZSg9iLODV6jITNRHx1rCAhEoYMpEYOHbfKKGRd522b0ea';

// إعداد الترويسات الموحدة
const getHeaders = () => ({
    'Authorization': `Bearer ${ZAAER_TOKEN}`,
    'Accept': 'application/json',
});

/**
 * 1. جلب قائمة الحجوزات واستخراج رقم الغرفة ونوعها بدقة من مصفوفة rooms
 */
async function getReservations() {
    try {
        let allReservations = [];
        let currentPage = 1;
        let hasMorePages = true;
        const limitPerPage = 100;

        // جلب كافة الصفحات من النظام
        while (hasMorePages) {
            const response = await axios.get(`${ZAAER_BASE_URL}/reservations`, {
                headers: getHeaders(),
                params: { page: currentPage, limit: limitPerPage }
            });

            const items = response.data?.result?.items || response.data?.items || [];

            if (items.length === 0) {
                hasMorePages = false;
                break;
            }

            allReservations.push(...items);

            const meta = response.data?.result?.meta || response.data?.meta;
            if (meta && meta.last_page) {
                hasMorePages = currentPage < meta.last_page;
            } else {
                hasMorePages = items.length === limitPerPage;
            }
            currentPage++;
        }

        // قائمة الحالات المطلوب عرضها فقط (تجاهل الملغاة والمغادرة)
        const activeStatuses = ['confirmed', 'unconfirmed', 'checked_in'];

        // فلترة البيانات وتنسيقها
        const filteredReservations = allReservations
            .filter(item => {
                const currentStatus = item.reservation_status || item.status || '';
                return activeStatuses.includes(currentStatus.toLowerCase());
            })
            .map(item => {
                const primaryRoom = Array.isArray(item.rooms) && item.rooms.length > 0 ? item.rooms[0] : {};

                return {
                    id: item.id,
                    reservation_number: item.number,
                    guest_name: item.guest?.name || 'غير محدد',
                    unit_name: primaryRoom.unit_name || item.unit_name || 'غير محدد',
                    unit_type_name: primaryRoom.unit_type_name || 'غير محدد',
                    check_in_date: item.check_in_date,
                    check_out_date: item.check_out_date,
                    // ترجمة حالة الحجز ليفهمها الـ AI والمستخدم بوضوح
                    status: item.reservation_status === 'checked_in' ? 'مقيم حالياً' : 'مؤكد / بانتظار الوصول'
                };
            });

        console.log(`📊 إجمالي الحجوزات النشطة والمستقبلية: ${filteredReservations.length} من أصل ${allReservations.length}`);

        return filteredReservations;

    } catch (error) {
        console.error('خطأ أثناء جلب الحجوزات من Zaaer:', error.response?.data || error.message);
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

/**
 * 3. حساب تسعيرة الحجز (Quote) بناءً على تفاصيل الغرف، التواريخ، والخصومات
 * @param {Object} quoteData - بيانات طلب التسعيرة (التواريخ، الغرف، الكوبون، إلخ)
 */

async function getReservationQuote(quoteData) {
    try {
        console.log(
            '📤 Quote request payload:',
            JSON.stringify(quoteData, null, 2)
        );

        const response = await axios.post(
            `${ZAAER_BASE_URL}/reservations/quote`,
            quoteData,
            {
                headers: {
                    ...getHeaders(),
                    'Content-Type': 'application/json',
                }
            }
        );

        const quoteResult =
            response.data?.result || response.data || {};

        console.log('✅ تم جلب تسعيرة الحجز بنجاح');

        return {
            success: true,
            data: quoteResult
        };

    } catch (error) {
        console.error(
            '❌ خطأ أثناء جلب تسعيرة الحجز من Zaaer:',
            error.response?.data || error.message
        );

        return {
            success: false,
            error: error.response?.data || error.message
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
                'Authorization': `Bearer ${process.env.ZAAER_API_TOKEN}`,
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