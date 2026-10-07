// services/zaaerService.js
const axios = require('axios');

const ZAAER_BASE_URL = process.env.ZAAER_BASE_URL || 'https://sahl-suites.zaaer.com/api/v1';
const ZAAER_TOKEN = process.env.ZAAER_API_TOKEN || '1|bykZSg9iLODV6jITNRHx1rCAhEoYMpEYOHbfKKGRd522b0ea';

// جلب الغرف أو الحجوزات لمعرفة الغرف المتاحة
async function getAvailableRooms(checkInDate, checkOutDate) {
    try {
        // يمكنك إما استدعاء API الغرف المباشر إن وجد أو جلب الحجوزات لمعرفة الشاغر
        const response = await axios.get(`${ZAAER_BASE_URL}/reservations?page=1&limit=100`, {
            headers: {
                'Authorization': `Bearer ${ZAAER_TOKEN}`,
                'Accept': 'application/json',
            }
        });

        // إرجاع البيانات للـ AI
        return response.data;
    } catch (error) {
        console.error('خطأ أثناء جلب حالة الغرف من Zaaer:', error.response?.data || error.message);
        throw new Error('تعذر جلب حالة الغرف من النظام.');
    }
}
async function getReservationByCode(reservationCode) {
    try {
        const response = await axios.get(`${ZAAER_BASE_URL}/reservations`, {
            headers: {
                'Authorization': `Bearer ${ZAAER_TOKEN}`,
                'Accept': 'application/json',
            },
            params: {
                search: reservationCode // أو حسب المفتاح الخاص بالبحث في API Zaaer (مثل reservation_number أو code)
            }
        });

        return response.data;
    } catch (error) {
        console.error('خطأ أثناء جلب تفاصيل الحجز من Zaaer:', error.response?.data || error.message);
        throw new Error('تعذر جلب تفاصيل الحجز من النظام.');
    }
}
module.exports = {
    getAvailableRooms,getReservationByCode
};