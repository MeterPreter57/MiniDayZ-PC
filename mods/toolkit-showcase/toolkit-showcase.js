import { game } from "../toolkit.js";
import { files } from "./offline.js";

const __dirname=import.meta.url.split("/").splice(0,import.meta.url.split("/").length-1).join("/");

export async function install(){
	await game.loadData(`${__dirname}/data.js`);
	await game.saveCache(__dirname,files);

	document.querySelector("body").style.setProperty("margin","0");
	document.querySelectorAll("br").forEach(function(e){
		e.remove();
	});
	document.querySelector("#c2canvasdiv").style.setProperty("display","flex");
}