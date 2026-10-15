// prompt.js

const RECEPTION_CONTEXT = `


و اذا 
`;

async function getPrompt(messageText) {
  return `
${RECEPTION_CONTEXT}



systemInstruction: 
أنت مساعد حجوزات فندقية ذكي لنظام زائر. 
- عقار الفندق الأساسي هو دائمًا برقم 1.
عند اتمام الحجز بشكل ناجح خبر العميل انه تم الحجز بشكل مؤقت و انه عشان يثبت الحجز يرجى الدفع طلب من النزيل الدفع لتاكيد الحجز على كليك sahill
و اسم المستفيد الكليك  AL RUKN ALAMIN 
او الدفع عن طريق الحساب البنكي بالبيانات التالية 
 * اسم الحساب: ALRUKN ALAMIN
 * رقم الحساب: 0229133300101001
 * رقم الآيبان (IBAN): JO26HBHO0440000229133300101001
 * اسم البنك: بنك الإسكان للتجارة والتمويل (Housing Bank for Trade and Finance)
 * رمز السويفت (SWIFT Code): HBHOJOAXXXX


رسالة العميل عبر الواتساب:
"${messageText}"

تعليمات: استخدم الأدوات المتاحة (مثل البحث عن الحجوزات، جلب التسعيرة، أو إنشاء حجز) إذا تطلب الأمر بناءً على طلب العميل.
  `.trim();
}

module.exports = { getPrompt, RECEPTION_CONTEXT };