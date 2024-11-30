export function install(){
	function resize(){
		document.body.style.margin=0;
		document.querySelector("#c2canvasdiv").setAttribute("style","margin:0 auto");
		document.querySelector("#c2canvas").width=window.innerWidth;
	}
	resize();
	window.addEventListener("resize",resize);
}