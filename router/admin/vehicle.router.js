const router=require("express").Router();
const moment=require("moment");

const hubmodel=require("../../models/hub.model");
const vehiclemodel=require("../../models/vehicle.model");

router.get("/list",async(req,res)=>{
  const hubList=await hubmodel.find({});
  const listVehicles=await vehiclemodel.find({}).sort({vehicleCode:1});
  const hubNames = new Map(hubList.map(h => [String(h._id), h.name]));
  for(const v of listVehicles){
    v.updatedAtFormat=moment(v.updatedAt).format("DD-MM-YYYY");
    
    v.hubName=hubNames.get(String(v.hubID)) || "Chưa xác định Hub";
  }
  res.render("pages/admin/vehicle-list",{
    title:"Trang quản lý xe",
    activePage:"vehicle",
    listVehicles,
    hubList,
  })
})

router.post("/create", async (req, res) => {
  if (req.body.batteryCapacity < 0) {
    res.json({
      code: "error",
      message: "Dung lượng pin không hợp lệ"
    });
    return;
  }

  const newVehicle = new vehiclemodel(req.body);
  await newVehicle.save();
  
  res.json({
    code: "success",
    message: "Tạo phương tiện mới thành công"
  });
});


router.patch("/edit/get", async (req, res) => {
  const vehicle = await vehiclemodel.findOne({
    _id: req.body.id,
  });
  
  res.json({
    code: "success",
    message: "Lấy thông tin phương tiện thành công",
    vehicle,
  });
});


router.post("/edit", async (req, res) => {
  if (req.body.batteryCapacity < 0) {
    res.json({
      code: "error",
      message: "Dung lượng pin không hợp lệ"
    });
    return;
  }

  await vehiclemodel.updateOne({
    _id: req.body.id,
  }, req.body);
  
  res.json({
    code: "success",
    message: "Chỉnh sửa phương tiện thành công",
  });
});

module.exports=router