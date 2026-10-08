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
 * 1. جلب قائمة الحجوزات مع الحقول ذات الصلة بالتوفر
 */
// في ملف services/zaaerService.js// services/zaaerService.js

/**
 * جلب قائمة الحجوزات واستخراج رقم الغرفة ونوعها بدقة من مصفوفة rooms
 */
async function getReservations() {
    try {
        const response = await axios.get(`${ZAAER_BASE_URL}/reservations`, {
            headers: getHeaders(),
            params: { page: 1, limit: 50 }
        });

        const items = response.data?.result?.items || response.data?.items || [];

        return items.map(item => {
            // استخراج أول غرفة مسجلة بداخل الحجز
            const primaryRoom = item.rooms && item.rooms.length > 0 ? item.rooms[0] : {};

            return {
                id: item.id,
                reservation_number: item.number,
                // جلب رقم الغرفة المباشر من داخل مصفوفة rooms (مثال: "102", "205", "301")
                unit_name: primaryRoom.unit_name || item.unit_name || 'غير محدد',
                name: item.guest_name || item.name || 'ضيف مجهول',
                // جلب نوع الشقة (مثال: "استديو (غرفه/صاله/صوفابد)")
                unit_type_name: primaryRoom.unit_type_name || 'غير محدد',
                check_in_date: item.check_in_date,
                check_out_date: item.check_out_date,
                status: item.reservation_status || item.status || 'confirmed'
            };
        });
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
        // يجلب مسار properties/units التفاصيل المتاحة
        const response = await axios.get(`${ZAAER_BASE_URL}/properties`, {
            headers: getHeaders(),
            params: { page: 1, limit: 50 }
        });

        const items = response.data?.result?.items || response.data?.items || response.data?.data || [];

        // تمرير التفاصيل الشاملة للغرف حتى يتعرف الذكاء الاصطناعي على مواصفاتها
        return items.map(item => ({
            id: item.id,
            unit_name: item.name || item.title || item.unit_number || `شقة ${item.id}`,
            type: item.type || item.category_name || item.rate_plan ||  item.unit_type_name || 'غير محدد',
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

module.exports = {
    getReservations,
    getProperties
};