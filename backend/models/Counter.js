// models/Counter.js — أرقام متسلسلة (أرقام التذاكر)
const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number },
});

counterSchema.statics.next = async function next(name) {
  const doc = await this.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
