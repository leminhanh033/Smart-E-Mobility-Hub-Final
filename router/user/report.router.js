const router = require('express').Router();
const mongoose = require('mongoose');
const hubmodel = require('../../models/hub.model');
const vehiclemodel = require('../../models/vehicle.model');
const reportmodel = require('../../models/report.model');
const { errorList } = require('../../configs/variable.config');

router.get('/issue', async (req, res) => {
  const [hubList, vehicles] = await Promise.all([
    hubmodel.find({}).sort({ name: 1 }).lean(),
    vehiclemodel.find({}).sort({ vehicleCode: 1 }).lean()
  ]);
  res.render('pages/user/report-issue', {
    title: 'Trang báo cáo sự cố', activePage: 'report', hubList, vehicles, errorList
  });
});

const VALID_PRIORITIES = ['Urgent', 'Medium', 'Low'];

router.post('/issue', async (req, res) => {
  try {
    const { type, hub, vehicle, description, priority, image } = req.body || {};
    const fail = message => res.status(400).json({ code: 'error', message });

    if (!errorList.some(error => error.id === type)) {
      return fail('Loại sự cố không hợp lệ.');
    }
    if (!mongoose.isValidObjectId(hub) || !await hubmodel.exists({ _id: hub })) {
      return fail('Hub không hợp lệ.');
    }
    if (vehicle && (!mongoose.isValidObjectId(vehicle) || !await vehiclemodel.exists({ _id: vehicle, hubID: String(hub) }))) {
      return fail('Phương tiện không thuộc Hub đã chọn. Vui lòng chọn lại.');
    }
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return fail('Mức độ ưu tiên không hợp lệ.');
    }
    if (description != null && (typeof description !== 'string' || description.length > 2000)) {
      return fail('Mô tả không hợp lệ (tối đa 2000 ký tự).');
    }

    await reportmodel.create({
      type,
      hub: String(hub),
      vehicle: vehicle ? String(vehicle) : '',
      description: (description || '').trim(),
      image: typeof image === 'string' ? image.trim() : '',
      priority: priority || 'Low',
      status: 'Pending',
      createdBy: String(req.account._id)
    });

    return res.json({ code: 'success', message: 'Tạo báo cáo sự cố thành công' });
  } catch (error) {
    console.error('[POST /report/issue]', error);
    return res.status(500).json({ code: 'error', message: 'Không thể gửi báo cáo sự cố.' });
  }
});
module.exports = router;
