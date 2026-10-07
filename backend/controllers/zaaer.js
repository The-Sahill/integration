// services/zaaerService.js
const axios = require('axios');

const ZAAER_BASE_URL = process.env.ZAAER_BASE_URL || 'https://sahl-suites.zaaer.com/api/v1';
const ZAAER_TOKEN = process.env.ZAAER_API_TOKEN || '1|bykZSg9iLODV6jITNRHx1rCAhEoYMpEYOHbfKKGRd522b0ea';

// إعداد الهيدرز الموحدة
const getHeaders = () => ({
    'Authorization': `Bearer ${ZAAER_TOKEN}`,
    'Accept': 'application/json',
});

/**
 * 1. جلب الحجوزات والمساعدة في تحديد الشاغر
 */
async function getAvailableRooms(checkInDate, checkOutDate) {
    try {
        const response = await axios.get(`${ZAAER_BASE_URL}/reservations`, {
            headers: getHeaders(),
            params: {
                page: 1,
                limit: 100
            }
        });

        // استخراج القائمة المباشرة من استجابة زائر
        const items = response.data?.result?.items || [];

        return {
            status: "success",
            checkInDate: checkInDate || null,
            checkOutDate: checkOutDate || null,
            total_reservations: items.length,
            reservations: items
        };
    } catch (error) {
        console.error('خطأ أثناء جلب حالة الغرف من Zaaer:', error.response?.data || error.message);
        throw new Error('تعذر جلب حالة الغرف من النظام.');
    }
}

/**
 * 2. البحث عن حجز معين برقم الحجز أو اسم النزيل
 */
async function getReservationByCode(reservationCode) {
    try {
        // جلب آخر الحجوزات لفلترتها
        const response = await axios.get(`${ZAAER_BASE_URL}/reservations`, {
            headers: getHeaders(),
            params: {
                page: 1,
                limit: 100,
                search: reservationCode // إرسال المعامل للـ API إن كان يدعمه
            }
        });

        const items = response.data?.result?.items || [];

        if (!reservationCode) {
            return { status: "success", count: items.length, items };
        }

        const cleanCode = String(reservationCode).trim().toLowerCase();

        // فلترة النتائج محلياً لضمان إيجاد الحجز حتى لو لم يدعم الـ API معيار search
        const matchedReservations = items.filter(item => {
            const numberMatch = item.number && String(item.number).toLowerCase().includes(cleanCode);
            const bookingIdMatch = item.booking_id && String(item.booking_id).toLowerCase().includes(cleanCode);
            const guestNameMatch = item.guest?.name && String(item.guest.name).toLowerCase().includes(cleanCode);

            return numberMatch || bookingIdMatch || guestNameMatch;
        });

        if (matchedReservations.length > 0) {
            return {
                status: "success",
                found: true,
                count: matchedReservations.length,
                reservation: matchedReservations[0], // إرجاع أول حجز مطابق
                all_matches: matchedReservations
            };
        }

        return {
            status: "success",
            found: false,
            message: `لم يتم العثور على أي حجز برقم أو اسم: ${reservationCode}`
        };

    } catch (error) {
        console.error('خطأ أثناء جلب تفاصيل الحجز من Zaaer:', error.response?.data || error.message);
        throw new Error('تعذر جلب تفاصيل الحجز من النظام.');
    }
}

module.exports = {
    getAvailableRooms,
    getReservationByCode
};