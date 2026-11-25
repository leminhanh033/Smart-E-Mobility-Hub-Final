const router = require('express').Router();
const hubmodel = require("../../models/hub.model")
const bookingmodel = require("../../models/booking.model");
const parkingBookingModel = require("../../models/booking-parking.model")
const chargingBookingModel = require("../../models/booking-charging.model")
const vehiclemodel = require("../../models/vehicle.model");
const vehicleOwnermodel = require("../../models/vehicleOwner.model");
const moment = require("moment")
const chargingPortmodel = require("../../models/chargingPort.model");
const chargingDemandModel=require("../../models/charging-demand.model");
const Demand = require('../../models/charging-demand.model'); 

const RATE_PER_MINUTE = 500;
const PARKING_HOLD_MS = 60 * 60 * 1000; // 60 phút
const CHARGING_RATE_AC = 500;
const CHARGING_RATE_DC = 800;

router.get('/active', async (req, res) => {
  try {
    const userId = req.account ? req.account._id : "6501abc123456789012345";

    // 1. Lấy danh sách Thuê xe (Đang active)
    const rentals = await bookingmodel.find({ userID: userId, status: 'active' })
      .populate("vehicleID")    // Lấy tên xe, biển số
      .populate("startHubID")   // Lấy tên Hub bắt đầu
      .populate("endHubID")     // Lấy tên Hub kết thúc
      .lean();

    // 2. Lấy danh sách Đặt chỗ đỗ (Lấy cả active và completed)
    let parkings = await parkingBookingModel.find({
      userID: userId,
      $or: [
        { status: 'active' },                 // đang giữ chỗ (chưa checkin)
        { status: 'completed', endTime: null } // đang đỗ (đã checkin, chưa checkout)
      ]
    })
      .populate("hubID")
      .lean();

    const validParkings = [];
    for (let i = 0; i < parkings.length; i++) {
      let item = parkings[i];

      if (item.status === 'active' && item.startTime) {
        const startTime = new Date(item.startTime).getTime();
        const now = new Date().getTime();

        if (now - startTime > 60 * 60 * 1000) {
          await parkingBookingModel.findByIdAndUpdate(item._id, { status: 'cancelled' });
          continue; // Không đưa vào danh sách hiển thị
        }
      }
      validParkings.push(item);
    }

    // 3. Lấy danh sách Đăng ký sạc (Đang active / charging)
    const chargings = await chargingBookingModel.find({ userID: userId, status: { $in: ['active', 'charging'] } })
      .populate("hubID")        // Lấy tên Hub
      .populate("vehicleOwnerID")
      .lean();

    // 4. Lấy danh sách Đăng ký nhu cầu sạc (Đang pending / charging)
    const demands = await chargingDemandModel.find({ userID: userId, status: { $in: ['pending', 'charging'] } })
      .populate("hubID")
      .populate("vehicleOwnerID")
      .lean();

    let allActivities = [];

    rentals.forEach(item => {
      if (item.vehicleID) {
        // Random pin 20 - 70%
        item.vehicleID.pin = Math.floor(Math.random() * 51) + 20;
      }
      allActivities.push({ ...item, type: 'rental' });
    });

    validParkings.forEach(item => {
      allActivities.push({ ...item, type: 'parking' });
    });

    chargings.forEach(item => {
      if (!item.hubID) {
        item.hubID = { name: "Hub không xác định" };
      }
      allActivities.push({ ...item, type: 'charging' });
    });

    demands.forEach(item => {
      if (!item.hubID) {
        item.hubID = { name: "Hub không xác định" };
      }
      allActivities.push({ ...item, type: 'demand' });
    });

    allActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.render("pages/user/activity-active", {
      title: "Hoạt động của tôi",
      activePage: "activity",
      activities: allActivities
    });

  } catch (error) {
    console.error("Lỗi lấy hoạt động:", error);
    res.status(500).send("Lỗi Server");
  }
});


router.get('/history', async (req, res) => {
  try {
    const userId = req.account ? req.account._id : "6501abc123456789";

    const queryStatus = { $ne: 'active' };

    const rentals = await bookingmodel.find({ userID: userId, status: queryStatus })
      .populate("vehicleID")
      .populate("startHubID")
      .populate("endHubID")
      .lean();

    const parkings = await parkingBookingModel.find({
      userID: userId,
      $or: [
        { status: 'cancelled' },
        { status: 'completed', endTime: { $ne: null } }
      ]
    })
      .populate("hubID")
      .lean();

    const chargings = await chargingBookingModel.find({ userID: userId, status: queryStatus })
      .populate("hubID")
      .lean();

    // Lấy demand đã completed / cancelled
    const demands = await Demand.find({
      userID: userId,
      status: { $in: ['completed', 'cancelled'] },
    })
      .populate("hubID")
      .populate("vehicleOwnerID")
      .lean();

    // Gộp mảng 
    let historyList = [];
    rentals.forEach(item => historyList.push({ ...item, type: 'rental' }));
    parkings.forEach(item => historyList.push({ ...item, type: 'parking' }));
    chargings.forEach(item => historyList.push({ ...item, type: 'charging' }));
    demands.forEach(item => historyList.push({ ...item, type: 'demand' })); // 👈

    // Sắp xếp mới nhất lên đầu
    historyList.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    // Format dữ liệu
    historyList = historyList.map(item => {
      // Với demand: dùng startedAt / expectedEndAt thay vì startTime / endTime
      const startTime = item.startTime || item.startedAt || item.scheduledStart || null;
      const endTime = item.endTime || item.expectedEndAt || null;

      const start = startTime ? moment(startTime) : null;
      const end = endTime ? moment(endTime) : null;

      item.dateStr = start ? start.format("DD/MM/YYYY") : "---";

      if (start && end) {
        item.timeStr = `${start.format("HH:mm")} - ${end.format("HH:mm")}`;
        item.durationStr = `${Math.ceil(moment.duration(end.diff(start)).asMinutes())} phút`;
      } else if (start && item.duration) {
        item.timeStr = start.format("HH:mm");
        item.durationStr = `${Math.ceil(Number(item.duration))} phút`;
      } else {
        item.timeStr = start ? start.format("HH:mm") : "---";
        item.durationStr = "---";
      }

      item.costStr = (item.cost || 0).toLocaleString('vi-VN') + " VNĐ";

      return item;
    });

    res.render('pages/user/activity-history', {
      title: "Trang Lịch sử hoạt động",
      activePage: "activity",
      historyList,
    });
  } catch (error) {
    console.error("Lỗi lấy lịch sử:", error);
    res.status(500).send("Lỗi Server");
  }
});

// =========================================================
// POST /cancel — hủy chung cho rental / parking / charging
// =========================================================
router.post('/cancel', async (req, res) => {
  try {
    const { id, type } = req.body;
    const userId = req.account ? req.account._id : "6501abc123456789012345";

    if (!id) {
      return res.json({ code: "error", message: "Thiếu ID cần hủy!" });
    }

    // ---------- Rental ----------
    if (type === 'rental') {
      const booking = await bookingmodel.findOne({ _id: id, userID: userId });

      if (!booking) return res.json({ code: "error", message: "Không tìm thấy lịch sử thuê!" });
      if (booking.status === 'cancelled') return res.json({ code: "error", message: "Đơn đã bị hủy trước đó." });

      if (booking.startTime) {
        return res.json({ code: "error", message: "Bạn đã nhận xe rồi, không thể hủy lúc này! Hãy trả xe." });
      }

      booking.status = 'cancelled';
      await booking.save();

      await vehiclemodel.findByIdAndUpdate(booking.vehicleID, { status: 'active' });

      return res.json({ code: "success", message: "Hủy đăng ký thuê xe thành công!" });
    }

    // ---------- Parking ----------
    if (type === 'parking') {
      const parking = await parkingBookingModel.findOne({ _id: id, userID: userId });
      if (!parking) return res.json({ code: "error", message: "Không tìm thấy lịch sử đặt chỗ!" });
      if (parking.status !== 'active') return res.json({ code: "error", message: "Đơn không ở trạng thái giữ chỗ." });
      if (parking.startTime) {
        return res.json({ code: "error", message: "Xe đã được gửi vào chỗ. Hãy lấy xe ra thay vì hủy." });
      }

      parking.status = 'cancelled';
      await parking.save();

      await hubmodel.findOneAndUpdate(
        { _id: parking.hubID, parkingUsed: { $gt: 0 } },
        { $inc: { parkingUsed: -1 } }
      );

      return res.json({ code: "success", message: "Hủy đặt chỗ thành công!" });
    }

    // ---------- Charging ----------
    if (type === 'charging') {
      const { finish } = require('../../services/charging-queue');
      try { await finish(id, req.account._id, 'cancel'); return res.json({ code: 'success', message: 'Đã hủy lịch sạc.' }); } catch (e) { return require('../../services/atomic').handle(res, e); }
    }

    // ---------- Demand (Đăng ký nhu cầu sạc) ----------
    if (type === 'demand') {
      const demand = await chargingDemandModel.findOne({ _id: id, userID: userId });
      if (!demand) {
        return res.json({ code: 'error', message: 'Không tìm thấy đăng ký nhu cầu sạc!' });
      }
      if (!['pending', 'charging'].includes(demand.status)) {
        return res.json({ code: 'error', message: 'Nhu cầu sạc không thể hủy ở trạng thái hiện tại.' });
      }

      const wasCharging = demand.status === 'charging' && demand.portID;
      const portId = demand.portID;
      const portType = demand.portType;
      const hubId = demand.hubID;
      const vehicleOwnerId = demand.vehicleOwnerID;

      demand.status = 'cancelled';
      demand.portID = null;
      demand.portCode = null;
      await demand.save();

      if (wasCharging && portId) {
        await chargingPortModel.findOneAndUpdate(
          { _id: portId, vehicleUsed: String(vehicleOwnerId) },
          { $set: { status: 'active', vehicleUsed: null } }
        );

        const field = portType === 'DC' ? 'DCUsed' : 'ACUsed';
        await hubmodel.findOneAndUpdate(
          { _id: hubId, [field]: { $gt: 0 } },
          { $inc: { [field]: -1 } }
        );
      }

      if (vehicleOwnerId) {
        await vehicleOwnermodel.findByIdAndUpdate(vehicleOwnerId, { status: 'active' });
      }

      return res.json({ code: 'success', message: 'Đã hủy đăng ký nhu cầu sạc!' });
    }

    return res.json({ code: "error", message: "Loại đăng ký không hợp lệ!" });

  } catch (error) {
    console.error("Lỗi hủy:", error);
    res.status(500).json({ code: "error", message: "Lỗi Server!" });
  }
});
// =========================================================
// POST /receive — NHẬN XE (rental)
// =========================================================
router.post("/receive", async (req, res) => {
  try {
    const { id, type } = req.body;
    const userId = req.account ? req.account._id : "6501abc123456789012345";

    if (type !== "rental") {
      return res.json({ code: "error", message: "Loại đơn không hợp lệ." });
    }

    const booking = await bookingmodel.findOne({ _id: id, userID: userId });
    if (!booking) {
      return res.json({ code: "error", message: "Không tìm thấy đơn." });
    }
    if (booking.status === "cancelled") {
      return res.json({ code: "error", message: "Đơn đã bị hủy." });
    }
    if (booking.startTime) {
      return res.json({ code: "error", message: "Xe đã được nhận trước đó." });
    }
    if (booking.holdTime && new Date(booking.holdTime) < new Date()) {
      return res.json({ code: "error", message: "Đã hết thời gian giữ chỗ." });
    }

    booking.startTime = new Date();
    booking.status = "active";
    await booking.save();

    await vehiclemodel.findByIdAndUpdate(booking.vehicleID, { status: "used" });

    return res.json({
      code: "success",
      message: "Đã nhận xe. Bắt đầu tính giờ.",
      startTime: booking.startTime,
    });
  } catch (err) {
    console.error(err);
    return res.json({ code: "error", message: "Lỗi máy chủ." });
  }
});

// =========================================================
// POST /return — TRẢ XE (rental)
// =========================================================
router.post("/return", async (req, res) => {
  try {
    const { id, type, endHubID } = req.body;
    const userId = req.account ? req.account._id : "6501abc123456789012345";

    if (type !== "rental") {
      return res.json({ code: "error", message: "Loại đơn không hợp lệ." });
    }

    const booking = await bookingmodel.findOne({ _id: id, userID: userId });
    if (!booking) return res.json({ code: "error", message: "Không tìm thấy đơn." });
    if (!booking.startTime) return res.json({ code: "error", message: "Xe chưa được nhận." });
    if (booking.endTime) return res.json({ code: "error", message: "Xe đã được trả trước đó." });

    const finalEndHubID = endHubID || booking.endHubID || booking.startHubID;
    if (!finalEndHubID) {
      return res.json({ code: "error", message: "Không xác định được Hub trả xe." });
    }

    const endHub = await hubmodel.findById(finalEndHubID);
    if (!endHub) return res.json({ code: "error", message: "Hub trả xe không tồn tại." });

    const endTime = new Date();
    const minutes = Math.max(1, Math.ceil((endTime - booking.startTime) / 60000));
    const cost = minutes * RATE_PER_MINUTE;

    booking.endTime = endTime;
    booking.cost = cost;
    booking.status = "completed";
    booking.endHubID = finalEndHubID;
    await booking.save();

    await vehiclemodel.findByIdAndUpdate(booking.vehicleID, {
      status: "active",
      hubID: String(finalEndHubID),
    });

    return res.json({
      code: "success",
      message: `Đã trả xe tại ${endHub.name} (${minutes} phút).`,
      cost: cost,
      minutes: minutes,
    });
  } catch (err) {
    console.error(err);
    return res.json({ code: "error", message: "Lỗi máy chủ." });
  }
});

// =========================================================
// POST /park/checkin — GỬI XE
// =========================================================
router.post("/park/checkin", async (req, res) => {
  try {
    const { id, type } = req.body;
    const userId = req.account ? req.account._id : "6501abc123456789012345";

    if (type !== "parking") {
      return res.json({ code: "error", message: "Loại đơn không hợp lệ." });
    }

    const booking = await parkingBookingModel.findOne({ _id: id, userID: userId });
    if (!booking) return res.json({ code: "error", message: "Không tìm thấy đơn." });
    if (booking.status !== "active") {
      return res.json({ code: "error", message: "Đơn không ở trạng thái giữ chỗ." });
    }
    if (booking.startTime) {
      return res.json({ code: "error", message: "Xe đã được gửi trước đó." });
    }

    // Hết hạn giữ chỗ dựa vào bookedAt
    const holdDeadline = new Date(
      new Date(booking.bookedAt).getTime() + PARKING_HOLD_MS
    );
    if (new Date() > holdDeadline) {
      booking.status = "cancelled";
      await booking.save();

      await hubmodel.findOneAndUpdate(
        { _id: booking.hubID, parkingUsed: { $gt: 0 } },
        { $inc: { parkingUsed: -1 } }
      );

      return res.json({
        code: "error",
        message: "Đã hết thời gian giữ chỗ, đơn bị hủy.",
      });
    }

    // Không cần check available nữa — vì chỗ đã được giữ từ lúc đặt
    const hub = await hubmodel.findById(booking.hubID);
    if (!hub) {
      return res.json({ code: "error", message: "Không tìm thấy Hub." });
    }

    booking.startTime = new Date();
    booking.status = "completed"; // completed = đang gửi xe
    await booking.save();


    return res.json({
      code: "success",
      message: "Đã gửi xe vào vị trí " + booking.slotCode + ".",
    });
  } catch (err) {
    console.error(err);
    return res.json({ code: "error", message: "Lỗi máy chủ." });
  }
});

// =========================================================
// POST /park/checkout — LẤY XE RA
// =========================================================
router.post("/park/checkout", async (req, res) => {
  try {
    const { id, type } = req.body;
    const userId = req.account ? req.account._id : "6501abc123456789012345";

    if (type !== "parking") {
      return res.json({ code: "error", message: "Loại đơn không hợp lệ." });
    }

    const booking = await parkingBookingModel.findOne({ _id: id, userID: userId });
    if (!booking) {
      return res.json({ code: "error", message: "Không tìm thấy đơn." });
    }
    if (!booking.startTime) {
      return res.json({ code: "error", message: "Xe chưa được gửi vào chỗ." });
    }
    if (booking.endTime) {
      return res.json({ code: "error", message: "Xe đã được lấy ra trước đó." });
    }

    booking.endTime = new Date();
    booking.status = "completed";
    await booking.save();

    await hubmodel.updateOne(
      { _id: booking.hubID, parkingUsed: { $gt: 0 } },
      { $inc: { parkingUsed: -1 } }
    );

    return res.json({
      code: "success",
      message: "Đã lấy xe ra khỏi chỗ đỗ.",
    });
  } catch (err) {
    console.error(err);
    return res.json({ code: "error", message: "Lỗi máy chủ." });
  }
})



// =========================================================
// POST /activity/charging/stop — DỪNG SẠC
// =========================================================
router.post('/charging/stop', async (req, res) => { try { const result = await require('../../services/charging-queue').finish(req.body.id, req.account._id, 'stop'); return res.json({ code: 'success', message: 'Đã kết thúc sạc.', ...result }); } catch (e) { return require('../../services/atomic').handle(res, e); } });
router.post('/charging/start', async (req, res) => { try { const data = await require('../../services/charging-queue').start(req.body.id, req.account._id); return res.json({ code: 'success', message: 'Đã bắt đầu sạc.', data }); } catch (e) { return require('../../services/atomic').handle(res, e); } });

module.exports = router