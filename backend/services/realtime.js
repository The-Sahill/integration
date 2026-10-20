// services/realtime.js — بث التحديثات الحية للوحة التحكم عبر Socket.io
let io = null;

function setIo(instance) {
  io = instance;
}

function emit(event, payload) {
  if (io) io.emit(event, payload);
}

module.exports = { setIo, emit };
