const style=document.createElement("style");
style.innerHTML=/*css*/`
@font-face {
	font-family: 'pixel_cyrnormal';
	src: url('unavo5pb-webfont.eot');
	src: url('unavo5pb-webfont.eot?#iefix') format('embedded-opentype'),
		url('unavo5pb-webfont.woff') format('woff'),
		url('unavo5pb-webfont.ttf') format('truetype'),
		url('unavo5pb-webfont.svg#pixel_cyrnormal') format('svg');
	font-weight: normal;
	font-style: normal;
}

#exporter{
	font-family: 'pixel_cyrnormal';
	position:fixed;
	top:0;
	left:0;
	right:0;
	bottom:0;
	display:-webkit-flex;
	justify-content:center;
	align-content:center;
	padding:32px;
	-webkit-box-sizing:border-box;
}
#exporter *{
	-webkit-box-sizing:border-box;
}
#exporter .content{
	position: relative;
	background:#111;
	text-align:center;
	padding:32px;
	border-radius:4px;
	min-width:480px;
}
#exporter .data{
	margin-top:32px;
	font-family:"Arial";
	background:#222;  
	overflow: auto;
	width:480px;
	text-align:left;
	border-radius:4px;
}
#exporter .data div{
	display:-webkit-flex;
	align-items:center;
	justify-content:space-between;
	padding:8px 12px;
	user-select: none;
}
#exporter .data div:hover{
	background:rgba(255,255,255,.025);
}
#exporter .data div span{
	text-overflow:ellipsis;
	white-space:nowrap;
	overflow: hidden;
	flex:1;
	font-size:14px;
}
#exporter a{
	display:block;
	font-size:18px;
	padding:16px 0;
	cursor: pointer;
}
#exporter a:hover{
	color:#bc4b4b;
}
#exporter label{
	display:block;
}
#exporter label input{
	display:none;
}
#exporter .start{
	position: absolute;
	bottom:0;
	left:0;
	right: 0;
}
`;
document.head.append(style);

const ach=localStorage.getItem("/sp_ach") || "";
const save=localStorage.getItem("/sp_save") || "";
const stats=localStorage.getItem("/sp_stats") || "";

const div=document.createElement("div");
div.id="exporter";
div.innerHTML=/*html*/`
	<div class="content">
		<a class="export">Export save</a><br>
		<label class="import">
			<input type="file">
			<a>Import save</a>
		</label>
		<div class="data"></div>
		<div class="status"></div>
		<a class="start">Done</a><br>
	</div>
`;
document.body.append(div);

export function install(){
	return new Promise(function(resolve){
		function reload(){
			const ach=localStorage.getItem("/sp_ach") || "";
			const save=localStorage.getItem("/sp_save") || "";
			const stats=localStorage.getItem("/sp_stats") || "";
			
			div.querySelector(".data").innerHTML=``;
			if(ach) div.querySelector(".data").innerHTML+=`<div><span>/sp_ach</span><span>${JSON.parse(ach).data}</span></div>`;
			if(save) div.querySelector(".data").innerHTML+=`<div><span>/sp_save</span><span>${JSON.parse(save).data}</span></div>`;
			if(stats) div.querySelector(".data").innerHTML+=`<div><span>/sp_stats</span><span>${JSON.parse(stats).data}</span></div>`;
		}
		reload();

		div.querySelector(".export").addEventListener("pointerdown",function(){
			const data={};
			if(ach) data["/sp_ach"]=JSON.parse(ach);
			if(save) data["/sp_save"]=JSON.parse(save);
			if(stats) data["/sp_stats"]=JSON.parse(stats);
			const blob=new Blob([JSON.stringify(data)]);
			const url=URL.createObjectURL(blob);
			const a=document.createElement("a");
			a.href=url;
			a.download="minidayz.json";
			a.click();
			URL.revokeObjectURL(url);
			div.querySelector(".status").innerHTML="Data successfully exported!";
			reload();
		});

		div.querySelector(".import input").addEventListener("change",function(event){
			const file=this.files[0];
			const reader=new FileReader();
			reader.addEventListener("load",function(event){
				let data={}
				try{
					data=JSON.parse(this.result);
				}catch(err){
					console.log(err);
					return;
				}
				if(data["/sp_ach"])localStorage.setItem("/sp_ach",JSON.stringify(data["/sp_ach"]));
				if(data["/sp_save"])localStorage.setItem("/sp_save",JSON.stringify(data["/sp_save"]));
				if(data["/sp_stats"])localStorage.setItem("/sp_stats",JSON.stringify(data["/sp_stats"]));
				div.querySelector(".status").innerHTML="Data successfully imported!";
				reload();
			});
			reader.readAsText(file);
		});

		div.querySelector(".start").addEventListener("pointerdown",function(){
			style.remove();
			div.remove();
			resolve();
		});
	});
}