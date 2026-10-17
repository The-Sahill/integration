// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const webhookRoute = require('./routes/webhookRoute');
const chatRoute = require('./routes/chatRoute');
const zaaerService = require('./controllers/zaaer');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. الاتصال بقاعدة البيانات MongoDB أولاً وقبل كل شيء
const MONGO_URI = process.env.MongoDB_URL;

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ تم الاتصال بقاعدة البيانات MongoDB بنجاح'))
  .catch((err) => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message));

// 2. مسار فحص سريع للتأكد أن السيرفر يعمل
app.get('/', (req, res) => {
    res.status(200).send("Server is running and ready! 🚀");
});

// 3. ربط مسارات الـ Webhook و الـ Dashboard
app.use('/webhook', webhookRoute);
app.use('/api/dashboard', chatRoute);

// 4. مسار اختبار الحجز المباشر
app.post('/api/test-direct-booking', async (req, res) => {
  try {
    console.log("🚀 جاري اختبار الحجز المباشر ببيانات ثابتة لـ Zaaer...");

    const staticPayload = {
      property_id: 1, 
      booking_id: `DIRECT_TEST_${Date.now()}`,
      status: "new",
      rental_type: "daily",
      check_in_date: "2026-11-01",
      check_out_date: "2026-11-03",
      currency: "JOD", 
      
      guest: {
        name: "Test Direct User",
        phone: "966500000000",
        email: "test@direct.com",
        gender: "male"
      },

      rooms: [
        {
          unit_type_id: 6, 
          rate_plan_id: null, 
          amount: 200, 
          occupancy: {
            adults: 1,
            children: 0,
            infants: 0
          },
          daily_rates: [
            { date: "2026-11-01", unit_price: 100 },
            { date: "2026-11-02", unit_price: 100 }
          ]
        }
      ],

      totals: {
        room_charges: 200,
        additional_charges: 0,
        discount: 0,
        total: 200,
        currency: "JOD" 
      },

      booking_payment_method: "pay_at_hotel"
    };

    const result = await zaaerService.createReservation(staticPayload);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "رفض زائر الحجز المباشر",
        error: result.error
      });
    }

    return res.status(200).json({
      success: true,
      message: "تم حجز الغرفة بنجاح عبر الاتصال المباشر!",
      data: result.data
    });

  } catch (error) {
    console.error("❌ خطأ في مسار الحجز المباشر:", error.message);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم",
      error: error.message
    });
  }
});

// 5. تشغيل السيرفر في النهاية
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});