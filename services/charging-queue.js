const Hub = require('../models/hub.model');
const Owner = require('../models/vehicleOwner.model');
const Port = require('../models/chargingPort.model');
const Booking = require('../models/booking-charging.model');
const Demand = require('../models/charging-demand.model');

const { transaction, fail } = require('./atomic');
const nowTime = v => v ? new Date(v).getTime() : Number.MAX_SAFE_INTEGER;
const pinValue = v => typeof v === 'number' && Number.isFinite(v) ? v : 101;
function sortQueue(rows) {
  return [...rows].sort((a, b) => {
    const manualA = a.queueOrder ?? Number.MAX_SAFE_INTEGER, manualB = b.queueOrder ?? Number.MAX_SAFE_INTEGER;
    return manualA - manualB || pinValue(a.vehicle?.pin) - pinValue(b.vehicle?.pin) || nowTime(a.vehicle?.nextUseAt) - nowTime(b.vehicle?.nextUseAt) || nowTime(a.createdAt) - nowTime(b.createdAt) || String(a._id).localeCompare(String(b._id));
  });
}
async function queueRows(hubId, session) {
  const query = Booking.find({ hubID: hubId, status: 'active', portID: null }).lean(); if (session) query.session(session); const rows = await query;
  const q = Owner.find({ _id: { $in: rows.map(r => r.vehicleOwnerID) } }).lean(); if (session) q.session(session); const owners = await q;
  const map = new Map(owners.map(v => [String(v._id), v])); return sortQueue(rows.map(r => ({ ...r, vehicle: map.get(String(r.vehicleOwnerID)) })));
}
async function reservePort(booking, session) {
  const port = await Port.findOneAndUpdate({ hubID: String(booking.hubID), type: booking.portType, status: 'active' }, { $set: { status: 'charging', vehicleUsed: String(booking.vehicleOwnerID) } }, { session, returnDocument: 'after', sort: { _id: 1 } });
  if (!port) return null;
  const field = booking.portType === 'AC' ? 'ACUsed' : 'DCUsed';
  const max = booking.portType === 'AC' ? 'ACNumber' : 'DCNumber';
  const hub = await Hub.findOneAndUpdate({ _id: booking.hubID, status: 'active', turnOn: true, $expr: { $lt: ['$' + field, '$' + max] } }, { $inc: { [field]: 1 } }, { session }); if (!hub) fail('Hub không hoạt động.');
  return port;
}
async function allocate(hubId) {
  return transaction(async session => {
    const hub = await Hub.findOne({ _id: hubId, status: 'active', turnOn: true }).session(session); if (!hub) return 0;
    // Write the hub document to serialize allocation and manual queue changes.
    await Hub.updateOne({ _id: hubId }, { $inc: { chargingQueueVersion: 1 } }, { session });
    const rows = await queueRows(hubId, session); let count = 0;
    for (const booking of rows) {
      if (!booking.vehicle || booking.vehicle.status === 'charging') continue;
      if (nowTime(booking.scheduledStart || booking.startTime) > Date.now()) continue;
      const port = await reservePort(booking, session); if (!port) continue;
      const updated = await Booking.updateOne({ _id: booking._id, status: 'active', portID: null }, { $set: { portID: port._id, portCode: port.portCode, reservationFee: 0 } }, { session }); if (updated.modifiedCount !== 1) fail('Hàng chờ đã thay đổi.'); count++;
    } return count;
  });
}
async function setOrder(hubId, ids, automatic = false) {
  return transaction(async session => {
    const hub = await Hub.findOneAndUpdate({ _id: hubId, status: 'active', turnOn: true }, { $inc: { chargingQueueVersion: 1 } }, { session }); if (!hub) fail('Hub không khả dụng.');
    const rows = await queueRows(hubId, session); const current = new Set(rows.map(b => String(b._id)));
    if (!automatic && (ids.length !== current.size || new Set(ids).size !== ids.length || ids.some(id => !current.has(id)))) fail('Hàng chờ đã thay đổi. Cập nhật dữ liệu rồi thử lại.');
    if (automatic) await Booking.updateMany({ hubID: hubId, status: 'active', portID: null }, { $unset: { queueOrder: 1 } }, { session });
    else for (let i = 0; i < ids.length; i++)await Booking.updateOne({ _id: ids[i], status: 'active', portID: null }, { $set: { queueOrder: i } }, { session });
  });
}
async function finish(id, userId, mode = 'stop') {
  return transaction(async (session) => {
    const query = {
      _id: id,
      status: mode === 'cancel' ? 'active' : 'charging',
      ...(userId ? { userID: userId } : {}),
    };

    const booking = await Booking.findOne(query).session(session);
    if (!booking) fail('Lịch sạc không ở trạng thái cho phép hoặc không thuộc tài khoản.');

    const now = new Date();
    const startTime = booking.startTime ? new Date(booking.startTime) : now;

    // 1. Thời gian & phí sạc (1 phút x 500đ), hủy lịch thì bằng 0
    const chargingMinutes =
      mode === 'cancel'
        ? 0
        : Math.max(0, Math.min(booking.duration, Math.ceil((now - startTime) / 60000)));
    const chargingCost = chargingMinutes * 500;

    // 2. Thời gian & phí giữ cổng (1 phút x 200đ): từ lúc tạo lịch đến lúc bắt đầu sạc
    const holdEnd = mode === 'cancel' ? now : startTime;
    const holdStart = booking.createdAt ? new Date(booking.createdAt) : holdEnd;
    const holdMinutes = Math.max(0, Math.ceil((holdEnd - holdStart) / 60000));
    const holdCost = holdMinutes * 200;

    // Cập nhật trạng thái & thời gian booking
    booking.status = mode === 'cancel' ? 'cancelled' : 'completed';
    booking.endTime =
      mode === 'cancel'
        ? undefined
        : mode === 'expire'
          ? new Date(startTime.getTime() + booking.duration * 60000)
          : now;

    booking.reservationFee = holdCost;
    booking.cost = chargingCost + holdCost;

    await booking.save({ session });

    // Giải phóng cổng & cập nhật bộ đếm trên Hub
    if (booking.portID) {
      const port = await Port.findOneAndUpdate(
        { _id: booking.portID, vehicleUsed: String(booking.vehicleOwnerID) },
        { $set: { status: 'active', vehicleUsed: null } },
        { session }
      );
      if (!port) fail('Trạng thái cổng sạc không nhất quán.');

      if (!['active', 'charging'].includes(port.status)) {
        await Port.updateOne({ _id: port._id }, { $set: { status: port.status } }, { session });
      }

      const field = booking.portType === 'AC' ? 'ACUsed' : 'DCUsed';
      const hub = await Hub.findOneAndUpdate(
        { _id: booking.hubID, [field]: { $gt: 0 } },
        { $inc: { [field]: -1 } },
        { session }
      );
      if (!hub) fail('Bộ đếm cổng sạc không nhất quán.');
    }

    if (mode !== 'cancel') {
      await Owner.updateOne({ _id: booking.vehicleOwnerID }, { $set: { status: 'active' } }, { session });
    }

    return {
      cost: booking.cost,
      chargingCost,
      holdCost,
      minutes: chargingMinutes,
      holdMinutes,
      hubId: String(booking.hubID),
    };
  });
}
async function start(id, userId) {
  return transaction(async (session) => {
    const b = await Booking.findOne({
      _id: id,
      userID: userId,
      status: 'active',
      portID: { $ne: null },
    }).session(session);

    if (!b) fail('Lịch sạc không thuộc tài khoản hoặc chưa được cấp cổng.');

    const port = await Port.findOne({
      _id: b.portID,
      status: 'charging',
      vehicleUsed: String(b.vehicleOwnerID),
    }).session(session);

    if (!port) fail('Cổng sạc không còn khả dụng.');

    const owner = await Owner.findOneAndUpdate(
      { _id: b.vehicleOwnerID, userID: String(userId), status: { $ne: 'charging' } },
      { $set: { status: 'charging' } },
      { session }
    );

    if (!owner) fail('Xe không khả dụng.');

    const now = new Date();
    b.status = 'charging';
    b.startTime = now;

    if (b.duration) {
      b.endTime = new Date(now.getTime() + b.duration * 60000);
    }

    await b.save({ session });
    return b;
  });
}
let running = false;
async function tick() {
  if (running) return; running = true; try {
    const active = await Booking.find({ status: 'charging' }).select('startTime duration').lean();
    for (const b of active) { if (b.startTime && Date.now() >= new Date(b.startTime).getTime() + b.duration * 60000) { try { await finish(String(b._id), null, 'expire'); } catch (e) { console.error('Kết thúc sạc:', e.message); } } }
    const hubs = await Hub.find({ status: 'active', turnOn: true }).select('_id').lean(); for (const h of hubs) { try { await allocate(String(h._id)); } catch (e) { console.error('Phân bổ sạc:', e.message); } }
  } finally { running = false; }
}

const SIMULATE_SECONDS_PER_MINUTE = 2;
const PRICE_PER_MINUTE = 500; // 1 phút x 500đ

const CHARGE_RATE = {
  AC: 1.5,   
  DC: 4,     
};

function calcChargeMinutes(startPin, desiredPin, portType) {
  const from = Math.max(0, Math.min(100, Number(startPin) || 0));
  const to = Math.max(from, Math.min(100, Number(desiredPin) || 100));
  const rate = CHARGE_RATE[portType] || CHARGE_RATE.AC;
  const minutes = (to - from) / rate;
  return Math.max(1, Math.ceil(minutes));
}
/**
 * Tự động gắn cổng trống cho hàng chờ demand (ưu tiên pin thấp nhất trước).
 */
async function dispatchDemandQueue(hubId, externalSession = null) {
  const run = async (session) => {
    const now = new Date();

    const pendingList = await Demand.find({
      hubID: hubId,
      status: 'pending',
      scheduledStart: { $lte: now },
    })
      .sort({ manualOrder: 1, startPin: 1, scheduledStart: 1, createdAt: 1 })
      .session(session);

    if (!pendingList.length) return [];

    const assigned = [];

    for (const demand of pendingList) {
      const port = await Port.findOneAndUpdate(
        {
          hubID: hubId,
          type: demand.portType,
          status: 'active',
          vehicleUsed: null,
        },
        {
          $set: {
            status: 'charging',
            vehicleUsed: String(demand.vehicleOwnerID),
          },
        },
        { session, returnDocument: 'after' }
      );

      if (!port) continue;

      const field = demand.portType === 'AC' ? 'ACUsed' : 'DCUsed';
      await Hub.updateOne({ _id: hubId }, { $inc: { [field]: 1 } }, { session });

      await Owner.updateOne(
        { _id: demand.vehicleOwnerID },
        { $set: { status: 'charging' } },
        { session }
      );

      const startTime = new Date();
      demand.portID = port._id;
      demand.portCode = port.portCode;
      demand.status = 'charging';
      demand.startedAt = startTime;

      const owner = await Owner.findById(demand.vehicleOwnerID).session(session).lean();

      const startPin = demand.startPin ?? owner?.pin ?? 20;   // pin lúc bắt đầu
      const actualMinutes = calcChargeMinutes(startPin, demand.desiredPin, demand.portType);

      demand.actualDuration = actualMinutes;
      demand.expectedEndAt = new Date(
        startTime.getTime() + actualMinutes * SIMULATE_SECONDS_PER_MINUTE * 1000
      );
      await demand.save({ session });

      assigned.push(demand);
    }

    return assigned;
  };

  return externalSession ? run(externalSession) : transaction(run);
}

/**
 * Kiểm tra các phiên đang sạc đã hết thời gian giả lập -> hoàn tất, tính tiền, nhả cổng & gọi xe tiếp theo.
 */
async function tickSimulatedDemands() {
  const now = new Date();
  const finishedDemands = await Demand.find({
    status: 'charging',
    expectedEndAt: { $lte: now },
  }).lean();

  if (!finishedDemands.length) return;

  const affectedHubs = new Set();

  for (const item of finishedDemands) {
    try {
      await transaction(async (session) => {
        const demand = await Demand.findOne({
          _id: item._id,
          status: 'charging',
        }).session(session);
        if (!demand) return;

        const actualMinutes = demand.actualDuration || demand.duration;
        demand.cost = actualMinutes * PRICE_PER_MINUTE;
        demand.status = 'completed';
        await demand.save({ session });

        await Owner.updateOne(
          { _id: demand.vehicleOwnerID },
          {
            $set: {
              pin: demand.desiredPin,
              status: 'active',
            },
          },
          { session }
        );

        if (demand.portID) {
          await Port.updateOne(
            { _id: demand.portID, vehicleUsed: String(demand.vehicleOwnerID) },
            { $set: { status: 'active', vehicleUsed: null } },
            { session }
          );

          const field = demand.portType === 'AC' ? 'ACUsed' : 'DCUsed';
          await Hub.updateOne(
            { _id: demand.hubID, [field]: { $gt: 0 } },
            { $inc: { [field]: -1 } },
            { session }
          );
        }

        affectedHubs.add(String(demand.hubID));
      });
    } catch (err) {
      console.error('[tickSimulatedDemands] Lỗi hoàn tất phiên sạc:', err.message);
    }
  }

  for (const hubId of affectedHubs) {
    await dispatchDemandQueue(hubId).catch((err) =>
      console.error('[dispatchDemandQueue] Lỗi cấp cổng kế tiếp:', err.message)
    );
  }
}

function startDemandSimulator() {
  setInterval(() => {
    tickSimulatedDemands().catch((err) =>
      console.error('[startDemandSimulator]', err.message)
    );
  }, 2000);
}


module.exports = {
  sortQueue, queueRows, reservePort, allocate, setOrder, finish, start, tick,
  dispatchDemandQueue, tickSimulatedDemands, startDemandSimulator,
};
