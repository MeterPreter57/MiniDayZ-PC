import express from "express";
import multer from "multer";
import fs, { stat } from "fs";

const app=express();

const upload=multer({dest:"./temp"});
app.use(express.json({limit:"100mb"}));
app.use(express.urlencoded({extended:true}));
app.use(upload.any());
app.get("/",function(req,res,next){
	const {access_token}=req.query;
	if(access_token){
		return res.json({have_game:["SPROCKET2DAYZMINI001"]});
	}
	next();
});

app.get("/*",express.static("./minidayz_1.4.1"));

app.get("/api/auth",function(req,res,next){
	const body=new URLSearchParams({access_token:1,client_id:1,key:1});
	res.send({login_request:"accesskey",client_id:"clientid"});
});

app.get("/sp_ach",function(req,res,next){
	console.log(req.body,req.query);
	next();
});

app.get("/sp_save",function(req,res,next){
	const save=JSON.parse(fs.readFileSync("./save.json"));
	res.json(save);
});

app.get("/sp_stats",function(req,res,next){
	const stats=JSON.parse(fs.readFileSync("./stats.json"));
	res.json(stats);
});

let save=null;
let stats=null;
app.post("/sp_save",function(req,res,next){
	save=req.body;
	console.log("SAVE",save);
	fs.writeFileSync("./save.json",JSON.stringify(req.body));
	res.json({saved_game_url:"1",send_pos:"1"});
});
app.post("/sp_stats",function(req,res,next){
	stats=req.body;
	console.log("STATS",stats);
	fs.writeFileSync("./stats.json",JSON.stringify(req.body));
	res.json({saved_game_url:"1",send_stats:"1"});
});

app.listen(80,function(){
	console.log("Server on port 80");
})
