const router = require('express').Router();
const Hub = require('../../models/hub.model');
const Port = require('../../models/chargingPort.model');
const Booking = require('../../models/booking-charging.model');
const Demand = require('../../models/charging-demand.model');
const { validId, fail, handle } = require('../../services/atomic');
const { queueRows, allocate, setOrder, dispatchDemandQueue, tickSimulatedDemands } = require('../../services/charging-queue');
router.get('/schedule/smart', (req, res) => {
  res.render('pages/admin/charging-smart', {
    title: 'Trang lịch sạc thông minh',
    activePage: 'schedule',
  });
});

router.get('/schedule/hubs', async (req, res) => {
  const hubs = await Hub.find({ status: 'active', turnOn: true }).select('name').lean();
  res.json({ code: 'success', data: hubs });
});

router.get('/schedule/data/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!validId(id)) fail('Hub không hợp lệ.');

    const hub = await Hub.findOne({ _id: id, status: 'active', turnOn: true });
    if (!hub) fail('Hub không khả dụng.');

    // 1. Dọn demand hết giờ + nhả cổng
    await tickSimulatedDemands().catch((err) =>
      console.error('[schedule/data] tick:', err.message)
    );

    // 2. Gán cổng trống cho demand pending
    await dispatchDemandQueue(id).catch((err) =>
      console.error('[schedule/data] dispatch:', err.message)
    );

    // 3. Lấy data sau khi đã cập nhật
    const [bookingQueue, pendingDemands, ports, bookings, activeDemands] = await Promise.all([
      queueRows(id),
      Demand.find({ hubID: id, status: 'pending' })
        .sort({ manualOrder: 1, startPin: 1, createdAt: 1 })
        .populate('vehicleOwnerID')
        .lean(),
      Port.find({ hubID: id }).lean(),
      Booking.find({ hubID: id, status: { $in: ['active', 'charging'] }, portID: { $ne: null } }).lean(),
      Demand.find({ hubID: id, status: 'charging', portID: { $ne: null } })
        .populate('vehicleOwnerID')
        .lean(),
    ]);

    // Queue từ Booking
    const mappedBookings = bookingQueue.map((b) => ({
      id: String(b._id),
      source: 'booking',
      vehicle: b.vehicle?.model || 'Chưa xác định',
      license: b.vehicle?.license || '',
      requestType: b.requestType || 'schedule',
      duration: b.duration,
      pin: b.startPin ?? b.pin ?? b.vehicle?.pin ?? null,
      scheduledStart: b.scheduledStart || b.startTime,
      portType: b.portType || b.type || 'AC',
      manualOrder: b.manualOrder ?? Number.MAX_SAFE_INTEGER,
    }));

    // Queue từ Demand
    const mappedDemands = pendingDemands.map((d) => ({
      id: String(d._id),
      source: 'demand',
      vehicle: d.vehicleOwnerID?.model || d.vehicleOwnerID?.name || 'Xe đăng ký nhu cầu',
      license: d.vehicleOwnerID?.license || '',
      requestType: 'demand',
      duration: d.duration,
      pin: d.startPin ?? d.vehicleOwnerID?.pin ?? null,
      scheduledStart: d.scheduledStart || d.createdAt,
      portType: d.portType || 'AC',
      manualOrder: d.manualOrder ?? Number.MAX_SAFE_INTEGER,
    }));

    const mergedQueue = [...mappedBookings, ...mappedDemands].sort((a, b) => {
      if (a.manualOrder !== b.manualOrder) return a.manualOrder - b.manualOrder;
      const pinA = a.pin ?? 999;
      const pinB = b.pin ?? 999;
      if (pinA !== pinB) return pinA - pinB;
      return new Date(a.scheduledStart) - new Date(b.scheduledStart);
    });

    // Ports + thông tin xe đang sạc
    const mappedPorts = ports.map((p) => {
      const portIdStr = String(p._id);
      const activeBooking = bookings.find((b) => String(b.portID) === portIdStr);
      const activeDemand = activeDemands.find((d) => String(d.portID) === portIdStr);

      let active = null;
      if (activeDemand) {
        active = {
          source: 'demand',
          requestType: 'demand',
          status: 'charging',
          vehicle: activeDemand.vehicleOwnerID?.model || activeDemand.vehicleOwnerID?.name || 'Xe đăng ký nhu cầu',
          license: activeDemand.vehicleOwnerID?.license || '',
          pin: activeDemand.vehicleOwnerID?.pin ?? activeDemand.startPin ?? null,
          duration: activeDemand.duration,
          startedAt: activeDemand.startedAt,
          expectedEndAt: activeDemand.expectedEndAt,
        };
      } else if (activeBooking) {
        active = {
          source: 'booking',
          requestType: activeBooking.requestType || 'schedule',
          status: activeBooking.status,
          vehicle: activeBooking.vehicle?.model || 'Chưa xác định',
          license: activeBooking.vehicle?.license || '',
          pin: activeBooking.startPin ?? activeBooking.vehicle?.pin ?? null,
          duration: activeBooking.duration,
          startedAt: activeBooking.startTime,
          expectedEndAt: activeBooking.endTime,
        };
      }

      return {
        id: portIdStr,
        code: p.portCode,
        type: p.type || 'AC',
        status: p.status,
        booking: active?.status || null,
        requestType: active?.requestType || null,
        active,
      };
    });

    res.json({
      code: 'success',
      data: { queue: mergedQueue, ports: mappedPorts, genericRequests: 0 },
    });
  } catch (e) {
    return handle(res, e);
  }
});
router.post('/schedule/order', async (req, res) => {
  try {
    const { hubId, ids, automatic } = req.body;
    if (!validId(hubId) || (!automatic && (!Array.isArray(ids) || ids.some((id) => !validId(id))))) {
      fail('Dữ liệu thứ tự không hợp lệ.');
    }

    if (automatic) {
      await Promise.all([
        Booking.updateMany(
          { hubID: hubId, status: 'active', portID: null },
          { $unset: { queueOrder: 1 } }
        ),
        Demand.updateMany(
          { hubID: hubId, status: 'pending' },
          { $set: { manualOrder: Number.MAX_SAFE_INTEGER } }
        ),
      ]);
    } else {
      const ops = [];
      ids.forEach((itemId, idx) => {
        ops.push(
          Booking.updateOne(
            { _id: itemId, hubID: hubId, status: 'active', portID: null },
            { $set: { queueOrder: idx + 1 } }
          ),
          Demand.updateOne(
            { _id: itemId, hubID: hubId, status: 'pending' },
            { $set: { manualOrder: idx + 1 } }
          )
        );
      });
      await Promise.all(ops);
    }
    // Log kiểm tra
    const afterDemands = await Demand.find({ hubID: hubId, status: 'pending' })
      .select('_id manualOrder startPin').lean();
    const afterBookings = await Booking.find({ hubID: hubId, status: 'active', portID: null })
      .select('_id manualOrder').lean();

    const allocated = await allocate(hubId);
    const assignedDemands = await dispatchDemandQueue(hubId);
    const totalAllocated = (allocated || 0) + (assignedDemands?.length || 0);

    res.json({
      code: 'success',
      message: `Đã lưu thứ tự`,
      allocated: totalAllocated,
      pendingBookings: await Booking.countDocuments({ hubID: hubId, status: 'active', portID: null }),
      pendingDemands: await Demand.countDocuments({ hubID: hubId, status: 'pending' }),
      freePorts: await Port.countDocuments({ hubID: hubId, status: 'active', vehicleUsed: null }),
    });
  } catch (e) {
    return handle(res, e);
  }
});

module.exports = router;