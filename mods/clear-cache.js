export async function install(){
	const keys=await caches.keys();
	for(const key of keys){
		console.log(`Deleting ${key}`);
		await caches.delete(key);
	}
	console.log("Cache cleared!");
}