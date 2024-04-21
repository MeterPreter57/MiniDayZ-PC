const game={
	getVariable(name){
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
	}
}
// game.getVariable("Regeneration_current").data=40
// game.getVariable("Thirsty_current").data=40
// game.getVariable("Starving_current").data=40
window.game=game;