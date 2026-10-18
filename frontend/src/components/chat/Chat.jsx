import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client'; // 👈 استدعاء مكتبة السوكيت
import { 
  Search, Bot, User, Send, Lock, MessageSquare, 
  CheckCheck, RefreshCw, Zap
} from 'lucide-react';



// تحديد رابط السيرفر تلقائياً بناءً على مكان تشغيل الصفحة
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// إذا فتحت الموقع محلياً يتصل بـ localhost، وإذا فتحته من الرابط الأونلاين يتصل بسيرفر Render
const SOCKET_URL = IS_LOCAL 
  ? 'http://localhost:4000' 
  : 'https://the-sahill-stays-integration.onrender.com';


const DEFAULT_AVATAR = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150";

export default function HotelChatDashboard() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null); // 👈 مرجع للاتصال الحي

  // 1. جلب المحادثات لمرة واحدة عند الفتح فقط
  const fetchConversations = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/conversations`);
      const data = response.data;
      setConversations(data);

      if (data.length > 0 && !activeId) {
        setActiveId(data[0]._id);
      }
      setLoading(false);
      setError(null);
    } catch (err) {
      console.error('خطأ في جلب المحادثات:', err);
      setError("تعذر الاتصال بالخادم.");
      setLoading(false);
    }
  };

  // 2. إعداد الاتصال الحي عبر Socket.io (بدون تكرار مزعج)
  useEffect(() => {
    fetchConversations();

    // الاتصال بسيرفر الباك إند
    socketRef.current = io(SOCKET_URL);

    // الاستماع لأي رسالة جديدة أو تحديث في المحادثات
    socketRef.current.on('new_message_received', (updatedConversation) => {
      setConversations(prevConversations => {
        const index = prevConversations.findIndex(c => c._id === updatedConversation._id);
        if (index !== -1) {
          // تحديث المحادثة الموجودة مسبقاً في القائمة
          const updatedList = [...prevConversations];
          updatedList[index] = updatedConversation;
          return updatedList;
        } else {
          // إضافة محادثة جديدة كلياً للقائمة
          return [updatedConversation, ...prevConversations];
        }
      });
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const activeConv = conversations.find(c => c._id === activeId) || conversations[0];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages]);

  const toggleAi = async (convId, currentState) => {
    try {
      const res = await axios.patch(`${API_BASE_URL}/conversations/${convId}/toggle-ai`, {
        aiEnabled: !currentState
      });
      // تحديث الحالة محلياً فوراً
      setConversations(prev => prev.map(c => c._id === convId ? res.data : c));
    } catch (err) {
      console.error('خطأ أثناء تغيير حالة الـ AI:', err);
    }
  };

  const handleSendManualMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConv || activeConv.aiEnabled) return;

    const messageText = inputText;
    setInputText("");

    try {
      const res = await axios.post(`${API_BASE_URL}/conversations/${activeConv._id}/send-message`, {
        text: messageText
      });
      // تحديث المحادثة محلياً فوراً بالرسالة اليدوية
      setConversations(prev => prev.map(c => c._id === activeConv._id ? res.data : c));
    } catch (err) {
      console.error('خطأ أثناء إرسال الرسالة اليدوية:', err);
      alert('فشل إرسال الرسالة للعميل.');
    }
  };

  const filteredConversations = conversations.filter(c => 
    (c.customerName && c.customerName.includes(searchQuery)) || 
    (c.customerPhone && c.customerPhone.includes(searchQuery))
  );

  if (loading) {
    return (
      <div className="flex h-screen bg-slate-900 text-slate-100 items-center justify-center font-sans">
        <div className="flex items-center gap-3 text-emerald-400">
          <RefreshCw className="w-6 h-6 animate-spin" />
          <span>جاري الاتصال بالنظام الحي (WebSockets)...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans" dir="rtl">
      {/* القائمة الجانبية */}
      <div className="w-full md:w-80 lg:w-96 bg-slate-800 border-l border-slate-700 flex flex-col h-full">
        <div className="p-4 border-b border-slate-700 flex items-center justify-between bg-slate-800/80">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-sm text-slate-100">إدارة محادثات Zaaer</h1>
              <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                مربوط حيّاً عبر WebSockets
              </p>
            </div>
          </div>
        </div>

        <div className="p-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
            <input 
              type="text"
              placeholder="بحث بالاسم أو رقم الهاتف..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg pr-9 pl-3 py-2 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border-y border-rose-500/20 text-rose-400 text-xs text-center">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
          {filteredConversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">لا توجد محادثات مسجلة حالياً</div>
          ) : (
            filteredConversations.map((conv) => {
              const isActive = conv._id === activeConv?._id;
              return (
                <div 
                  key={conv._id}
                  onClick={() => setActiveId(conv._id)}
                  className={`p-3 flex items-center gap-3 cursor-pointer transition-colors hover:bg-slate-700/40 ${
                    isActive ? 'bg-slate-700/70 border-r-4 border-emerald-500' : ''
                  }`}
                >
                  <div className="relative">
                    <img src={DEFAULT_AVATAR} alt="Avatar" className="w-11 h-11 rounded-full object-cover border border-slate-600" />
                    {conv.aiEnabled && (
                      <span className="absolute -top-1 -left-1 p-1 bg-emerald-500 text-slate-950 rounded-full text-[10px]">
                        <Bot className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <h3 className="text-sm font-semibold text-slate-200 truncate">{conv.customerName || 'عميل واتساب'}</h3>
                      <span className="text-[10px] text-slate-400">{conv.lastTime}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate dir-ltr text-right">{conv.customerPhone}</p>
                    <p className="text-xs text-slate-400 truncate mt-1">{conv.lastMessage}</p>
                  </div>
                  <div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      conv.aiEnabled 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      {conv.aiEnabled ? 'AI مفعل' : 'يدوي'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* منطقة الشات النشط */}
      {activeConv ? (
        <div className="flex-1 flex flex-col h-full bg-slate-950">
          <div className="p-3 bg-slate-800 border-b border-slate-700 flex justify-between items-center shadow-md">
            <div className="flex items-center gap-3">
              <img src={DEFAULT_AVATAR} alt="Avatar" className="w-10 h-10 rounded-full object-cover border border-slate-600" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-slate-100 text-sm">{activeConv.customerName || 'عميل واتساب'}</h2>
                  <span className="text-xs text-slate-400 dir-ltr">({activeConv.customerPhone})</span>
                </div>
                <p className="text-xs text-slate-400">
                  الحالة: <span className={activeConv.aiEnabled ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                    {activeConv.aiEnabled ? 'المساعد الذكي يدير المحادثة تلقائياً' : 'تحكم موظف الاستقبال مفعل'}
                  </span>
                </p>
              </div>
            </div>

            <button
              onClick={() => toggleAi(activeConv._id, activeConv.aiEnabled)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeConv.aiEnabled 
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30' 
                  : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/30'
              }`}
            >
              <Bot className="w-4 h-4" />
              <span>{activeConv.aiEnabled ? 'إيقاف الـ AI' : 'تفعيل الـ AI'}</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/60">
            <div className="flex justify-center my-2">
              <span className="text-[11px] bg-slate-800/80 text-slate-400 px-3 py-1 rounded-full border border-slate-700 flex items-center gap-1">
                <Zap className="w-3 h-3 text-emerald-400" />
                متصل بالوقت الحقيقي عبر WebSockets
              </span>
            </div>

            {activeConv.messages && activeConv.messages.map((msg, index) => {
              const isCustomer = msg.sender === 'customer';
              const isAi = msg.sender === 'ai';

              return (
                <div key={msg._id || index} className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm shadow-sm leading-relaxed ${
                    isCustomer 
                      ? 'bg-slate-800 text-slate-100 rounded-tr-none border border-slate-700' 
                      : isAi 
                        ? 'bg-emerald-950/70 border border-emerald-600/40 text-emerald-100 rounded-tl-none' 
                        : 'bg-blue-600 text-white rounded-tl-none'
                  }`}>
                    {isAi && (
                      <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold mb-1 border-b border-emerald-800 pb-1">
                        <Bot className="w-3 h-3" />
                        <span>Gemini & Zaaer AI</span>
                      </div>
                    )}
                    {!isCustomer && !isAi && (
                      <div className="flex items-center gap-1 text-[10px] text-blue-200 font-bold mb-1 border-b border-blue-500 pb-1">
                        <User className="w-3 h-3" />
                        <span>موظف الاستقبال</span>
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                    <div className="flex justify-end items-center gap-1 mt-1 text-[10px] text-slate-400">
                      <span>{msg.time}</span>
                      {!isCustomer && <CheckCheck className="w-3 h-3 text-emerald-400" />}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 bg-slate-800 border-t border-slate-700">
            {activeConv.aiEnabled ? (
              <div className="flex items-center justify-between p-3 bg-slate-900 border border-emerald-500/30 rounded-xl text-slate-300">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-emerald-400">حقل الكتابة مغلق - الـ AI مفعل</p>
                    <p className="text-[11px] text-slate-400">يقوم نموذج Gemini بالرد تلقائياً على العميل.</p>
                  </div>
                </div>
                <button
                  onClick={() => toggleAi(activeConv._id, activeConv.aiEnabled)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg text-xs"
                >
                  تعطيل الـ AI للكتابة
                </button>
              </div>
            ) : (
              <form onSubmit={handleSendManualMessage} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="اكتب رسالتك اليدوية كموظف وسترسل فوراً..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 text-slate-100 text-xs sm:text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="p-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors disabled:opacity-40"
                >
                  <Send className="w-4 h-4 transform rotate-180" />
                </button>
              </form>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
          اختر محادثة من القائمة لعرض الرسائل
        </div>
      )}
    </div>
  );
}