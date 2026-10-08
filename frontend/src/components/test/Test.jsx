import React, { useState, useEffect } from 'react';
import axios from 'axios';

const Reservations = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchReservations = async () => {
      try {
        const response = await axios.get('https://sahl-suites.zaaer.com/api/v1/reservations', {
          params: {
            page: 1,
            limit: 50,
          },
          headers: {
            'Authorization': 'Bearer 1|bykZSg9iLODV6jITNRHx1rCAhEoYMpEYOHbfKKGRd522b0ea',
            'Accept': 'application/json',
          },
        });

        console.log(response.data);
        setData(response.data);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err.response?.data?.message || err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchReservations();
  }, []);

  if (loading) return <div>جاري التحميل...</div>;
  if (error) return <div>حدث خطأ: {error}</div>;

  return (
    <div>
      <h2>قائمة الحجوزات</h2>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
};

export default Reservations;