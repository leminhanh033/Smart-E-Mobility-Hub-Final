const router = require('express').Router();
const Hub = require('../../models/hub.model');
const Vehicle = require('../../models/vehicle.model');
const Dispatch = require('../../models/dispatch.model');
const { transaction, fail, handle } = require('../../services/atomic');

router.get('/', (req, res) => res.render('pages/admin/dispatch', {
    title: 'Trang điều phối', activePage: 'dispatch'
}));

router.get('/data', async (req, res) => {
    try {
        const hubs = await Hub.find({status: 'active', turnOn: true}).lean();
        const vehicles = await Vehicle.find({hubID: {$in: hubs.map(h => String(h._id))}}).lean();
        const history = await Dispatch.find().sort({createdAt: -1})
            .populate('fromHub', 'name').populate('toHub', 'name').lean();
        res.json({code: 'success', data: {
            hubs: Object.fromEntries(hubs.map(h => [String(h._id), {
                name: h.name, capacity: h.parkingNumber, current: h.parkingUsed
            }])),
            vehiclesByHub: Object.fromEntries(hubs.map(h => [String(h._id), vehicles
                .filter(v => v.hubID === String(h._id))
                .map(v => ({id: String(v._id), code: v.vehicleCode, name: v.model,
                    pin: v.pin ?? null, status: v.status === 'active' ? 'Sẵn sàng' : 'Không sẵn sàng'}))])),
            history: history.map(h => ({code: String(h._id), from: h.fromHub?.name || '—',
                to: h.toHub?.name || '—', amount: h.vehicles.length,
                time: new Date(h.createdAt).toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'}), status: h.status}))
        }});
    } catch (e) { return handle(res, e); }
});

router.post('/create', async (req, res) => {
    try {
        const {fromId, toId, vehicleIds, priority} = req.body;
        if (!fromId || !toId || fromId === toId || !Array.isArray(vehicleIds) || !vehicleIds.length)
            fail('Chọn hai Hub khác nhau và ít nhất một xe.');

        const count = vehicleIds.length;
        const order = await transaction(async session => {
            const dest = await Hub.findOneAndUpdate({
                _id: toId, status: 'active', turnOn: true,
                $expr: {$gte: [{$subtract: ['$parkingNumber', '$parkingUsed']}, count]}
            }, {$inc: {parkingUsed: count}}, {session});
            if (!dest) fail('Hub đích không hoạt động hoặc không đủ chỗ.');

            const source = await Hub.findOneAndUpdate({
                _id: fromId, status: 'active', turnOn: true, parkingUsed: {$gte: count}
            }, {$inc: {parkingUsed: -count}}, {session});
            if (!source) fail('Hub nguồn không hoạt động hoặc số chỗ đang dùng không đủ để trừ.');

            const moved = await Vehicle.updateMany({
                _id: {$in: vehicleIds}, hubID: fromId, status: 'active'
            }, {$set: {hubID: toId}}, {session});
            if (moved.modifiedCount !== count) fail('Có xe không còn khả dụng hoặc bị chọn trùng.');

            const [record] = await Dispatch.create([{
                fromHub: fromId, toHub: toId, vehicles: vehicleIds,
                priority, status: 'done'
            }], {session});
            return record;
        });
        res.json({code: 'success', message: 'Điều phối thành công.', id: order._id});
    } catch (e) { return handle(res, e); }
});

module.exports = router;
