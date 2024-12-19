const cache=await caches.open(`c2offline-${location.origin}/minidayz_1.4.1/-v1495461173`);
export const game={
	getVariable(name=""){
		const keys=c2runtime.Vj;
		for(let key in keys){
			if(keys[key].name==name) return keys[key];
		}
	},
	getVariables(){
		const result={}
		const keys=c2runtime.Vj;
		for(let key in keys){
			result[keys[key].name]=keys[key];
		}
		return result;
	},
	data:await (await fetch("data.js")).text(),
	async loadData(src="data.js"){
		const response=await fetch(src);
		await cache.put(src,response);
		game.data=await (await fetch(src)).text();
	},
	async saveCache(__dirname,files){
		for(const file of files){
			const src=`${__dirname}/${file}`
			const response=await fetch(src);
			await cache.put(src,response);
		}
	}
}
// game.getVariable("Regeneration_current").data=40
// game.getVariable("Thirsty_current").data=40
// game.getVariable("Starving_current").data=40
window.game=game;