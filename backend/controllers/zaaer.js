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
 * 1. جلب قائمة الحجوزات المخصصة (الحقول المطلوبة فقط)
 */
async function getReservations() {
    try {
        const response = await axios.get(`${ZAAER_BASE_URL}/reservations`, {
            headers: getHeaders(),
            params: { page: 1, limit: 50 }
        });

        const items = response.data?.result?.items || response.data?.items || [];

        // استخراج وتخصيص البيانات المطلوبة فقط للـ AI
        return items.map(item => ({
            unit_name: item.unit_name || item.unit?.name || 'غير محدد',
            check_in_date: item.check_in_date,
            check_out_date: item.check_out_date,
        }));
    } catch (error) {
        console.error('خطأ أثناء جلب الحجوزات من Zaaer:', error.response?.data || error.message);
        return [];
    }
}

/**
 * 2. جلب قائمة الغرف / الوحدات المتاحة في النظام
 */
async function getProperties() {
    try {
        const response = await axios.get(`${ZAAER_BASE_URL}/properties`, {
            headers: getHeaders(),
            params: { page: 1, limit: 50 }
        });

        const items = response.data?.result?.items || response.data?.items || [];

        // استخراج اسم ووصف/تفاصيل كل غرفة
        return items.map(item => ({
            id: item.id,
            name: item.name || item.title,
            type: item.type || 'شقة'
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