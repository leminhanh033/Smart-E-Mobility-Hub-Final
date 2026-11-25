const mongoose = require('mongoose');
const { Schema } = mongoose;

const report = new Schema({
  type: String,
  hub: String,
  vehicle: String,
  description: String,
  image: String,
  createdBy: String,
  priority: {
    type: String,
    enum: ['Urgent', 'Medium', 'Low'],
    default: 'Low'
  },

  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Resolved'],
    default: 'Pending'
  }
}, {
  timestamps: true,
});

const reportmodel = mongoose.model('report', report, "report");
module.exports = reportmodel;