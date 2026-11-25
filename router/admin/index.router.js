const router=require("express").Router();

const accountRouter=require("./account.router");
const hubRouter=require("./hub.router");
const incidentRouter=require("./incident.router");
const simulationRouter=require("./simulation.router");
const dispatchRouter=require("./dispatch.router")
const chargingRouter=require("./charging.router")
const dashboardRouter=require("./dashboard.router");
const vehicleRouter=require("./vehicle.router");
const chargingPortROuter=require("./chargingPort.router");

const Admin = require('../../models/admin.model');

const requireAdmin = require('../../services/auth').middleware(Admin,'admin');

router.use("/account",accountRouter);

router.use("/",requireAdmin,dashboardRouter);

router.use("/hub",requireAdmin,hubRouter);

router.use("/incident",requireAdmin,incidentRouter);

router.use("/simulation",requireAdmin,simulationRouter);

router.use("/dispatch",requireAdmin,dispatchRouter);

router.use("/charging",requireAdmin,chargingRouter);

router.use("/vehicle",requireAdmin,vehicleRouter);

router.use("/charging/port",requireAdmin,chargingPortROuter)

module.exports=router;