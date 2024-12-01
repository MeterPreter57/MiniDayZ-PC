const __dirname=import.meta.url.split("/").splice(0,import.meta.url.split("/").length-1).join("/");

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

#editor{
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
#editor *{
	-webkit-box-sizing:border-box;
}
#editor .content{
	position: relative;
	background:#111;
	text-align:center;
	padding:32px;
	border-radius:4px;
	min-width:480px;
}
#editor .data{
	margin-top:32px;
	font-family:"Arial";
	background:#222;  
	overflow: auto;
	width:480px;
	text-align:left;
	border-radius:4px;
}
#editor .data div{
	display:-webkit-flex;
	align-items:center;
	justify-content:space-between;
	padding:8px 12px;
	user-select: none;
}
#editor .data div:hover{
	background:rgba(255,255,255,.025);
}
#editor .data div span{
	text-overflow:ellipsis;
	white-space:nowrap;
	overflow: hidden;
	flex:1;
	font-size:14px;
}
#editor a{
	display:block;
	font-size:18px;
	padding:16px 0;
	cursor: pointer;
}
#editor a:hover{
	color:#bc4b4b;
}
#editor label{
	display:block;
}
#editor label input{
	display:none;
}
#editor .start{
	position: absolute;
	bottom:0;
	left:0;
	right: 0;
}
#editor .item{
	display:inline-block;
	position: relative;
}
#editor .items{
	position: absolute;
	left: 8px;
	top:50%;
	-webkit-transform:translateY(-50%);
	display:inline-block;
	background-image:url(${__dirname}/items.png);
	width: 32px;
  	height: 32px;
}
#editor .inventory{
	text-align:left;
}
#editor input,
#editor select{
	width: 128px;
	background: #222;
	color: #fff;
	border: none;
	padding: 8px 12px;
	margin: 4px;
	border-radius: 4px;
}
#editor .item select{
	padding-left:48px;
}
`;
document.head.append(style);

const div=document.createElement("div");
div.id="editor";
div.innerHTML=/*html*/`
	<div class="content">
		<div class="data"></div>
		<div class="items"></div>
		<div class="inventory"></div>
		<div class="difficulty"></div>
		<a class="start">Done</a><br>
	</div>
`;
document.body.append(div);

export function install(){
	return new Promise(function(resolve){
		if(!localStorage.getItem("/sp_save")) {
			style.remove();
			div.remove();
			return resolve();
		}
		const json=JSON.parse(localStorage.getItem("/sp_save"));
		const save=json.data;
		function reload(){
			const save=localStorage.getItem("/sp_save");
			
			div.querySelector(".data").innerHTML=``;
			if(save) div.querySelector(".data").innerHTML+=`<div><span>/sp_save</span><span>${JSON.parse(save).data}</span></div>`;
		}
		reload();

		// const maplevel=["Novice","Chernarus_plus"];
		// const stats=[0,0,0,0,0,0]
		// const mele=[0,0];
		// const range=[0,0,0];
		// const hand=[0,0];
		// const helmet=[0,0];
		// const pants=[0,0,0,0,0,0,0,0,0];
		// const tshirt=[0,0,0,0,0,0,0,0,0];
		// const vest=[0,0,0,0,0,0,0,0,0];
		// const backpack=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
		// const time=[0];


		// let result=["$0",0];
		// result=result.concat(maplevel);
		// result=result.concat(stats);
		// result.push(0,0);
		// result=result.concat(mele);
		// result=result.concat(range);
		// result=result.concat(hand);
		// result=result.concat(helmet);
		// result.push(0,0);
		// result=result.concat(pants);
		// result=result.concat(tshirt);
		// result=result.concat(vest);
		// result=result.concat(backpack);
		// result=result.concat(time);
		// result.push(0,0,0);

		let split=save.split(",");
		for(let i=0;i<=split.length;i++){
			const value=split[i];
			if(i==0 || i==1 || i==10 || i==11 || i==21 || i==22 || i==25 || i==34 || i==43 || i==52) continue;
			if(i>=12){
				function render(min,max,id,type){
					const inv=document.querySelector(".inventory");
					if(i>=min && i<max){
						if(i==min){
							let elements=items[id];
							if(type=="item") elements=items.items;
							inv.append(document.createTextNode(`${id}:`));
							const select=document.createElement("select");
							select.setAttribute("id",id);
							select.setAttribute("data-id",i);
							select.addEventListener("change",function(){
								split[i]=this.value;
							});
							inv.append(select);
							select.innerHTML+=`<option value="0"></option>`;
							for(let key in elements){
								const item=elements[key];
								if(elements[value]==item){
									select.innerHTML+=`<option value="${key}" selected>${item}</option>`;
								}else{
									select.innerHTML+=`<option value="${key}">${item}</option>`;
								}
							}
						}else{
							if(i-min>2){
								if((i-min)%2==0){
									const input=document.createElement("input");
									input.value=value;
									input.type="number";
									input.id=`${id}-${i}-number`;
									input.addEventListener("change",function(){
										split[i]=this.value;
									});
									inv.append(input);
								}else{
									const div=document.createElement("div");
									div.className="item";
									div.innerHTML+=`<select id="${id}-${i}" data-id="${i}"></select> <div class="items"  id="${id}-${i}-item"></div>`;
									div.querySelector("select").addEventListener("change",function(){
										split[i]=this.value;
									});
									inv.append(div);
									div.querySelector(`select`).innerHTML+=`<option value="0"></option>`;
									for(let key in items.items){
										const item=items.items[key];
										if(items.items[value]==item && value!=0){
											div.querySelector(`select`).innerHTML+=`<option value="${key}" selected>${item}</option>`;
										}else{
											div.querySelector(`select`).innerHTML+=`<option value="${key}">${item}</option>`;
										}
									}
									show(value);
									function show(item=0){
										const y=(Math.floor(item/8));
										const x=item%8;
										div.querySelector(`.items`).setAttribute("style",`background-position:-${x*32}px -${y*32}px`);
									}
									div.querySelector("select").addEventListener("change",function(){
										show(this.value);
									})
								}
							}else{
								const input=document.createElement("input");
								input.type="number";
								input.value=value;
								input.addEventListener("change",function(){
									split[i]=this.value;
								});
								inv.append(input);
							}
						}
					}
					if(i==max) inv.append(document.createElement("br"));
				}
				render(12,14,"mele");
				render(14,17,"range");
				render(17,19,"hand","item");
				render(19,23,"helmet");
				render(23,32,"pants");
				render(32,41,"tshirt");
				render(41,50,"vest");
				render(50,66,"backpack");
			}
		}

		div.querySelector(".start").addEventListener("pointerdown",function(){
			json.data=split.join(",");
			localStorage.setItem("/sp_save",JSON.stringify(json));
			style.remove();
			div.remove();
			resolve();
		});
	});
}




const items={
	items:{
		"1": "Canned Beans",
		"2": "Tuna",
		"3": "Tactical Bacon",
		"4": "Rice",
		"5": "Fresh tomato",
		"6": "Fresh apple",
		"7": "Fresh banana",
		"8": "Pipsi soda can",
		"9": "Spite soda can",
		"10": "Kvas soda can",
		"11": "NATO Ammo 5x56",
		"12": "Ammo 45acp.",
		"13": "Ammo 7.62x54",
		"14": "Ammo 7.62x39",
		"15": "Ammo 5x45",
		"16": "Ammo .357",
		"17": "Ammo 12cal",
		"18": "Bandage",
		"19": "Blood bag. Refills blood.",
		"20": "Red Flare",
		"21": "F1 Grenade",
		"22": "Batterie. compatible with headtorch.",
		"23": "Campfire kit, place it on ground and lit with matches.",
		"24": "Matches. Use on Piles to start fireplace.",
		"25": "Whiskey John Darryels",
		"26": "Rags. Can be used like bandage.",
		"27": "Red berries",
		"28": "Saline bag. Refills blood.",
		"29": "Vitamin bottle. Increasing regeneration effect for short period.",
		"30": "Nota-cola soda can",
		"31": "Squash",
		"32": "Bell pepper",
		"33": "Orange",
		"34": "Heatpack",
		"35": "Sewing kit, repairs up to 50% of clothing condition.Single use only.",
		"36": "Weapon cleaning kit, restores 25% of you firearm. Single use",
		"37": "Ashwood stick",
		"38": "Wooden sticks",
		"39": "Duct tape, useful for craft and little repairs",
		"40": "Burlap sack",
		"41": "Rope",
		"42": "Hunter knife",
		"43": "Army knife",
		"44": "Butcher knife",
		"45": "Morphine. Heals fractures.",
		"46": "Tetracycline. Heals deseases.",
		"47": "Tomato seeds pack",
		"48": "Tomato seeds",
		"49": "Old papers, useful for campfire.",
		"50": "Wooden piles, base for campfire kit. Add papers, sticks or rags to craft campfire kit.",
		"51": "Crafted arrows",
		"52": "Composite arrows",
		"53": "Gasoline. Can be used to fuel drivable vehicles.",
		"54": "Water bottle. Can be used to gather water.",
		"55": "Canteen. Can be used to gather water.",
		"56": "Hmm, label says its Nuko-cola. What it can be?",
		"57": "Landmine. Activates 3 seconds after deployment.",
		"58": "Bear trap. Activates 3 seconds after deployment.",
		"59": "22lr ammo. compatible with sporter 22 and amphibias s pistol.",
		"60": "Vehicle repair kit, increases vehicle condition. Single use.",
		"61": "Raw meat steak. Can be cooked with a fireplace. Or can be eated with chance of get sick.",
		"62": "Cooked steak. Above all restores some blood after eating.",
	},
	range:{
		"151": "fnx pistol",
		"152": "colt pistol",
		"153": "magnum",
		"154": "bm16",
		"155": "remington",
		"156": "mosin nagant",
		"157": "sks",
		"158": "m4",
		"159": "akm",
		"160": "ak74",
		"161": "aks74u",
		"162": "l85",
		"163": "improvised bow",
		"164": "crossbow",
		"165": "amphibia",
		"166": "sporter",
		"167": "repeater",
	},
	pants:{
		"301": "workpants",
		"302": "sportpants",
		"303": "gorka pants",
		"304": "orel pants",
		"305": "paramedic pants",
		"306": "hunter pants",
	},
	mele:{
		"0": "Knive",
		"200": "Pipe Wrench",
		"201": "shovel",
		"202": "Split Axe",
		"203": "Baseball Bat",
		"204": "Fireaxe",
		"205": "Crowbar",
		"206": "Pickaxe",
		"207": "Pitchfork",
		"208": "Sledgehammer",
	},
	helmet:{
		"251": "army helmet",
		"252": "moto helmet",
		"253": "moto helmet colored",
		"254": "warm hat",
		"255": "beret",
		"256": "baseball cap",
		"257": "balaklava",
		"258": "ushanka",
		"259": "hard helmet",
		"260": "headtorch",
		"261": "cowboy hat",
		"262": "welding mask",
		"263": "gorka helmet",
		"264": "police hat",
		"265": "nv goggles",
		"266": "bandana",
	},
	tshirt:{
		"350": "tshirt",
		"352": "shirt",
		"353": "raincoat",
		"354": "raider jacket",
		"355": "gorka jacket",
		"356": "hoodie gray",
		"357": "hoodie red",
		"358": "cloak",
		"359": "paramedic jacket",
		"360": "orel jacket",
		"361": "tracksuit",
		"362": "dress",
		"363": "down jacket",
		"364": "hunter jacket",
	},
	vest:{
		"400": "bulletproof vest",
		"401": "press vest",
		"402": "assault vest",
		"403": "high capacity vest",
	},
	backpack:{
		"450": "taloon backpack",
		"451": "hunter backpack",
		"452": "mountain backpack",
		"453": "school backpack",
		"454": "improvised bag",
		"455": "improvised backpack",
		"456": "civilian tent",
		"457": "tortilla backpack"
	}
}