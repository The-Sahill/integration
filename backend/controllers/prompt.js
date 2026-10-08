// prompt.js

const zaaerService = require('../controllers/zaaer');
const RECEPTION_CONTEXT = `
 بدي منك تزود اي حد ببعتلك بيانات الغرف الموجوة عندك ومحجوزة
`;

 
async function getPrompt(messageText, reservationsData = [], roomsData = []) {
  // تنسيق البيانات إلى نص JSON واضح ليقرأه النموذج الذكي بسهولة
  const formattedReservations = JSON.stringify(reservationsData, null, 2);
  const formattedRooms = JSON.stringify(roomsData, null, 2);
    return `
${RECEPTION_CONTEXT}


[بيانات الغرف والوحدات المتاحة]:
${formattedRooms}

[بيانات الحجوزات الحقيقية المسجلة]:
${formattedReservations}

العميل يسأل عبر الواتساب:
"${messageText}"
بيانات الحجز الحقيقية من النظام هي:






`;
}

module.exports = { getPrompt, RECEPTION_CONTEXT };