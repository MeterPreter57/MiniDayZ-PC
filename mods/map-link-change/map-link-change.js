const maps={
	"map_narva":"map_narva.jpg",
	"map_minidayz":"map_minidayz.png",
}
export function install(){
	const open=window.open;
	window.open=function(url, target, windowFeatures){
		if(target=="Map") {
			const split=url.split("/");
			const name=split[split.length-1].split(".")[0];
			return open(`https://raw.githubusercontent.com/MeterPreter57/MeterPreter57.github.io/main/${maps[name]}`,target,windowFeatures);
		}
		return open(url,target,windowFeatures);
	}
}