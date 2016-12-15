var http = require("http");
var socketio = require("socket.io");
var fs = require("fs");

var server = http.createServer(function(req, res) {
     res.writeHead(200, {"Content-Type":"text/html"});
     var output = fs.readFileSync("./index.html", "utf-8");
     res.end(output);
}).listen(process.env.VMC_APP_PORT || 3000);
var io = socketio.listen(server);
io.set('heartbeat interval', 5000);
io.set('heartbeat timeout', 15000);
var userHash = {};//接続しているclientのHash:名前で格納
var gameHash = {};//ゲーム開始時の、ルーム名:{clientのHash:名前} で格納userHashが接続が切れた際に消すため
var userRoom = {};//接続しているclientのHash:ルーム名で格納
var adminHash = {};//ルームマスターのHash:名前で格納
var RoomList = ["room1","room2"];//まだ固定
var countdown = {};//後々使うかも
var gamerole={};//ゲームの情報を格納。
//ルーム名:{daycount:ゲーム内の日数
//　　　　  member:{ゲーム参加者(開始時点):{role:役職,
//　　　　　　　　　　　　　　　　　　　　　　live:生きているかどうか(true/false);
//                 }
//　　　　　}で格納



io.sockets.on("connection", function (socket) { //Socket開始
	if(!userRoom[socket.id]){
		socket.join("notjoinroom");
		socket.emit("roomlists",{rooms:"あるよ"});
		socket.emit("roommember", {});
		console.log(socket.id+"がNJRにjoin"); //Debug notjoinroomにjoinした名前を垂れ流す
	}else{
		socket.connect();
	} //ノンエントリー状態 //ノンエントリーの人に部屋情報を送信
	
	//2つ以上のroomに入っている場合、エラーメッセージを送信する機能をつける
	
	//roomに入室
	socket.on("connected", function (usr) {
		//socketの名前を受信。htmlのタグ要素と改行、スペースを消す
		var socketsname=String(usr.sendmsg).replace( /&/g , "&amp;" ).replace(/</g,'&lt;').replace(/>/g,'&gt;').replace( /"/g , "&quot;" ).replace(/\r?\n/g, "").replace(/\s+/g,"");
		if(!in_array(usr.roomname,RoomList)){ //RoomList配列にない名前はNG
			var msg="該当する部屋は存在しません。";
			socket.emit("errmsg", {sendmsg:msg , issys:1});
		}else if(socketsname.length < 2 || socketsname.length > 10){ //2〜10文字以外の名前はNG
			var msg="2文字以上10文字以下の名前を入力してください";
			socket.emit("errmsg", {sendmsg:msg , issys:1});

		}else if((in_array(socketsname,userHash) && in_array(usr.roomname,userRoom))){//同じ名前は入室NG
			var msg="ルーム："+usr.roomname+" に同じ名前の人がいます："+socketsname;
			socket.emit("errmsg", {sendmsg:msg , issys:1});
		}else{
			var msg = socketsname + "さんが入室しました";
			userHash[socket.id] = socketsname;
			userRoom[socket.id] = usr.roomname;
			socket.leave("notjoinroom");//ノンエントリー状態とおさらば
			socket.join(userRoom[socket.id]);//roomにjoin
			
			//roomのmemberリストを送信
			var memberno=0;
			var memberlist={};
			for (member in socket.adapter.rooms[usr.roomname].sockets){
				memberlist[memberno]=userHash[member];
				console.log(member);
				memberno++;
			}
			if(memberno==1){
				socket.emit("S_to_C_message", {sendmsg: "あなたが管理者です。",issys: 2,emittime:genedate()});
				socket.emit("to_admin", "");
				adminHash[socket.id]=userRoom[socket.id];
			}
			console.log(memberlist);
			io.sockets.in(userRoom[socket.id]).emit("roommember", {members: memberlist});
			//roomへ入室のシステムメッセージ
			io.sockets.in(userRoom[socket.id]).emit("S_to_C_message", {sendmsg: msg,issys: 3,emittime:genedate()});
		}
	});
	
	//ルームマスターからのconfigを取得
	socket.on("config",function(data){
		//s.emit("config", {werewolf:$("#werewolf").val(),madman:$("#madman").val(),fox:$("#fox").val(),seer:$("#seer").val(),medium:$("#medium").val(),hunter:$("#hunter").val(),villager:$("#villager").val(),daytime:$("#daytime").val(),nighttime:$("#nighttime").val(),gmmode:isgmmode});
		var isgmmode="";
		if(data.gmmode){ isgmmode="ON"; }else{ isgmmode="OFF"; }
		var numwerewolf=Number(data.werewolf);
		var nummadman=Number(data.madman);
		var numfox=Number(data.fox);
		var numseer=Number(data.seer);
		var nummedium=Number(data.medium);
		var numhunter=Number(data.hunter);
		var numvillager=Number(data.villager);
		var numdaytime=Number(data.daytime);
		var numnighttime=Number(data.nighttime);
		var numplayer=numwerewolf+nummadman+numfox+numseer+nummedium+numhunter+numvillager;
		var numwolfside=numwerewolf+nummadman;
		var numfoxside=numfox;
		var nummanside=numseer+nummedium+numhunter+numvillager;
		if(in_array(userRoom[socket.id],userRoom)<numplayer){
			socket.emit("S_to_C_message",{sendmsg:"ルーム内の人数が配役より少ないため、チャットを開始できません。",issys:1});
		}else{ //else ifで勝利条件判定trueの場合、だめって返すようにしたい
			var roles=[];
			pusharray(numwerewolf,"werewolf",roles);
			pusharray(nummadman,"madman",roles);
			pusharray(numfox,"fox",roles);
			pusharray(numseer,"seer",roles);
			pusharray(nummedium,"medium",roles);
			pusharray(numhunter,"hunter",roles);
			pusharray(numvillager,"villager",roles);
			console.log(roles);
			roles=shuffle(roles);
			console.log(roles);
			var haiyaku="配役 人狼"+data.werewolf+"/狂人"+data.madman+"/妖狐"+data.fox+"/占い師"+data.seer+"/霊能者"+data.medium+"/狩人"+data.hunter+"/村人"+data.villager+"<br />人狼陣営(狂人含め)："+numwolfside+"人/妖狐陣営："+numfoxside+"人/村人陣営："+nummanside+"人/合計人数"+numplayer+"/昼時間"+data.daytime+"分/夜時間"+data.nighttime+"分/GMモード" + isgmmode;
			io.sockets.in(userRoom[socket.id]).emit("S_to_C_message", {sendmsg:haiyaku,issys:4});
			var i=0;
			gamerole[userRoom[socket.id]]={};
			gamerole[userRoom[socket.id]]["daycount"]=1;
			gamerole[userRoom[socket.id]]["daytime"]=3;
			gamerole[userRoom[socket.id]]["votecount"]=1;
			gamerole[userRoom[socket.id]]["wolf"]=numwolfside;
			gamerole[userRoom[socket.id]]["fox"]=numfoxside;
			gamerole[userRoom[socket.id]]["man"]=nummanside;
			gamerole[userRoom[socket.id]]["wolfaction"]={};
			gamerole[userRoom[socket.id]]["seeraction"]={};
			gamerole[userRoom[socket.id]]["hunteraction"]={};
			gamerole[userRoom[socket.id]]["votekill"]={};
			gamerole[userRoom[socket.id]]["member"]={};
			gameHash[userRoom[socket.id]]={};
			for(member in socket.adapter.rooms[userRoom[socket.id]].sockets){
				gameHash[userRoom[socket.id]][member]=userHash[member];
				gamerole[userRoom[socket.id]]["member"][member]={};
				gamerole[userRoom[socket.id]]["member"][member]["role"]=roles[i];
				gamerole[userRoom[socket.id]]["member"][member]["live"]=true;
				gamerole[userRoom[socket.id]]["member"][member]["vote"]={};
				console.log(gamerole[userRoom[socket.id]]["member"][member]);
				var ismaster=(socket.id==member);
				io.to(member).emit("gamestart", {role:roles[i],master:ismaster,yourname:userHash[member]});
				console.log(member+"："+roles[i]);
				console.log(i);
				console.log(ismaster);
				i++;
				if(numplayer<=i){//ルームにいる人のほうが多かったら途中でbreak
					break;
				}
			}
			console.log(gameHash[userRoom[socket.id]]);
			var livingpeople={};
			var playerroles={};
			for(member in gamerole[userRoom[socket.id]]["member"]){
				livingpeople[userHash[member]]=gamerole[userRoom[socket.id]]["member"][member]["live"];
				playerroles[userHash[member]]=gamerole[userRoom[socket.id]]["member"][member]["role"];
			}
			io.sockets.in(userRoom[socket.id]).emit("night",{daycount:gamerole[userRoom[socket.id]]["daycount"],wholive:livingpeople,playerrole:playerroles,daycount:gamerole[userRoom[socket.id]]["daycount"]});
			console.log("ゲーム開始時生存者");
			console.log(livingpeople);
			console.log("");
			console.log(gamerole);
		}
	});
	
	//投票を受信
	socket.on("voting", function(data){
		if(data.votefor){ //投票先がある場合
			var votefor=0;
			for(member in gameHash[userRoom[socket.id]]){
				if(gamerole[userRoom[socket.id]]["member"][member]["live"] && data.votefor==gameHash[userRoom[socket.id]][member]){//生きている場合
					votefor=data.votefor;
				}
			}
			if(votefor){
				if(gamerole[userRoom[socket.id]]["member"][socket.id]["vote"][gamerole[userRoom[socket.id]]["daycount"]][gamerole[userRoom[socket.id]]["votecount"]]){
					socket.emit("S_to_C_message",{sendmsg:"投票を"+votefor+"さんに変えました。",issys:2});
				}else{
					socket.emit("S_to_C_message",{sendmsg:votefor+"さんに投票しました。",issys:2});
				}
				gamerole[userRoom[socket.id]]["member"][socket.id]["vote"][gamerole[userRoom[socket.id]]["daycount"]][gamerole[userRoom[socket.id]]["votecount"]]=votefor;
				//gameroleのルームのメンバーの投票先の日数の投票回数のところを投票先にする
			}else{
				socket.emit("S_to_C_message",{sendmsg:votefor+"さんには投票できません。",issys:1});
				
			}
		}else{ //ない場合
			socket.emit("S_to_C_message",{sendmsg:"投票先を選んでください。",issys:1});
		}
	});
	
	//役職の行動を受信
	socket.on("roleaction", function(data){
		if(data["to"]){
			if(gamerole[userRoom[socket.id]]["member"][socket.id]["role"]=="werewolf"){//送信元が人狼
				gamerole[userRoom[socket.id]].wolfaction[gamerole[userRoom[socket.id]]["daycount"]]=data.to; //人狼のn日目の実行先を格納
				for(member in socket.adapter.rooms[userRoom[socket.id]].sockets){
					if(gamerole[userRoom[socket.id]].member[member]){//ゲームにいる場合
						if(gamerole[userRoom[socket.id]].member[member].role=="werewolf"){//memberが人狼のときだけメッセージを送る
							io.to(member).emit("jobcomplete", {day:gamerole[userRoom[socket.id]]["daycount"],job:"werewolf",to:data.to});
							console.log({day:gamerole[userRoom[socket.id]]["daycount"],job:"werewolf",to:data.to});
						}
					}
				}
			}else if(gamerole[userRoom[socket.id]]["member"][socket.id]["role"]=="seer"){//送信元が占い師
				gamerole[userRoom[socket.id]].seeraction[gamerole[userRoom[socket.id]]["daycount"]]=data.to; //占い師のn日目の実行先を格納
				var neko="";
				for(member in gamerole[userRoom[socket.id]].member){
					if(userHash[member]==data.to){
						if(gamerole[userRoom[socket.id]].member[member].role=="werewolf"){
							neko="●";
						}else{
							neko="○";
						}
					}
				}
				socket.emit("jobcomplete", {day:gamerole[userRoom[socket.id]]["daycount"],job:"seer",result:neko,to:data.to});
				console.log({day:gamerole[userRoom[socket.id]]["daycount"],job:"seer",result:neko,to:data.to});
			}else if(gamerole[userRoom[socket.id]]["member"][socket.id]["role"]=="hunter"){
				gamerole[userRoom[socket.id]].hunteraction[gamerole[userRoom[socket.id]]["daycount"]]=data.to; //狩人のn日目の実行先を格納
				socket.emit("jobcomplete", {day:gamerole[userRoom[socket.id]]["daycount"],job:"hunter",result:"",to:data.to});
				console.log({day:gamerole[userRoom[socket.id]]["daycount"],job:"hunter",result:""});
			}
		}else{
			socket.emit("S_to_C_message",{sendmsg:"実行先を選んでください。",issys:1});
		}
	});
	
    // 受信したメッセージをルームに送信 人狼ルーム、狐ルームとかに分けたほうがいいのでは？
	socket.on("C_to_S_message", function (data) {
		var msg = String(data.sendmsg).replace( /&/g , "&amp;" ).replace(/</g,'&lt;').replace(/>/g,'&gt;').replace( /"/g , "&quot;" );
		if(gamerole[userRoom[socket.id]]){//ゲーム開始時 
			if(of_array(socket.id,gamerole[userRoom[socket.id]].member)){ //発言者がゲームにいる場合
				if(gamerole[userRoom[socket.id]].member[socket.id].live){ //発言者が生きている場合
					console.log("発言者が生きている");
					if(gamerole[userRoom[socket.id]].daytime==3){//夜時間
						if(gamerole[userRoom[socket.id]].member[socket.id].role=="werewolf"){//発言者が人狼
							for(member in socket.adapter.rooms[userRoom[socket.id]].sockets){ //ルーム内のメンバーを捜索
								if(gamerole[userRoom[socket.id]].member[member]){//ゲームにいる場合
									if(gamerole[userRoom[socket.id]].member[member].role=="werewolf"){//memberが人狼のときだけメッセージを送る
										io.to(member).emit("S_to_C_message", {sendmsg:("(人狼チャット)"+msg),usrname:userHash[socket.id],emittime:genedate(),issys:5});
									}
								}else{//ゲームにいない場合
										io.to(member).emit("S_to_C_message", {sendmsg:("(人狼チャット)"+msg),usrname:userHash[socket.id],emittime:genedate(),issys:5});
								}
							}
						}else if(gamerole[userRoom[socket.id]].member[socket.id].role=="fox"){//発言者が狐
							for(member in socket.adapter.rooms[userRoom[socket.id]].sockets){ //ルーム内のメンバーを捜索
								if(gamerole[userRoom[socket.id]].member[member]){//ゲームにいる場合
									if(gamerole[userRoom[socket.id]].member[member].role=="fox"){//memberが狐のときだけメッセージを送る
										io.to(member).emit("S_to_C_message", {sendmsg:("(狐チャット)"+msg),usrname:userHash[socket.id],emittime:genedate(),issys:5});
									}
								}else{//ゲームにいない場合
										io.to(member).emit("S_to_C_message", {sendmsg:("(狐チャット)"+msg),usrname:userHash[socket.id],emittime:genedate(),issys:5});
								}
							}
						}else{ //発言者がオオカミ・狐以外は独り言
							for(member in socket.adapter.rooms[userRoom[socket.id]].sockets){ //ルーム内のメンバーを捜索
								if(gamerole[userRoom[socket.id]].member[member]){//ゲームにいる場合
									if(member == socket.id){//socketと同じコードの人に送る
										io.to(member).emit("S_to_C_message", {sendmsg:("(独り言)"+msg),usrname:userHash[socket.id],emittime:genedate(),issys:5});
									}
								}else{//ゲームにいない場合
										io.to(member).emit("S_to_C_message", {sendmsg:("(独り言)"+msg),usrname:userHash[socket.id],emittime:genedate(),issys:5});
								}
							}
						}
					}else{ //昼・投票時間は生きている人は全員に聞こえるようにする
						io.sockets.in(userRoom[socket.id]).emit("S_to_C_message", {sendmsg:msg,usrname:userHash[socket.id],emittime:genedate(),issys:5});
					}
				}else{ //発言者が死んでいる場合
					console.log("発言者が死んでいる");
					for(member in socket.adapter.rooms[userRoom[socket.id]].sockets){ //ルームの中のmemberを捜索
						if(!of_array(member,gamerole[userRoom[socket.id]].member)){ //memberがゲームにいない場合だけ返す
							io.to(member).emit("S_to_C_message", {sendmsg:("(霊界チャット)"+msg),usrname:userHash[socket.id],emittime:genedate(),issys:5});
						}
					}
				}
			}else{//発言者がゲームにいない場合
				for(member in socket.adapter.rooms[userRoom[socket.id]].sockets){ //ルームの中のmemberを捜索
					if(!of_array(member,gamerole[userRoom[socket.id]].member)){ //memberがゲームにいない場合だけ返す いらんのでは？
						io.to(member).emit("S_to_C_message", {sendmsg:("(霊界チャット)"+msg),usrname:userHash[socket.id],emittime:genedate(),issys:5});
					}
				}
			}
		}else{ //ゲームが始まっていないとき
			io.sockets.in(userRoom[socket.id]).emit("S_to_C_message", {sendmsg:msg,usrname:userHash[socket.id],emittime:genedate(),issys:0});
		}
	});
	
	//ログインしていないと来たときログインしていない状態にする
	socket.on("notlogin", function(){
		socket.leave(userRoom[socket.id]);
		console.log("leave"+userRoom[socket.id]+userHash[socket.id]); //Debug
		delete userHash[socket.id];
		delete userRoom[socket.id];
	});
	
	socket.on("enmorning", function(){
		console.log("朝にさせようとしている");
		if(of_array(socket.id,adminHash)){
			var deaths={};
			var bite="";
			var see="";
			var guard="";
			for(member in gamerole[userRoom[socket.id]]["member"]){
				if(userHash[member] == gamerole[userRoom[socket.id]].wolfaction[gamerole[userRoom[socket.id]]["daycount"]]){//噛み先
						bite=member;
				}
				if(userHash[member] == gamerole[userRoom[socket.id]].seeraction[gamerole[userRoom[socket.id]]["daycount"]]){//占い先
						see=member;
				}
				if(userHash[member] == gamerole[userRoom[socket.id]].hunteraction[gamerole[userRoom[socket.id]]["daycount"]]){//噛み先
						guard=member;
				}
			}
			
			if(bite){
				if(bite!=guard && gamerole[userRoom[socket.id]]["member"][bite]["role"]!="fox"){ //狩人の守護先と噛み先が違い狐でない場合
					gamerole[userRoom[socket.id]]["member"][bite]["live"]=false;
					deaths[userHash[bite]]=true;
				}
			}
			if(see){
				if(gamerole[userRoom[socket.id]]["member"][see]["role"]=="fox"){ //占い先が狐のとき
					gamerole[userRoom[socket.id]]["member"][see]["live"]=false;
					deaths[userHash[see]]=true;
				}
			}
			
			console.log("朝の死者");
			console.log(deaths);
			
			var morningmsg="";
			if(Object.keys(deaths).length){
				morningmsg="朝になると、"
				for(member in deaths){
					morningmsg=morningmsg+member+"さんの無残な死体が発見されました。<br />";
				}
			}else{
				morningmsg="平和な朝を迎えました。";
			}
			
			io.sockets.in(userRoom[socket.id]).emit("S_to_C_message",{sendmsg:morningmsg,issys:4});
			
			gamerole[userRoom[socket.id]].daytime=0;
			gamerole[userRoom[socket.id]]["daycount"]++;
			var livingpeople={};
			var sidecount={wolf:0,fox:0,man:0};
			for(member in gamerole[userRoom[socket.id]]["member"]){
				livingpeople[gameHash[userRoom[socket.id]][member]]=gamerole[userRoom[socket.id]]["member"][member]["live"];
				if(gamerole[userRoom[socket.id]]["member"][member]["live"] && (gamerole[userRoom[socket.id]]["member"][member]["role"]=="werewolf")){
					sidecount.wolf++;
				}else if(gamerole[userRoom[socket.id]]["member"][member]["live"] && (gamerole[userRoom[socket.id]]["member"][member]["role"]=="fox")){
					sidecount.fox++;
				}else if(gamerole[userRoom[socket.id]]["member"][member]["live"]){
					sidecount.man++;
				}
			}
			var judgement=judge(sidecount.wolf,sidecount.fox,sidecount.man);
			if(judgement.end){
				io.sockets.in(userRoom[socket.id]).emit("S_to_C_message",{sendmsg:judgement.endmsg,issys:4});
			}
			console.log(sidecount);
			console.log(judgement);
			
			io.sockets.in(userRoom[socket.id]).emit("morning",{daycount:gamerole[userRoom[socket.id]]["daycount"],wholive:livingpeople});
			
			
			console.log("朝にさせた、朝のゲームの状況");
			console.log(gamerole[userRoom[socket.id]]);
			console.log("人狼");
			console.log(gamerole[userRoom[socket.id]].wolfaction);
			console.log("占い師");
			console.log(gamerole[userRoom[socket.id]].seeraction);
			console.log("狩人");
			console.log(gamerole[userRoom[socket.id]].hunteraction);
			console.log("以上");
		}
	});
	
	
	socket.on("envote", function(){
		console.log("投票時間にさせようとしている");
		if(of_array(socket.id,adminHash)){
			gamerole[userRoom[socket.id]].daytime=1;
			gamerole[userRoom[socket.id]]["votecount"]=1;
			var livingpeople={};
			var sidecount={wolf:0,fox:0,man:0};
			for(member in gamerole[userRoom[socket.id]]["member"]){
				gamerole[userRoom[socket.id]]["member"][member]["vote"][gamerole[userRoom[socket.id]]["daycount"]]={1:""};//日数の投票先1回目を空にする
				livingpeople[gameHash[userRoom[socket.id]][member]]=gamerole[userRoom[socket.id]]["member"][member]["live"];
				if(gamerole[userRoom[socket.id]]["member"][member]["live"] && (gamerole[userRoom[socket.id]]["member"][member]["role"]=="werewolf")){
					sidecount.wolf++;
				}else if(gamerole[userRoom[socket.id]]["member"][member]["live"] && (gamerole[userRoom[socket.id]]["member"][member]["role"]=="fox")){
					sidecount.fox++;
				}else if(gamerole[userRoom[socket.id]]["member"][member]["live"]){
					sidecount.man++;
				}
			}
			var judgement=judge(sidecount.wolf,sidecount.fox,sidecount.man);
			if(judgement.end){
				io.sockets.in(userRoom[socket.id]).emit("S_to_C_message",{sendmsg:judgement.endmsg,issys:4});
			}
			console.log(sidecount);
			console.log(judgement);
			
			io.sockets.in(userRoom[socket.id]).emit("vote",{daycount:gamerole[userRoom[socket.id]]["daycount"],wholive:livingpeople});
		}
	});
	socket.on("envoteend", function(){
		console.log("投票を締め切ろうとしている");
		if(of_array(socket.id,adminHash)){
			var livingpeople={};
			var votelist={};
			var sidecount={wolf:0,fox:0,man:0};
			for(member in gamerole[userRoom[socket.id]]["member"]){
				livingpeople[gameHash[userRoom[socket.id]][member]]=gamerole[userRoom[socket.id]]["member"][member]["live"];
				votelist[member]=gamerole[userRoom[socket.id]]["member"][member]["vote"][gamerole[userRoom[socket.id]]["daycount"]][gamerole[userRoom[socket.id]]["votecount"]];
				if(gamerole[userRoom[socket.id]]["member"][member]["live"] && (gamerole[userRoom[socket.id]]["member"][member]["role"]=="werewolf")){
					sidecount.wolf++;
				}else if(gamerole[userRoom[socket.id]]["member"][member]["live"] && (gamerole[userRoom[socket.id]]["member"][member]["role"]=="fox")){
					sidecount.fox++;
				}else if(gamerole[userRoom[socket.id]]["member"][member]["live"]){
					sidecount.man++;
				}
			}
			var votemsg="";
			var mostvote=0;
			var mostvoteplayer="";
			var mostcount=0;
			var votedcount={};
			var votedmember={};
			for(member in votelist){
				votedcount[member]=in_array(userHash[member],votelist);
				votemsg=votemsg+userHash[member]+"さんの投票先："+votelist[member]+"<br />";
				if(mostvote<votedcount[member]){
					mostvoteplayer=member;
					mostvote=votedcount[member];
					mostcount=0;
				}else if(mostvote==votedcount[member]){
					mostvoteplayer=member;
					mostvote=votedcount[member];
					mostcount++;
				}
			}
			if(mostcount==0){
				if(gamerole[userRoom[socket.id]]["member"][mostvoteplayer]){//ゲーム参加者だった場合
					gamerole[userRoom[socket.id]]["member"][mostvoteplayer]["live"]=false;
				}
				gamerole[userRoom[socket.id]]["votekill"][gamerole[userRoom[socket.id]]["daycount"]]=mostvoteplayer;
				io.sockets.in(userRoom[socket.id]).emit("S_to_C_message",{sendmsg:gamerole[userRoom[socket.id]].daycount+"日目"+gamerole[userRoom[socket.id]].votecount+"回目の投票結果 "+userHash[mostvoteplayer]+"さんが処刑されます。<br />"+votemsg,issys:4});
				io.sockets.in(userRoom[socket.id]).emit("voteend",{daycount:gamerole[userRoom[socket.id]]["daycount"],wholive:livingpeople});
				gamerole[userRoom[socket.id]].daytime=2;
				
			}else{
				
				io.sockets.in(userRoom[socket.id]).emit("S_to_C_message",{sendmsg:gamerole[userRoom[socket.id]].daycount+"日目"+gamerole[userRoom[socket.id]].votecount+"回目の投票結果 同票の方がいます。<br />"+votemsg,issys:4});
				io.sockets.in(userRoom[socket.id]).emit("vote",{daycount:gamerole[userRoom[socket.id]]["daycount"],wholive:livingpeople});
				gamerole[userRoom[socket.id]].votecount++;
				io.sockets.in(userRoom[socket.id]).emit("S_to_C_message",{sendmsg:gamerole[userRoom[socket.id]].daycount+"日目"+gamerole[userRoom[socket.id]].votecount+"回目の投票を開始します。",issys:2});
			}
			console.log(votelist);
			console.log(votedcount);
			console.log("最多得票者"+userHash[mostvoteplayer]+" mostcount"+mostcount);
			
			
		}
	});
	socket.on("ennight", function(){
		console.log("夜にさせようとしている");
		if(of_array(socket.id,adminHash)){
			var livingpeople={};
			var playerroles={};
			gamerole[userRoom[socket.id]].daytime=3;
			gamerole[userRoom[socket.id]]["votecount"]=0;
			var sidecount={wolf:0,fox:0,man:0};
			for(member in gamerole[userRoom[socket.id]]["member"]){
				livingpeople[gameHash[userRoom[socket.id]][member]]=gamerole[userRoom[socket.id]]["member"][member]["live"];
				playerroles[gameHash[userRoom[socket.id]][member]]=gamerole[userRoom[socket.id]]["member"][member]["role"];
				if(gamerole[userRoom[socket.id]]["member"][member]["live"] && (gamerole[userRoom[socket.id]]["member"][member]["role"]=="werewolf")){
					sidecount.wolf++;
				}else if(gamerole[userRoom[socket.id]]["member"][member]["live"] && (gamerole[userRoom[socket.id]]["member"][member]["role"]=="fox")){
					sidecount.fox++;
				}else if(gamerole[userRoom[socket.id]]["member"][member]["live"]){
					sidecount.man++;
				}
			}
			var judgement=judge(sidecount.wolf,sidecount.fox,sidecount.man);
			if(judgement.end){
				io.sockets.in(userRoom[socket.id]).emit("S_to_C_message",{sendmsg:judgement.endmsg,issys:4});
			}
			
			var mediumresult="○";
			var votekilled=gamerole[userRoom[socket.id]]["votekill"][gamerole[userRoom[socket.id]]["daycount"]];
			var votekilledrole=gamerole[userRoom[socket.id]].member[votekilled].role;
			if(votekilledrole == "werewolf"){
				mediumresult="●";
			}
			console.log(sidecount);
			console.log(judgement);
			
			io.sockets.in(userRoom[socket.id]).emit("night",{daycount:gamerole[userRoom[socket.id]]["daycount"],wholive:livingpeople,playerrole:playerroles,medium:mediumresult,mediumto:userHash[votekilled]});
		}
	});



  // 切断したときに送信
	socket.on("disconnect", function (data) {
		if(adminHash[socket.id]){ //roommasterが切断した場合、ルームの全員切断させる
			var leaveroom=userRoom[socket.id];
			var adminname=userHash[socket.id];
			var msg="管理者："+adminname+"が退出したため、ルームを削除しました。";
			io.sockets.in(leaveroom).emit("errmsg", {sendmsg:msg , issys:1});
			delete userHash[socket.id];
			delete userRoom[socket.id];
			delete gamerole[socket.id];
			delete gameHash[socket.id];
			delete adminHash[socket.id];
			console.log(userRoom);
		}else if (userHash[socket.id]) {//roomに入っている場合、情報を削除
			
			var msg = userHash[socket.id] + "さんが退出しました";
			var leaveroom=userRoom[socket.id];
			if(gamerole[leaveroom]){//ゲームが開始していた場合
				console.log("開始してる");
				if(gamerole[leaveroom]["member"][socket.id]){//ゲーム参加者だった場合
					console.log("参加者");
					if(gamerole[leaveroom]["member"][socket.id]["live"]){//生存者だった場合
						console.log("生存者");
						gamerole[leaveroom]["member"][socket.id]["live"]=false;
						msg = userHash[socket.id] + "さんが突然死しました。(切断)";
					}
				}
			}
			console.log(socket.id+"  room disconnect"); //Debug disconnectのidをconsoleに流す
			console.log(socket.adapter.rooms[leaveroom]); //debug leaveroomの配列を流す
			if(socket.adapter.rooms[leaveroom]){//よくわからんけどroomに人がいれば抜けた後の情報を送る
				var memberno=0;
				var memberlist={};
				for (member in socket.adapter.rooms[leaveroom].sockets){
					memberlist[memberno]=userHash[member];
					console.log("disconnectした時の"+leaveroom+"の"+member); //debug
					memberno++;
				}
				delete userHash[socket.id];
				delete userRoom[socket.id];
				io.sockets.in(leaveroom).emit("roommember", {members: memberlist});
				io.sockets.in(leaveroom).emit("S_to_C_message", {sendmsg: msg,issys: 1,emittime:genedate()});
			}else{//roomに人がいなければ消すだけ(多分起こらない)
				delete userHash[socket.id];
				delete userRoom[socket.id];
			}
		}else{
			console.log(socket.id+"  noroom disconnect");
		}
		console.log(userHash);
		console.log(userRoom);
	});

}); //Socket終了


//2桁に直す
var toDoubleDigits = function(num) {
  num += "";
  if (num.length === 1) {
    num = "0" + num;
  }
 return num;     
};
 
// 日付をYYYY/MM/DD HH:DD:MI:SS形式で取得
var genedate = function() {
  var date = new Date();
  var yyyy = date.getFullYear();
  var mm = toDoubleDigits(date.getMonth() + 1);
  var dd = toDoubleDigits(date.getDate());
  var hh = toDoubleDigits(date.getHours());
  var mi = toDoubleDigits(date.getMinutes());
  var ss = toDoubleDigits(date.getSeconds());
  return yyyy + '/' + mm + '/' + dd + ' ' + hh + ':' + mi + ":" + ss;
};

//オブジェクト系関数
function in_array(element,arrayvalue) {
	var isinarray=0;
    for(ekf in arrayvalue) {
        if(arrayvalue[ekf] == element) {//第一引数が、オブジェクトの要素と一致するものがあればカウント
            isinarray++;
        }
    }
	return isinarray;
}
function of_array(element,arrayvalue) {
	var isinarray=0;
    for(ekf in arrayvalue) {
        if(ekf == element) {//第一引数が、オブジェクト名と一致するものがあればカウント
            isinarray++;
        }
    }
	return isinarray;
}
function shuffle(arrayvalue) {
	for(var i = arrayvalue.length - 1; i > 0; i--){
		var r = Math.floor(Math.random() * (i + 1));
		var tmp = arrayvalue[i];
		arrayvalue[i] = arrayvalue[r];
		arrayvalue[r] = tmp;
	}
	return arrayvalue;
}
function pusharray(numbers,element,arrayvalue){
	for(var i= numbers; i>0 ;i--){
		arrayvalue.push(element);
	}
	return arrayvalue;
}
function judge(wolf,fox,man){
	var judgereturn={};
	if(man <= wolf){
		if(fox){
			judgereturn={end:true, endmsg:"妖狐陣営の勝利です。"};
		}else{
			judgereturn={end:true, endmsg:"人狼陣営の勝利です。"};
		}
	}else if(wolf<1){
		if(fox){
			judgereturn={end:true, endmsg:"妖狐陣営の勝利です。"};
		}else{
			judgereturn={end:true, endmsg:"村人陣営の勝利です。"};
		}
	}else{
		judgereturn={end:false, emdmsg:""};
	}
	return judgereturn;
}