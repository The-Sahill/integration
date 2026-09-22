import React from 'react';
import { User, Lock } from 'lucide-react';
import registerBg from '../../assets/images/Register.jpg'; // استبدل بمسار الصورة الخاصة بك
import { Link } from 'react-router-dom';

export default function SignupCard() {
  return (
    // الحاوية الرئيسية: استخدام الصورة المستوردة كخلفية
    <div 
      className="relative flex items-center justify-center min-h-screen font-sans bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${registerBg})` }} 
    >
      {/* طبقة تغشية (Overlay) داكنة خفيفة فوق الصورة لضمان وضوح النص */}
      <div className="absolute inset-0  z-0"></div>

      {/* صندوق إنشاء الحساب الشفاف */}
      <div className="relative z-10 w-full max-w-md mx-4 p-8 rounded-[2.5rem] backdrop-blur-xl bg-gradient-to-b from-white/5 via-white/5 to-black/10 border border-white/10 shadow-2xl shadow-black/30 text-right" dir="rtl">
        
        {/* العنوان */}
        <h2 className="text-3xl font-bold text-white text-center mb-10 tracking-tight">
         تسجيل الدخول
        </h2>

        {/* نموذج الإدخال */}
        <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
          
          {/* حقل اسم المستخدم */}
          <div className="relative flex items-center group">
            <input
              type="text"
              placeholder="اسم المستخدم"
              className="w-full py-4 pr-14 pl-5 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-gray-400 text-base focus:outline-none focus:border-blue-400/50 focus:ring-2 focus:ring-blue-400/20 transition duration-300"
            />
            <User className="absolute right-5 w-6 h-6 text-gray-400 group-focus-within:text-blue-300 transition" />
          </div>

         

          {/* حقل كلمة المرور */}
          <div className="relative flex items-center group">
            <input
              type="password"
              placeholder="كلمة المرور"
              className="w-full py-4 pr-14 pl-5 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-gray-400 text-base focus:outline-none focus:border-blue-400/50 focus:ring-2 focus:ring-blue-400/20 transition duration-300"
            />
            <Lock className="absolute right-5 w-6 h-6 text-gray-400 group-focus-within:text-blue-300 transition" />
          </div>

           

          {/* زر التسجيل */}
          <div className="pt-4">
            <button
              type="submit"
              className="w-full py-4 bg-white hover:bg-blue-50 text-slate-950 font-bold text-lg rounded-2xl shadow-lg shadow-white/10 transition duration-300 text-center"
            >
              تسجيل
            </button>
          </div>

        </form>

        {/* رابط تسجيل الدخول */}
        <div className="text-center mt-8">
          <p className="text-base text-gray-300">
            ليس لديك حساب؟{' '}
            <Link to="/">
            <a className="text-blue-300 font-semibold hover:text-blue-200 transition">
               تسجيل حساب جديد
            </a>
            </Link>
          </p>
        </div>

      </div>
    </div>
  );
}