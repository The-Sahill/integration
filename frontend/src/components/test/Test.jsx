import React, { useState } from 'react';
import axios from 'axios';

const Test = () => {
  const [loading, setLoading] = useState(false);
  const [responseMessage, setResponseMessage] = useState('');

  const handleDirectBooking = async () => {
    setLoading(true);
    setResponseMessage('جاري إرسال طلب الحجز التجريبي...');

    try {
      // ⚠️ استبدل الرابط برابط سيرفرك الحقيقي على Render أو اتركه إذا كنت تختبر محلياً
      const response = await axios.post('http://localhost:4000/api/test-direct-booking');

      if (response.data.success) {
        setResponseMessage(`✅ نجح الحجز! رقم الحجز: ${response.data.data?.id || 'مؤكد'}`);
      } else {
        setResponseMessage(`❌ فشل الحجز: ${JSON.stringify(response.data.error)}`);
      }
    } catch (error) {
      console.error(error);
      setResponseMessage(`❌ خطأ في الاتصال: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '30px', textAlign: 'center', fontFamily: 'Arial, sans-serif' }}>
      <h2>اختبار اتصال Zaaer API</h2>
      
      <button 
        onClick={handleDirectBooking} 
        disabled={loading}
        style={{
          padding: '12px 24px',
          fontSize: '16px',
          backgroundColor: loading ? '#6c757d' : '#28a745',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: loading ? 'not-allowed' : 'pointer',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}
      >
        {loading ? 'جاري إرسال الحجز...' : 'حجز غرفة تجريبية الآن'}
      </button>

      {responseMessage && (
        <pre style={{ 
          marginTop: '25px', 
          background: '#f8f9fa', 
          padding: '15px', 
          borderRadius: '5px',
          textAlign: 'left', 
          direction: 'ltr',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          border: '1px solid #dee2e6'
        }}>
          {responseMessage}
        </pre>
      )}
    </div>
  );
};

export default Test;