// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const webhookRoute = require('./routes/webhookRoute');

const app = express();

app.use(bodyParser.json());

// ربط المسار
app.use('/webhook', webhookRoute);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});