import { router } from "./routers.js";
import express from "express";
import fs from "fs";

router.api.get("/auth",function(req,res,next){
	res.send({login_request:"accesskey",client_id:"clientid"});
});

router.mp.get("/",function(req,res,next){
	const {access_token}=req.query;
	if(access_token){
		return res.json({have_game:["SPROCKET2DAYZMINI001","SPROCKET2DAYZMINI001"]});
	}
	next();
});

router.mp.use(express.static("game/multiplayer"));



router.mp.get("/default-char",function(req,res,next){
	const result=JSON.parse(fs.readFileSync("./db/default-char.json"));
	res.json({get_char:result.data});
});

router.mp.post("/default-char",function(req,res,next){
	fs.writeFileSync("./db/default-char.json",JSON.stringify(req.body));
	res.json(req.body);
});

router.mp.get("/sp_ach",function(req,res,next){
	const result=JSON.parse(fs.readFileSync("./db/ach.json"));
	res.json(result);
});

router.mp.get("/sp_save",function(req,res,next){
	const result=JSON.parse(fs.readFileSync("./db/save.json"));
	res.json(result);
});

router.mp.get("/sp_stats",function(req,res,next){
	const result=JSON.parse(fs.readFileSync("./db/stats.json"));
	res.json(result);
});

// Saving methods
// Saving achievments
router.mp.post("/sp_ach",function(req,res,next){
	fs.writeFileSync("./db/ach.json",JSON.stringify(req.body));
	res.json({saved_game_url:"1",send_achieves:"1"});
});

router.mp.post("/sp_save",function(req,res,next){
	fs.writeFileSync("./db/save.json",JSON.stringify(req.body));
	res.json({saved_game_url:"1",send_pos:"1"});
});

// Saving stats
router.mp.post("/sp_stats",function(req,res,next){
	fs.writeFileSync("./db/stats.json",JSON.stringify(req.body));
	res.json({saved_game_url:"1",send_stats:"1"});
});

// Removing methods
router.mp.delete("/sp_save",function(req,res,next){
	console.log(req.body,req.query);
});

router.mp.delete("/sp_stats",function(req,res,next){
	console.log(req.body,req.query);
});

// TODO: Websocket server list:
//{"message":"list-rooms","game":"Bohemia Interactive - MINIDAYZ v3","instance":"minidayz","which":"all"}
//{"message":"room-list","list":[]}