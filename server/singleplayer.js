import { router } from "./routers.js";
import express from "express";
import fs from "fs";

router.sp.use(express.static("game/singleplayer"));

router.sp.get("/api/auth",function(req,res,next){
	res.send({login_request:"accesskey",client_id:"clientid"});
});

router.sp.get("/sp_ach",function(req,res,next){
	const result=JSON.parse(fs.readFileSync("./db/ach.json"));
	res.json(result);
});

router.sp.get("/sp_save",function(req,res,next){
	const result=JSON.parse(fs.readFileSync("./db/save.json"));
	res.json(result);
});

router.sp.get("/sp_stats",function(req,res,next){
	const result=JSON.parse(fs.readFileSync("./db/stats.json"));
	res.json(result);
});

// Saving methods
// Saving achievments
router.sp.post("/sp_ach",function(req,res,next){
	fs.writeFileSync("./db/ach.json",JSON.stringify(req.body));
	res.json({saved_game_url:"1",send_achieves:"1"});
});

router.sp.post("/sp_save",function(req,res,next){
	fs.writeFileSync("./db/save.json",JSON.stringify(req.body));
	res.json({saved_game_url:"1",send_pos:"1"});
});

// Saving stats
router.sp.post("/sp_stats",function(req,res,next){
	fs.writeFileSync("./db/stats.json",JSON.stringify(req.body));
	res.json({saved_game_url:"1",send_stats:"1"});
});

// Removing methods
router.sp.delete("/sp_save",function(req,res,next){
	console.log(req.body,req.query);
});

router.sp.delete("/sp_stats",function(req,res,next){
	console.log(req.body,req.query);
});