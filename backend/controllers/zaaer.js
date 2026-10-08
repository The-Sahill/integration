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
// في ملف services/zaaerService.js
async function getReservations() {
    try {
        const response = await axios.get(`${ZAAER_BASE_URL}/reservations`, {
            headers: getHeaders(),
            params: { page: 1, limit: 50 }
        });

        const items = response.data?.result?.items || response.data?.items || [];

        return items.map(item => ({
            id: item.id,
            // يقرأ unit_name المباشر ("102") أولاً، ثم الخيارات البديلة إذا لم يتوفر
            unit_name: item.unit_name || item.unit?.name || item.unit_number || `وحدة #${item.unit_id || item.id}`,
            check_in_date: item.check_in_date || item.check_in,
            check_out_date: item.check_out_date || item.check_out,
            status: item.reservation_status || item.status || 'confirmed',
            unit_type_name: item.unit_type_name || item.unit?.unit_type_name || 'غير محدد',
        }));
    } catch (error) {
        console.error('خطأ أثناء جلب الحجوزات:', error.message);
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