const router = require('express').Router();
const hubmodel = require("../../models/hub.model");
const parkingBookingModel = require("../../models/booking-parking.model")
const vehicleOwnermodel = require("../../models/vehicleOwner.model");
const chargingBookingModel = require("../../models/booking-charging.model")
const chargingPortmodel = require("../../models/chargingPort.model");
const chargingDemandModel = require("../../models/charging-demand.model");
router.get('/parking', async (req, res) => {
  const desID = req.query.destinationId;
  const filter = {
    status: "active",
  };
  const hubList = await hubmodel.find(filter)
  res.render('pages/user/book-parking', {
    title: "Trang đặt chỗ đỗ",
    activePage: "book",
    hubList,
    desID,
  })
})

router.post('/parking/create', async (req, res) => {
  try {
    const { hubId } = req.body;

    // Giả lập user ID (nếu chưa có session đăng nhập)
    const userId = req.account ? req.account._id : "6501abc123456789";

    if (!hubId) {
      return res.json({ code: "error", message: "Vui lòng chọn Hub!" });
    }

    // 1. Tìm Hub để kiểm tra chỗ trống
    const hub = await hubmodel.findById(hubId);
    if (!hub) {
      return res.json({ code: "error", message: "Không tìm thấy Hub này!" });
    }

    const availableSlots = (hub.parkingNumber || 0) - (hub.parkingUsed || 0);
    if (availableSlots <= 0) {
      return res.json({ code: "error", message: "Hub này đã hết chỗ đỗ!" });
    }

    // 2. Cập nhật số chỗ đã dùng (tăng lên 1)
    hub.parkingUsed = (hub.parkingUsed || 0) + 1;
    await hub.save();

    // 4. Tạo bản ghi lịch sử đặt chỗ
    const newBooking = new parkingBookingModel({
      userID: userId,
      hubID: hub._id,
      slotCode: req.body.slotCode,
      status: 'active'
    });
    await newBooking.save();

    // 5. Trả về thành công
    return res.json({
      code: "success",
      message: "Đặt chỗ đỗ thành công!",
      bookingId: newBooking._id
    });

  } catch (error) {
    console.error("Lỗi đặt chỗ:", error);
    return res.json({ code: "error", message: "Lỗi hệ thống, vui lòng thử lại!" });
  }
});

router.get('/charging/schedule', async (req, res) => {
  const userId = req.account ? req.account._id : "6501abc123456789"; // Lấy ID user

  const listVehicles = await vehicleOwnermodel.find({ userID: userId }).lean();
  // Lấy danh sách Hub
  const hubList = await hubmodel.find({ status: "active" }).lean();
  res.render('pages/user/schedule-charging', {
    title: "Trang đặt lịch sạc",
    activePage: "book",
    hubList,
    listVehicles,
  })
})

router.post('/vehicle/owner/create', async (req, res) => {
  try {
    const { license, type, model, batteryCapacity } = req.body;
    const userId = req.account ? req.account._id : "6501abc123456789";
    if (!license || !type || !model || !batteryCapacity) {
      return res.json({
        code: "error",
        message: "Vui lòng nhập đầu đủ thông tin"
      })
    }

    const newOwner = new vehicleOwnermodel({
      userID: userId,
      license,
      type,
      model,
      batteryCapacity: parseFloat(batteryCapacity),
    });
    await newOwner.save();

    return res.json({ code: "success", message: "Thêm phương tiện thành công!" });
  } catch (error) {
    console.error("Lỗi thêm xe:", error);
    return res.json({ code: "error", message: "Lỗi hệ thống, vui lòng thử lại!" });
  }
})

router.get('/charging/demand', async (req, res) => {
  const hubList = await hubmodel.find({ status: 'active', turnOn: true }).lean();
  const listVehicles = await vehicleOwnermodel.find({ userID: String(req.account._id) }).lean();
  //Thời gian chọn trong vòng 1 ngày 
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const pad = (n) => String(n).padStart(2, '0');
  const toLocal = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  res.render('pages/user/charging-demand', {
    title: 'Trang đăng ký nhu cầu sạc', activePage: 'book', hubList, listVehicles,
    minDateTime: toLocal(now),
    maxDateTime: toLocal(tomorrow),
  });
});

const CHARGING_RATE_AC = 500;   // đ/phút
const CHARGING_RATE_DC = 800;   // đ/phút

// =========================================================
// POST /book/charging/create — đặt lịch sạc có giờ hẹn
// =========================================================
router.post('/charging/create', async (req, res) => {
  const { transaction, validId, integer, fail, handle } = require('../../services/atomic');
  const { reservePort } = require('../../services/charging-queue');

  try {
    const {
      vehicleOwnerID,
      hubId,
      desiredPin,
      duration,
      portType,
      scheduledStart: raw,
      date,
      time,
    } = req.body;

    if (!validId(vehicleOwnerID) || !validId(hubId) || !['AC', 'DC'].includes(portType)) {
      fail('Xe, Hub hoặc loại cổng không hợp lệ.');
    }

    const minutes = integer(duration, 1, 120);
    const target = integer(desiredPin, 1, 100);
    if (![45, 60, 120].includes(minutes)) {
      fail('Thời lượng không hợp lệ.');
    }

    const scheduledStart = new Date(raw || `${date}T${time}:00`);
    if (!Number.isFinite(scheduledStart.getTime()) || scheduledStart <= new Date()) {
      fail('Giờ đặt lịch phải ở tương lai.');
    }

    const result = await transaction(async (session) => {
      const vehicle = await vehicleOwnermodel.findOneAndUpdate(
        { _id: vehicleOwnerID, userID: String(req.account._id), status: { $ne: 'charging' } },
        { $inc: { bookingVersion: 1 } },
        { session, returnDocument: 'after' }
      );
      if (!vehicle) fail('Xe không khả dụng hoặc không thuộc tài khoản.');

      const hub = await hubmodel.findOne({ _id: hubId, status: 'active', turnOn: true }).session(session);
      if (!hub) fail('Hub không hoạt động.');

      const hasActiveBooking = await chargingBookingModel
        .exists({ vehicleOwnerID, status: { $in: ['active', 'charging'] } })
        .session(session);
      if (hasActiveBooking) fail('Xe đã có lịch sạc chưa hoàn thành.');

      const seed = {
        userID: req.account._id,
        vehicleOwnerID,
        hubID: hubId,
        portType,
        desiredPin: target,
        startPin: vehicle.pin,
        scheduledStart,
        startTime: scheduledStart,
        duration: minutes,
        status: 'active',
      };

      // Giữ nguyên chính sách đặt trước nếu cổng trống; ngược lại đẩy vào hàng chờ thực tế
      const queued = await chargingBookingModel
        .exists({
          hubID: hubId,
          portType,
          status: 'active',
          portID: null,
          scheduledStart: { $lte: new Date() },
        })
        .session(session);

      const port = queued ? null : await reservePort(seed, session);
      const minutesUntilStart = Math.max(0, Math.ceil((scheduledStart - Date.now()) / 60000));
      const reservationFee = port ? minutesUntilStart * 200 : 0;

      const [booking] = await chargingBookingModel.create(
        [
          {
            ...seed,
            portID: port ? port._id : null,
            portCode: port ? port.portCode : undefined,
            reservationFee,
          },
        ],
        { session }
      );

      return { booking, port, reservationFee, minutesUntilStart };
    });

    const { booking, port, reservationFee, minutesUntilStart } = result;
    const message = port
      ? `Đã đặt cổng ${port.portCode}. Phí giữ cổng: ${reservationFee}đ.`
      : 'Đã vào hàng chờ sạc; chưa cấp cổng, chưa tính phí giữ cổng.';

    return res.json({
      code: 'success',
      message,
      bookingId: booking._id,
      portId: port ? port._id : null,
      portCode: port ? port.portCode : null,
      reservationFee,
      minutesUntilStart,
    });
  } catch (e) {
    return handle(res, e);
  }
});

// =========================================================
// POST /book/charging/demand — đăng ký nhu cầu sạc
// =========================================================
router.post('/charging/demand', async (req, res) => {
  const { transaction, validId, integer, fail, handle } = require('../../services/atomic');

  try {
    const {
      hubId,
      vehicleOwnerID,
      portType,
      desiredPin,
      startPin: rawStartPin,
      duration,
      scheduledStart: raw,
    } = req.body;
    if (!validId(hubId) || !validId(vehicleOwnerID) || !['AC', 'DC'].includes(portType)) {
      fail('Xe, Hub hoặc loại cổng không hợp lệ.');
    }

    const minutes = integer(duration, 1, 120);
    const target = integer(desiredPin, 1, 100);
    if (![45, 60, 120].includes(minutes)) {
      fail('Thời lượng không hợp lệ.');
    }

    const hasCustomStartPin = rawStartPin !== undefined && rawStartPin !== null && rawStartPin !== '';
    const parsedStartPin = hasCustomStartPin ? integer(rawStartPin, 0, 100) : undefined;

    const now = new Date();
    if (raw != null && raw !== '' && typeof raw !== 'string') {
      fail('Thời gian không hợp lệ.');
    }

    const scheduledStart = raw ? new Date(raw) : now;
    if (!Number.isFinite(scheduledStart.getTime()) || (raw && scheduledStart < now)) {
      fail('Thời gian sạc sớm nhất phải ở tương lai, hoặc để trống để chờ ngay.');
    }

    const demand = await transaction(async (session) => {
      // Khóa ghi trên xe để tránh tạo trùng đồng thời
      const vehicle = await vehicleOwnermodel.findOneAndUpdate(
        { _id: vehicleOwnerID, userID: String(req.account._id), status: { $ne: 'charging' } },
        { $inc: { bookingVersion: 1 } },
        { session, returnDocument: 'after' }
      );
      if (!vehicle) fail('Xe không khả dụng hoặc không thuộc tài khoản.');

      const startPin = parsedStartPin !== undefined ? parsedStartPin : vehicle.pin;

      // Tăng phiên bản hàng chờ của Hub
      const hub = await hubmodel.findOneAndUpdate(
        { _id: hubId, status: 'active', turnOn: true },
        { $inc: { chargingQueueVersion: 1 } },
        { session, returnDocument: 'after' }
      );
      if (!hub) fail('Hub không hoạt động.');

      // Kiểm tra xe đã có lịch sạc hoặc đăng ký nhu cầu sạc đang mở chưa
      const hasActiveBooking = await chargingBookingModel
        .exists({ vehicleOwnerID, status: { $in: ['active', 'charging'] } })
        .session(session);
      if (hasActiveBooking) {
        fail('Xe đã có lịch sạc chưa hoàn thành.');
      }

      const hasPendingDemand = await chargingDemandModel
        .exists({ vehicleOwnerID, status: 'pending' })
        .session(session);
      if (hasPendingDemand) {
        fail('Xe đang có một đăng ký nhu cầu sạc chờ xử lý.');
      }

      const [created] = await chargingDemandModel.create(
        [
          {
            userID: req.account._id,
            vehicleOwnerID,
            hubID: hubId,
            portType,
            desiredPin: target,
            startPin,
            duration: minutes,
            scheduledStart,
            status: 'pending',
          },
        ],
        { session }
      );

      return created;
    });

    return res.json({
      code: 'success',
      message: 'Đã đăng ký nhu cầu sạc thành công.',
      demandId: demand._id,
    });
  } catch (err) {
    return handle(res, err);
  }
});

module.exports = router;