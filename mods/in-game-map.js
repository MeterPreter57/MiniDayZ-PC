const style=document.createElement("style");
style.innerHTML=`
#map{
	visibility:visible;
	opacity:1;
	position:fixed;
	top:0;
	left:0;
	right:0;
	bottom:0;
	max-height:100%;
	display:-webkit-flex;
	justify-content:center;
	align-items:center;
	padding:16px;
	background:rgba(24,24,24,.8);
	-webkit-transition:.5s;
}
#map.hide{
	visibility:hidden;
	opacity:0;
}
#map img{
	max-width:100%;
	max-height:100%;
}
`;
document.head.append(style);

const div=document.createElement("div");
div.id="map";
div.className="hide";
div.addEventListener("click",function(event){
	event.stopPropagation();
	event.preventDefault();
	cr_setSuspended(false);
	this.classList.add("hide");
});
document.body.append(div);

const cache=await caches.open(`c2offline-${location.origin}/minidayz_1.4.1/-v1495461173`);
const offline=[
	"../map_minidayz.png",
	"../map_narva.jpg",
];
for(const src of offline){
	const response=await fetch(src);
	await cache.put(src,response);
}

const maps={
	"map_narva":"map_narva.jpg",
	"map_minidayz":"map_minidayz.png",
}

export async function install(){
	const open=window.open;
	window.open=function(url, target, windowFeatures){
		if(target=="Map") {
			const split=url.split("/");
			const name=split[split.length-1].split(".")[0];
			div.classList.remove("hide");
			div.innerHTML=`<img src="../${maps[name]}">`;
			cr_setSuspended(true);
			return;
		}
		return open(url,target,windowFeatures);
	}
}