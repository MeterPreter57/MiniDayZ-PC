# PC Browser Mini DayZ
[![Mini DayZ](./minidayz.png)](https://raw.githack.com/MeterPreter57/MiniDayZ-PC/main/minidayz_1.4.1/index.html)

### Mods support added

### Progress saving works!
Thanks [W84Soft](https://github.com/W84Soft) for that.  
Click **Save and Exit** and wait until you will be back to the main menu.


# [Play in Browser](https://raw.githack.com/MeterPreter57/MiniDayZ-PC/main/minidayz_1.4.1/index.html)

# [MiniDayZ MultiPlayer Version](https://github.com/MeterPreter57/minidayz-multiplayer)

## What's new?
- Updated "Response server simulator" now simulator allows you to inject data.js files
- Toolkit update, now you can load your own data.js modifications using simple `game.loadData(src)` function
- Toolkit `game.saveCache(__dirname,files)` method for storing files for offline play
- Toolkit showcase modification

## Plans for the future:
1. [x] Restore c2runtime.js and data.js to original source code
2. [x] Add mods support without changing original files
	- [x] Mod selection from list
3. [x] Add server response simulator as mod
4. [x] Add working in-game map mod
5. [ ] Update save editor UI & add more features 
6. [ ] Use toolkit.js to create an in-game panel that allows advanced game controls
7. [x] Creating helpers for better game control and easier creation of mods

## Known issues:
#### Achievements and stats are not updated after death 
Reload the page
#### Game saving/mods/other recently added features don't work
1. Open the game  
2. If you want to preserve your save  
   2.1. Enable the `Save exporter & importer` mod  
   2.2. Export your save  
4. Open site information (top left corner near the url)
5. Go to **Site settings**
6. Click **Delete data**
7. Reload the game and import your save


## Mods
If you want to create your own mod, create javascript file in mods/ directory, for example: mods/my-mod/my-mod.js


Now you must to add exported install function: 
#### mods/example-script/example-script.js
```js
export function install(){

}
```

Now you can add some logic, for example I tried to add listener for buttons in-game that open links, and print in console.log what they want to open:

#### mods/example-script/example-script.js
```js
export function install(){
	const original_open=window.open;
	window.open=function(url, target, windowFeatures){
		console.log(url,target,windowFeatures);
		original_open(url,target,windowFeatures);
	}
}
```

Now you need to modify mods.json, add your new mod to list:

#### mods.json
```json
{
	"mods":[
		// Other mods:
		{...},
		// Your mod:
		{
			"name":"Example mod",
			"description":"Example description",
			"script":"example-script",
			"version":"1.0.0"
		}
	]
}
```

### Testing mods
Now you can start the server, e.g. via NodeJS http-server and run the game:
![Browser Mini DayZ mods selector](./example.png)


### Loading custom data.js

Below is an simple example of loading a custom data.js file:

```js
import { game } from "../toolkit.js";

const __dirname=import.meta.url.split("/").splice(0,import.meta.url.split("/").length-1).join("/");

const offlineFiles=[
	"assets/image.png",
	"assets/audio.ogg"
];

export async function install(){
	await game.loadData(`${__dirname}/custom-data.js`);
	await game.saveCache(__dirname,offlineFiles);
}
```

### Files structure:
```
mods/
└── before-dayz/
    ├── before-dayz.js
    ├── custom-data.js
    └── assets/
        ├── image.png
        └── audio.ogg  
```

All data.js modifications are saved to the browser memory, so offline play is possible