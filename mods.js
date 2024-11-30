import "./mods/toolkit.js";
const {mods}=await (await fetch("../mods.json")).json();

let install=localStorage.getItem("mods") || `["server-simulator"]`;
install=JSON.parse(install);

const link=document.createElement("link");
link.rel="shortcut icon";
link.href="./icon-256.png";
document.head.append(link);

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

#mods{
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
#mods *{
	-webkit-box-sizing:border-box;
}
#mods .content{
	position: relative;
	background:#111;
	text-align:center;
	padding:32px;
	border-radius:4px;
}
#mods .list{
	margin-top:32px;
	font-family:"Arial";
	background:#222;  
	overflow: auto;
	max-height: calc(100% - 82px);
	width:480px;
	text-align:left;
	border-radius:4px;
}
#mods .list label{
	display:-webkit-flex;
	align-items:center;
	justify-content:space-between;
	padding:8px 12px;
	cursor: pointer;
	user-select: none;
}
#mods .list label:hover{
	background:rgba(255,255,255,.025);
}
#mods .list label div{
	width:90%;
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: hidden;
}
#mods .list .version{
	font-size:10px;
	color:#aaa;
}
#mods .list .description{
	font-size:10px;
	color:#aaa;
	display:block;
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: hidden;
}
#mods .list label input{
	display: none;
}
#mods .list mark{
	display:inline-block;
	background:#333;
	width:28px;
	height: 20px;
	border-radius:4px;
	position: relative;
	-webkit-transition:.3s;
}
#mods .list mark::after{
	content:"";
	display:inline-block;
	position: absolute;
	top:2px;
	left:2px;
	height: 16px;
	width: 16px;
	-webkit-transition:.3s;
	-webkit-transform:translateX(0px);
	background:#aaa;
	border-radius:4px;
}
#mods .list label input:checked + mark{
	background:#266326;
}
#mods .list label input:checked + mark::after{
	-webkit-transform:translateX(8px);
}
#mods .start{
	position: absolute;
	bottom:0;
	left:0;
	right: 0;
	font-size:20px;
	padding:16px 0;
	cursor: pointer;
}
#mods .start:hover{
	color:#bc4b4b;
}
`;
document.head.append(style);

const cache=await caches.open(`c2offline-${location.origin}/minidayz_1.4.1/-v1495461173`);

const offline=[
	"../mods.js",
	"../mods.json",
	"../mods/toolkit.js",
];
for(const src of offline){
	const response=await fetch(src);
	await cache.put(src,response);
}


let list=``;
for(const mod of mods){
	let checked="";
	if(install.includes(mod.script)) checked="checked";
	if(mod.description=="") mod.description="&nbsp;"
	list+=/*html*/`
		<label>
			<div>${mod.name} <span class="version">${mod.version}</span> <span class="description">${mod.description}</span></div>
			<input type="checkbox" data-mod="${mod.script}" ${checked}>
			<mark></mark>
		</label>
	`;
	const response=await fetch(`../mods/${mod.script}/${mod.script}.js`);
	await cache.put(`../mods/${mod.script}/${mod.script}.js`,response);
}

const div=document.createElement("div");
div.id="mods";
div.innerHTML=/*html*/`
	<div class="content">
		Mods list:<br>
		<div class="list">
			${list}
		</div>
		<a class="start">Start Mini DayZ</a>
	</div>
`;
div.querySelector(".start").addEventListener("pointerup",start);
document.body.append(div);


async function start(){
	install=[];
	document.querySelectorAll("#mods input[data-mod]").forEach(function(e){
		if(e.checked){
			const mod=e.getAttribute("data-mod");
			install.push(mod);
		}
	});
	
	const branch=location.hostname=="localhost"?"":"main/";

	div.remove();
	style.remove();
	for(const mod of mods){
		if(!install.includes(mod.script)) continue;
		const e=(await import(`../${branch}mods/${mod.script}/${mod.script}.js`));
		if(e.install) await e.install();
	}
	localStorage.setItem("mods",JSON.stringify(install));
	// Create new runtime using the c2canvas
	window.c2runtime=cr_createRuntime("c2canvas");
	
	// Pause and resume on page becoming visible/invisible
	function onVisibilityChanged() {
		if (document.hidden || document.mozHidden || document.webkitHidden || document.msHidden)
			cr_setSuspended(true);
		else
			cr_setSuspended(false);
	};
	
	document.addEventListener("visibilitychange", onVisibilityChanged, false);
	document.addEventListener("mozvisibilitychange", onVisibilityChanged, false);
	document.addEventListener("webkitvisibilitychange", onVisibilityChanged, false);
	document.addEventListener("msvisibilitychange", onVisibilityChanged, false);
	
	function OnRegisterSWError(e)
	{
		console.warn("Failed to register service worker: ", e);
	};
	
	// Runtime calls this global method when ready to start caching (i.e. after startup).
	// This registers the service worker which caches resources for offline support.
	window.C2_RegisterSW = function C2_RegisterSW()
	{
		if (!navigator.serviceWorker)
			return;		// no SW support, ignore call
		
		try {
			navigator.serviceWorker.register("sw.js", { scope: "./" })
			.then(function (reg)
			{
				console.log("Registered service worker on " + reg.scope);
			})
			.catch(OnRegisterSWError);
		}
		catch (e)
		{
			OnRegisterSWError(e);
		}
	};
}
