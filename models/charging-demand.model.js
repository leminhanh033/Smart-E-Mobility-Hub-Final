const mongoose = require('mongoose');
const { Schema } = mongoose;

const chargingDemandSchema = new Schema(
  {
    userID: { type: Schema.Types.ObjectId, ref: 'user', required: true },
    vehicleOwnerID: { type: Schema.Types.ObjectId, ref: 'vehicleOwner', required: true },
    hubID: { type: Schema.Types.ObjectId, ref: 'hub', required: true },

    portID: { type: Schema.Types.ObjectId, ref: 'chargingPort', default: null },
    portCode: { type: String, default: null },
    portType: { type: String, enum: ['AC', 'DC'], default: 'AC' },

    desiredPin: { type: Number, min: 1, max: 100, default: 85 },
    startPin: { type: Number, min: 0, max: 100, default: 20 },
    duration: { type: Number, required: true },
    scheduledStart: { type: Date, required: true },

    startedAt: { type: Date, default: null },
    expectedEndAt: { type: Date, default: null },

    cost: { type: Number, min: 0, default: 0 },           // Tổng tiền thanh toán
    manualOrder: { type: Number, default: Number.MAX_SAFE_INTEGER },

    status: {
      type: String,
      enum: ['pending', 'charging', 'completed', 'cancelled'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('charging_demand', chargingDemandSchema, 'charging_demand');