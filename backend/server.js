const express = require('express')
const app = express()
require('dotenv').config()
const cors = require('cors')
const mongoose = require('mongoose')
const cookieParser = require('cookie-parser')
app.use(express.json())

app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials:true,
}
))

app.use(cookieParser())

mongoose.connect(process.env.MongoDB_URL).then(() => {
app.listen(process.env.PORT,()=> {
    console.log("Server is Ready to Take Off on Port:"+ process.env.PORT);
    
})
})