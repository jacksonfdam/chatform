const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

const responderSchema = new mongoose.Schema({
  formId: {type: ObjectId, index:true},
  appUserId: {type: String, index:true},
  currentFieldId: String,
  complete: Boolean,
  response: {}
}, { timestamps: true });

const Responder = mongoose.model('Responder', responderSchema);
module.exports = Responder;
