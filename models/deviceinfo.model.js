const mongoose = require('mongoose')
const config = require('../config')
const Schema = mongoose.Schema

mongoose.connect(config.connectionString, { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false })

const deviceInfoSchema = new Schema({
    ipAddress: String,
    date: Date,
    info: [{
        oid: String,
        label: String,
        value: String
    }]
})

const deviceInfoModel = mongoose.model('deviceInfo', deviceInfoSchema, 'deviceinfo')

module.exports = deviceInfoModel