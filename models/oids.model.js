const mongoose = require('mongoose')
const config = require('../config')
const Schema = mongoose.Schema

mongoose.connect(config.connectionString, { useNewUrlParser: true, useUnifiedTopology: true })

const oidSchema = new Schema({
    oid: String,
    valueoid: String,
    descr: String,
    manufacturer: String,
    color: String,
    size: String,
    model: Array
})

const oidModel = mongoose.model('oid', oidSchema, 'oids')

module.exports = oidModel