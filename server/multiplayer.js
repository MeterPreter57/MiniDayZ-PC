import { router } from "./routers.js";
import express from "express";
import fs from "fs";
import { socket } from "./app.js";
import { WebSocket } from "ws";

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


const rooms=[
	{
		name:"server_1",
		peercount:1,
		maxpeercount:12,
		state:"available", // | locked | full,
		data:["|2,server_1","2,Chernarus; Polygon","2,Survival","2,0","2,1.4.1|"].join("|"),
	}
];
socket.on("connection",function(client){
	console.log("client connected",client.protocol);

	client.send(JSON.stringify({"message":"welcome","protocolrev":1,"version":"1.6","name":"Construct Multiplayer Signalling Server","operator":"Scirra Ltd","motd":"Welcome to the unofficial Construct Multiplayer Signalling server!","clientid":"C7VX","ice_servers":["stun:locahost",{"urls":"turn:localhost","username":"scirra","credential":"construct"}]}));
	client.sendData=function(type,object){
		const result={
			message:type,
		}
		for(const key in object){
			result[key]=object[key];
		}
		client.send(JSON.stringify(result));
	}
	client.on("message",function(data,isBinary){
		try{
			data=JSON.parse(data);
		}catch(err){
			console.log(err);
			return;
		}
		console.log(data);
		client.emit(data.message,data);
	});

	client.on("list-rooms",function(){
		client.sendData("room-list",{
			list:rooms
		});
	});

	client.on("close",function(code,reason){
		console.log(code,reason);
	})
})