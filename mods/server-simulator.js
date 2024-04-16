export function install(){
	window.XMLHttpRequest=class{
		constructor(){
			this.readyState=4;
			this.status=404;
			this.onreadystatechange=null;
			this.onload=null;
			/**
			 * @type {"text"|"json"|"arraybuffer"|"blob"}
			 */
			this.responseType="text"
		}
		/**
		 * 
		 * @param {"GET"|"POST"|"DELETE"} method 
		 * @param {string} url 
		 */
		open(method="GET",url){
			this.url=url;
			this.method=method;
		}
		send(body){
			const that=this;
			this.body=body;
			this.response=this.responseText="";
			if(this.method=="GET" && this.url.indexOf(".")>-1) return fetch(this.url).then(async function(res){
				if(that.responseType=="text") that.response=that.responseText=await res.text();
				if(that.responseType=="json") that.response=that.responseText=await res.json();
				if(that.responseType=="arraybuffer") that.response=that.responseText=await res.arrayBuffer();
				if(that.responseType=="blob") that.response=that.responseText=await res.blob();

				that.status=200;
				if(that.onload) that.onload();
				if(that.onreadystatechange) that.onreadystatechange();
			});

			this.simulate();
		}

		simulate(){
			const that=this;
			const method=this.method;
			const query=new URLSearchParams(this.url.split("?")[1]);
			const body=new URLSearchParams(this.body);
			let router=this.url;
			if(this.url.indexOf("?")!=-1) router=this.url.split("?")[0];
			if(!router.startsWith("/")) router=`/${router}`;
			// console.log(method,router,query,body);
			function response(object){
				that.status=200;
				that.responseText=JSON.stringify(object);
			}
			if(method=="GET"){
				if(localStorage.getItem(router)!==null) response(localStorage.getItem(router));
				if(router=="/"){
					response({have_game:["SPROCKET2DAYZMINI001","SPROCKET2DAYZMINI001"]});
				}
				if(router=="/api/auth"){
					response({login_request:"accesskey",client_id:"clientid"});
				}
			}
			if(method=="POST"){
				response({saved_game_url:"1",send_pos:"1",send_achieves:"1",send_stats:"1"});
				localStorage.setItem(router,JSON.stringify(Object.fromEntries(body)));
			}
			if(method=="DELETE"){
				response({saved_game_url:"1",del_stats:true});
				localStorage.removeItem(router);
			}
			// All triggers from response
			requestAnimationFrame(function(){
				that.onreadystatechange();
			})
		}
	}
}
