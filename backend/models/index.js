// models/index.js — تجميع كل النماذج
module.exports = {
  Conversation: require('./Conversation'),
  Message: require('./Message'),
  ProcessedEvent: require('./ProcessedEvent'),
  Staff: require('./Staff'),
  User: require('./User'),
  Booking: require('./Booking'),
  Payment: require('./Payment'),
  PricingRule: require('./PricingRule'),
  Negotiation: require('./Negotiation'),
  PendingAction: require('./PendingAction'),
  Ticket: require('./Ticket'),
  InventoryItem: require('./InventoryItem'),
  ServiceOrder: require('./ServiceOrder'),
  AuditLog: require('./AuditLog'),
  Setting: require('./Setting'),
  Counter: require('./Counter'),
};
