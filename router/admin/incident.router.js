const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ReportModel = require('../../models/report.model');
const HubModel = require('../../models/hub.model');
const UserModel = require('../../models/user.model');

const VehicleModel = require('../../models/vehicle.model');
const { errorList } = require('../../configs/variable.config');
const ERROR_TYPE_MAP = Object.fromEntries(errorList.map(error => [error.id, error.name]));

const isHexId = (val) => typeof val === "string" && /^[0-9a-fA-F]{24}$/.test(val.trim());

router.get("/manage", async (req, res) => {
  try {
    const reports = await ReportModel.find().sort({ createdAt: -1 }).lean();

    const hubIds = [...new Set(reports.map(r => (r.hub || "").trim()).filter(isHexId))];
    const userIds = [...new Set(reports.map(r => (r.createdBy || "").trim()).filter(isHexId))];

    const rawVehicles = [...new Set(reports.map(r => (r.vehicle || "").trim()).filter(Boolean))];
    const vehicleObjectIds = rawVehicles.filter(isHexId);
    const vehicleCodes = rawVehicles.filter(v => !isHexId(v));

    const [hubs, users, vehicles] = await Promise.all([
      hubIds.length ? HubModel.find({ _id: { $in: hubIds } }).lean() : [],
      userIds.length ? UserModel.find({ _id: { $in: userIds } }).lean() : [],
      (vehicleObjectIds.length || vehicleCodes.length)
        ? VehicleModel.find({
            $or: [
              ...(vehicleObjectIds.length ? [{ _id: { $in: vehicleObjectIds } }] : []),
              ...(vehicleCodes.length ? [{ vehicleCode: { $in: vehicleCodes } }] : [])
            ]
          }).lean()
        : []
    ]);

    const hubMap = new Map(hubs.map(h => [String(h._id), h]));
    const userMap = new Map(users.map(u => [String(u._id), u]));

    const vehicleMap = new Map();
    for (const v of vehicles) {
      vehicleMap.set(String(v._id), v);
      if (v.vehicleCode) vehicleMap.set(String(v.vehicleCode).trim(), v);
    }

    const enhancedReports = reports.map((report) => {
      const hubKey = (report.hub || "").trim();
      const userKey = (report.createdBy || "").trim();
      const vehicleKey = (report.vehicle || "").trim();

      const hub = hubKey ? hubMap.get(hubKey) : null;
      const user = userKey ? userMap.get(userKey) : null;
      const vehicle = vehicleKey ? vehicleMap.get(vehicleKey) : null;

      const hubName = hub ? (hub.name || hub.hubID || hubKey) : (hubKey || "Chưa rõ Hub");
      const creatorName = user ? (user.fullname || user.email || userKey) : (userKey || "Hệ thống");

      let vehicleLabel = "Sự cố trạm Hub";
      if (vehicleKey) {
        if (vehicle) {
          const vName = vehicle.model || vehicle.name || "Chưa cập nhật";
          const vCode = vehicle.vehicleCode || vehicle.code || vehicle.licensePlate || "";
          vehicleLabel = vCode ? `${vName} — ${vCode}` : vName;
        } else {
          vehicleLabel = `Xe (${vehicleKey})`;
        }
      }

      const priority = ["Urgent", "Medium", "Low"].includes(report.priority) ? report.priority : "Low";
      const status = ["Pending", "In Progress", "Resolved"].includes(report.status) ? report.status : "Pending";
      const typeLabel = ERROR_TYPE_MAP[report.type] || report.type;
      const ticketCode = `#ERR-${report._id.toString().slice(-4).toUpperCase()}`;

      const timeFormatted = report.createdAt
        ? new Date(report.createdAt).toLocaleString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
          })
        : "--";

      return {
        ...report,
        priority,
        status,
        hubName,
        creatorName,
        typeLabel,
        vehicleId: vehicle ? String(vehicle._id) : vehicleKey,
        vehicleLabel,
        ticketCode,
        timeFormatted,
      };
    });

    const openCount = enhancedReports.filter(r => ["Pending", "In Progress"].includes(r.status)).length;
    const resolvedCount = enhancedReports.filter(r => r.status === "Resolved").length;

    res.render("pages/admin/incident-manage", {
      title: "Quản lý Sự cố & Bảo trì",
      activePage: "incident",
      reports: enhancedReports,
      stats: {
        openCount,
        maintenanceCount: openCount,
        resolvedCount
      }
    });
  } catch (error) {
    console.error("[GET /incident/manage]", error);
    res.status(500).send("Lỗi Server: " + error.message);
  }
});

router.post('/update-status', async (req, res) => {
  try {
    const { id, status } = req.body;

    if (!id || !status) {
      return res.json({ code: "error", message: "Thiếu thông tin id hoặc status" });
    }

    const updated = await ReportModel.findByIdAndUpdate(
      id,
      { status: status },
      { returnDocument: "after" }
    );

    if (!updated) {
      return res.json({ code: "error", message: "Không tìm thấy sự cố" });
    }

    res.json({ code: "success", message: "Cập nhật trạng thái thành công" });
  } catch (error) {
    console.error('[POST /incident/update-status]', error);
    res.json({ code: "error", message: "Lỗi server" });
  }
});

router.patch("/resolve", async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) {
      return res.json({ code: "error", message: "Thiếu ID sự cố!" });
    }

    const incident = await ReportModel.findById(id);
    if (!incident) {
      return res.json({ code: "error", message: "Không tìm thấy sự cố!" });
    }

    if (incident.status !== "In Progress") {
      return res.json({
        code: "error",
        message: "Chỉ có thể đánh dấu hoàn thành khi sự cố đang ở trạng thái 'Đang xử lý'!",
      });
    }

    incident.status = "Resolved";
    incident.resolvedAt = new Date();
    await incident.save();

    return res.json({
      code: "success",
      message: `Đã xử lý xong sự cố!`,
    });
  } catch (err) {
    console.error("[incident/resolve]", err);
    return res.json({ code: "error", message: "Lỗi server!" });
  }
});

router.patch("/emergency-lock", async (req, res) => {
  try {
    const { incidentId, targetType, targetId } = req.body || {};
    const fail = (message, code = 400) =>
      res.status(code).json({ code: "error", message });

    if (!["vehicle", "hub", "charger"].includes(targetType)) {
      return fail("Loại đối tượng khóa chốt không hợp lệ.");
    }
    if (!targetId || !mongoose.isValidObjectId(targetId)) {
      return fail("ID đối tượng không hợp lệ.");
    }

    let updatedDoc = null;

    if (targetType === "vehicle") {
      updatedDoc = await VehicleModel.findByIdAndUpdate(
        targetId,
        { $set: { status: "maintenance" } },
        { new: true }
      );
      if (!updatedDoc) return fail("Không tìm thấy phương tiện.", 404);
    }

    if (targetType === "hub") {
      updatedDoc = await HubModel.findByIdAndUpdate(
        targetId,
        { $set: { status: "maintenance" } },
        { new: true }
      );
      if (!updatedDoc) return fail("Không tìm thấy trạm Hub.", 404);
    }

    if (targetType === "charger") {
      updatedDoc = await ChargerModel.findByIdAndUpdate(
        targetId,
        { $set: { status: "locked" } },
        { new: true }
      );
      if (!updatedDoc) return fail("Không tìm thấy cổng sạc.", 404);
    }

    if (incidentId && mongoose.isValidObjectId(incidentId)) {
      await ReportModel.findOneAndUpdate(
        { _id: incidentId, status: "Pending" },
        { $set: { status: "In Progress" } }
      );
    }

    return res.json({
      code: "success",
      message: "Đã cập nhật trạng thái khóa chốt khẩn cấp thành công.",
      data: { targetType, targetId, status: updatedDoc.status }
    });
  } catch (error) {
    console.error("[PATCH /incident/emergency-lock]", error);
    return fail("Lỗi máy chủ khi thực hiện khóa chốt khẩn cấp.", 500);
  }
});

module.exports = router