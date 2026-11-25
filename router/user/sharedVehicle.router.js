const router = require('express').Router();
const hubmodel=require("../../models/hub.model");
const vehiclemodel=require("../../models/vehicle.model");
const bookingmodel=require("../../models/booking.model")

router.get('/book', async (req, res) => {
  const hubList = await hubmodel.find({
    turnOn: true,
  })
  let listVehicle=[];
  if(req.query.fromID && hubList.some(hub => String(hub._id) === req.query.fromID)){
    listVehicle=await vehiclemodel.find({
      hubID:req.query.fromID,
      status:"active",
    })
  }
  // Pin lấy từ DB, không sinh số ngẫu nhiên khi tải trang.
  res.render('pages/user/book-shared-vehicle', {
    title: "Trang đặt xe",
    activePage: "find-vehicle",
    hubList,
    listVehicles:listVehicle,
  })
})

router.get('/book/confirm', (req, res) => {
  // Màn xác nhận mẫu cũ không thuộc luồng đặt xe đang sử dụng.
  const query = new URLSearchParams();
  for (const key of ['fromID', 'toID']) {
    if (typeof req.query[key] === 'string') query.set(key, req.query[key]);
  }
  res.redirect('/shared-vehicle/book' + (query.size ? '?' + query.toString() : ''));
})

router.get('/return/confirm', (req, res) => {
  res.redirect('/activity/active');
})

router.get('/detail', async(req, res) => {
  const id=req.query.vehicleID;
  let vehicle={};
  if(id){
    vehicle=await vehiclemodel.findOne({
      _id:id,
    })
  }
  if (!vehicle || !vehicle._id) return res.redirect('/shared-vehicle/book');
  const hub=await hubmodel.findOne({ _id:vehicle.hubID });
  vehicle.estimatedRange = Number.isFinite(vehicle.pin) ? Math.round(vehicle.pin * 0.5) : null;
  vehicle.distanceToUser = "Chưa có dữ liệu";

  res.render('pages/user/shared-vehicle-detail', {
    title: "Trang chi tiết xe",
    activePage: "find-vehicle",
    hub,
    vehicle
  })
})

router.post("/booking/create", async (req, res) => {
  try {
    const { vehicleId } = req.body;

    const vehicle = await vehiclemodel.findById(vehicleId);
    if (!vehicle) {
      return res.json({ code: "error", message: "Không tìm thấy xe!" });
    }
    if (vehicle.status !== 'active') {
      return res.json({ code: "error", message: "Xe này hiện đã có người đặt hoặc đang bảo trì!" });
    }
    if(!req.body.endHubID){
      return res.json({
        code:"error",
        message:"Vui lòng chọn hub đi đến",
      })
    }

    vehicle.status = "used"; 
    await vehicle.save();

    const newBooking = new bookingmodel({
      vehicleID: vehicleId,
      userID: req.account ? req.account._id : "6501...",
      status: "active",
      startHubID:vehicle.hubID,
      endHubID:req.body.endHubID,
    });
    await newBooking.save();

    return res.json({
      code: "success",
      message: "Đặt xe thành công! Vui lòng đến nhận xe.",
      bookingId: newBooking._id
    });

  } catch (error) {
    console.error("Lỗi khi đặt xe:", error);
    return res.json({ code: "error", message: "Lỗi hệ thống!" });
  }
});


module.exports = router;