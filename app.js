const http = require('http');
const socketio = require('socket.io');
const fs = require('fs');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  const output = fs.readFileSync('./index.html', 'utf-8');
  res.end(output);
}).listen(process.env.PORT || 3000);
const io = socketio.listen(server);
io.set('heartbeat interval', 5000);
io.set('heartbeat timeout', 15000);
const userHash = {};// 接続しているclientのHash:名前で格納
const gameHash = {};// ゲーム開始時の、ルーム名:{clientのHash:名前} で格納userHashが接続が切れた際に消すため
const userRoom = {};// 接続しているclientのHash:ルーム名で格納
const adminHash = {};// ルームマスターのHash:名前で格納
const RoomList = ['room1', 'room2'];// まだ固定
const countdown = {};// 後々使うかも
const gamestates = {};// ゲームの情報を格納。
// ルーム名:{daycount:ゲーム内の日数
//　　　　  member:{ゲーム参加者(開始時点,socketidで書く):{role:役職,
//　　　　　　　　　　　　　　　　　　　　　　live:生きているかどうか(true/false);
//                 }
//　　　　　}で格納してる


io.sockets.on('connection', (socket) => { // Socket開始
  if (!userRoom[socket.id]) {
    socket.join('notjoinroom');
    socket.emit('roomlists', { rooms: 'あるよ' });
    console.log(`${socket.id}がNJRにjoin`); // Debug notjoinroomにjoinした名前を垂れ流す
  } else {
    socket.connect();
  } // ノンエントリー状態 //ノンエントリーの人に部屋情報を送信

	// 2つ以上のroomに入っている場合、エラーメッセージを送信する機能をつける

	// roomに入室
  socket.on('connected', (usr) => {
		// socketの名前を受信。htmlのタグ要素と改行、スペースを消す
    const socketsname = sanitize(usr.sendmsg,1);
    if (!in_array(usr.roomname, RoomList)) { // RoomList配列にない名前はNG
      var msg = '該当する部屋は存在しません。';
      socket.emit('errmsg', { sendmsg: msg, issys: 1 });
    } else if (socketsname.length < 2 || socketsname.length > 10) { // 2〜10文字以外の名前はNG
      var msg = '2文字以上10文字以下の名前を入力してください';
      socket.emit('errmsg', { sendmsg: msg, issys: 1 });
    } else if ((in_array(socketsname, userHash) && in_array(usr.roomname, userRoom))) { // 同じ名前は入室NG
      var msg = `ルーム：${usr.roomname} に同じ名前の人がいます：${socketsname}`;
      socket.emit('errmsg', { sendmsg: msg, issys: 1 });
    } else {
      var msg = `${socketsname}さんが入室しました`;
      userHash[socket.id] = socketsname;
      userRoom[socket.id] = usr.roomname;
      socket.leave('notjoinroom');// ノンエントリー状態とおさらば
      socket.join(userRoom[socket.id]);// roomにjoin

			// roomのmemberリストを送信
      let memberno = 0;
      const memberlist = {};
      for (member in socket.adapter.rooms[usr.roomname].sockets) {
        memberlist[memberno] = userHash[member];
        console.log(member);
        memberno++;
      }
      if (memberno == 1) {
        socket.emit('S_to_C_message', { sendmsg: 'あなたが管理者です。', issys: 2, emittime: genedate() });
        socket.emit('to_admin', '');
        adminHash[socket.id] = userRoom[socket.id];
      }
      console.log(memberlist);
      io.sockets.in(userRoom[socket.id]).emit('roommember', { members: memberlist });
			// roomへ入室のシステムメッセージ
      io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: msg, issys: 3, emittime: genedate() });
    }
  });

	// ルームマスターからのconfigを取得
  socket.on('config', (data) => {
		// s.emit("config", {werewolf:$("#werewolf").val(),madman:$("#madman").val(),fox:$("#fox").val(),seer:$("#seer").val(),medium:$("#medium").val(),hunter:$("#hunter").val(),villager:$("#villager").val(),daytime:$("#daytime").val(),nighttime:$("#nighttime").val(),gmmode:isgmmode});
    let isgmmode = '';
    let roomname = userRoom[socket.id];
    if (data.gmmode) { isgmmode = 'ON'; } else { isgmmode = 'OFF'; }
    const members = socket.adapter.rooms[roomname].sockets;
    let suc = game.start(roomname, members, data);

    if (!suc) {
      socket.emit('S_to_C_message', { sendmsg: 'ルーム内の人数が配役より少ないため、チャットを開始できません。', issys: 1 });
    } else { // else ifで勝利条件判定trueの場合、だめって返すようにしたい
      //let i = 0;
      for (member in members) {
        const ismaster = (socket.id == member);
        io.to(member).emit('gamestart', { role: gamestates[roomname].member[member].role, master: ismaster, yourname: userHash[member] });

        //i++;
        //if (numplayer <= i) { // ルームにいる人のほうが多かったら途中でbreak
        //  break;
        //}
      }

      const livingpeople = {};
      const playerroles = {};
      for (member in gamestates[userRoom[socket.id]].member) {
        livingpeople[userHash[member]] = gamestates[userRoom[socket.id]].member[member].live;
        playerroles[userHash[member]] = gamestates[userRoom[socket.id]].member[member].role;
      }
      io.sockets.in(userRoom[socket.id]).emit('night', { daycount: gamestates[userRoom[socket.id]].daycount, wholive: livingpeople, playerrole: playerroles, daycount: gamestates[userRoom[socket.id]].daycount });

    }
  });

	// 投票を受信
  socket.on('voting', (data) => {
    let performer = socket.id;
    let room = userRoom[socket.id];


    let suc = game.vote(room, performer, data);
    if (suc.complete) { //投票が成功したか
      if (suc.change) {
        socket.emit('S_to_C_message', { sendmsg: `投票を${suc.votefor}さんに変えました。`, issys: 2 });
      } else {
        socket.emit('S_to_C_message', { sendmsg: `${suc.votefor}さんに投票しました。`, issys: 2 });
      }
				// gamestatesのルームのメンバーの投票先の日数の投票回数のところを投票先にする
    } else {
      if(suc.errortype==1){
        socket.emit('S_to_C_message', { sendmsg: `${suc.votefor}さんには投票できません。`, issys: 1 });
      }else{
        socket.emit('S_to_C_message', { sendmsg: '投票先を選んでください。', issys: 1 });
      }
    }
  });

	// 役職の行動を受信
  socket.on('roleaction', (data) => {
    if (data.to) {
      if (gamestates[userRoom[socket.id]].member[socket.id].role == 'werewolf') { // 送信元が人狼
        gamestates[userRoom[socket.id]].wolfaction[gamestates[userRoom[socket.id]].daycount] = data.to; // 人狼のn日目の実行先を格納
        for (member in socket.adapter.rooms[userRoom[socket.id]].sockets) {
          if (gamestates[userRoom[socket.id]].member[member]) { // ゲームにいる場合
            if (gamestates[userRoom[socket.id]].member[member].role == 'werewolf') { // memberが人狼のときだけメッセージを送る
              io.to(member).emit('jobcomplete', { day: gamestates[userRoom[socket.id]].daycount, job: 'werewolf', to: data.to });
              console.log({ day: gamestates[userRoom[socket.id]].daycount, job: 'werewolf', to: data.to });
            }
          }
        }
      } else if (gamestates[userRoom[socket.id]].member[socket.id].role == 'seer') { // 送信元が占い師
        gamestates[userRoom[socket.id]].seeraction[gamestates[userRoom[socket.id]].daycount] = data.to; // 占い師のn日目の実行先を格納
        let neko = '';
        for (member in gamestates[userRoom[socket.id]].member) {
          if (userHash[member] == data.to) {
            if (gamestates[userRoom[socket.id]].member[member].role == 'werewolf') {
              neko = '●';
            } else {
              neko = '○';
            }
          }
        }
        socket.emit('jobcomplete', { day: gamestates[userRoom[socket.id]].daycount, job: 'seer', result: neko, to: data.to });
        console.log({ day: gamestates[userRoom[socket.id]].daycount, job: 'seer', result: neko, to: data.to });
      } else if (gamestates[userRoom[socket.id]].member[socket.id].role == 'hunter') {
        gamestates[userRoom[socket.id]].hunteraction[gamestates[userRoom[socket.id]].daycount] = data.to; // 狩人のn日目の実行先を格納
        socket.emit('jobcomplete', { day: gamestates[userRoom[socket.id]].daycount, job: 'hunter', result: '', to: data.to });
        console.log({ day: gamestates[userRoom[socket.id]].daycount, job: 'hunter', result: '' });
      }
    } else {
      socket.emit('S_to_C_message', { sendmsg: '実行先を選んでください。', issys: 1 });
    }
  });

    // 受信したメッセージをルームに送信 人狼ルーム、狐ルームとかに分けたほうがいいのでは？
  socket.on('C_to_S_message', (data) => {
    const msg = sanitize(data.sendmsg,0);
    if (gamestates[userRoom[socket.id]]) { // ゲーム開始時
      if (of_array(socket.id, gamestates[userRoom[socket.id]].member)) { // 発言者がゲームにいる場合
        if (gamestates[userRoom[socket.id]].member[socket.id].live) { // 発言者が生きている場合
          console.log('発言者が生きている');
          if (gamestates[userRoom[socket.id]].daytime == 3) { // 夜時間
            if (gamestates[userRoom[socket.id]].member[socket.id].role == 'werewolf') { // 発言者が人狼
              for (member in socket.adapter.rooms[userRoom[socket.id]].sockets) { // ルーム内のメンバーを捜索
                if (gamestates[userRoom[socket.id]].member[member]) { // ゲームにいる場合
                  if (gamestates[userRoom[socket.id]].member[member].role == 'werewolf') { // memberが人狼のときだけメッセージを送る
                    io.to(member).emit('S_to_C_message', { sendmsg: (`(人狼チャット)${msg}`), usrname: userHash[socket.id], emittime: genedate(), issys: 5 });
                  }
                } else { // ゲームにいない場合
                  io.to(member).emit('S_to_C_message', { sendmsg: (`(人狼チャット)${msg}`), usrname: userHash[socket.id], emittime: genedate(), issys: 5 });
                }
              }
            } else if (gamestates[userRoom[socket.id]].member[socket.id].role == 'fox') { // 発言者が狐
              for (member in socket.adapter.rooms[userRoom[socket.id]].sockets) { // ルーム内のメンバーを捜索
                if (gamestates[userRoom[socket.id]].member[member]) { // ゲームにいる場合
                  if (gamestates[userRoom[socket.id]].member[member].role == 'fox') { // memberが狐のときだけメッセージを送る
                    io.to(member).emit('S_to_C_message', { sendmsg: (`(狐チャット)${msg}`), usrname: userHash[socket.id], emittime: genedate(), issys: 5 });
                  }
                } else { // ゲームにいない場合
                  io.to(member).emit('S_to_C_message', { sendmsg: (`(狐チャット)${msg}`), usrname: userHash[socket.id], emittime: genedate(), issys: 5 });
                }
              }
            } else { // 発言者がオオカミ・狐以外は独り言
              for (member in socket.adapter.rooms[userRoom[socket.id]].sockets) { // ルーム内のメンバーを捜索
                if (gamestates[userRoom[socket.id]].member[member]) { // ゲームにいる場合
                  if (member == socket.id) { // socketと同じコードの人に送る
                    io.to(member).emit('S_to_C_message', { sendmsg: (`(独り言)${msg}`), usrname: userHash[socket.id], emittime: genedate(), issys: 5 });
                  }
                } else { // ゲームにいない場合
                  io.to(member).emit('S_to_C_message', { sendmsg: (`(独り言)${msg}`), usrname: userHash[socket.id], emittime: genedate(), issys: 5 });
                }
              }
            }
          } else { // 昼・投票時間は生きている人は全員に聞こえるようにする
            io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: msg, usrname: userHash[socket.id], emittime: genedate(), issys: 5 });
          }
        } else { // 発言者が死んでいる場合
          console.log('発言者が死んでいる');
          for (member in socket.adapter.rooms[userRoom[socket.id]].sockets) { // ルームの中のmemberを捜索
            if (!of_array(member, gamestates[userRoom[socket.id]].member)) { // memberがゲームにいない場合だけ返す
              io.to(member).emit('S_to_C_message', { sendmsg: (`(霊界チャット)${msg}`), usrname: userHash[socket.id], emittime: genedate(), issys: 5 });
            }
          }
        }
      } else { // 発言者がゲームにいない場合
        for (member in socket.adapter.rooms[userRoom[socket.id]].sockets) { // ルームの中のmemberを捜索
          if (!of_array(member, gamestates[userRoom[socket.id]].member)) { // memberがゲームにいない場合だけ返す いらんのでは？
            io.to(member).emit('S_to_C_message', { sendmsg: (`(霊界チャット)${msg}`), usrname: userHash[socket.id], emittime: genedate(), issys: 5 });
          }
        }
      }
    } else { // ゲームが始まっていないとき
      io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: msg, usrname: userHash[socket.id], emittime: genedate(), issys: 0 });
    }
  });

	// ログインしていないと来たときログインしていない状態にする
  socket.on('notlogin', () => {
    socket.leave(userRoom[socket.id]);
    console.log(`leave${userRoom[socket.id]}${userHash[socket.id]}`); // Debug
    delete userHash[socket.id];
    delete userRoom[socket.id];
  });

  socket.on('enmorning', () => {
    console.log('朝にさせようとしている');
    if (of_array(socket.id, adminHash)) {
      const deaths = {};
      let bite = '';
      let see = '';
      let guard = '';
      for (member in gamestates[userRoom[socket.id]].member) {
        if (userHash[member] == gamestates[userRoom[socket.id]].wolfaction[gamestates[userRoom[socket.id]].daycount]) { // 噛み先
          bite = member;
        }
        if (userHash[member] == gamestates[userRoom[socket.id]].seeraction[gamestates[userRoom[socket.id]].daycount]) { // 占い先
          see = member;
        }
        if (userHash[member] == gamestates[userRoom[socket.id]].hunteraction[gamestates[userRoom[socket.id]].daycount]) { // 噛み先
          guard = member;
        }
      }

      if (bite) {
        if (bite != guard && gamestates[userRoom[socket.id]].member[bite].role != 'fox') { // 狩人の守護先と噛み先が違い狐でない場合
          gamestates[userRoom[socket.id]].member[bite].live = false;
          deaths[userHash[bite]] = true;
        }
      }
      if (see) {
        if (gamestates[userRoom[socket.id]].member[see].role == 'fox') { // 占い先が狐のとき
          gamestates[userRoom[socket.id]].member[see].live = false;
          deaths[userHash[see]] = true;
        }
      }

      console.log('朝の死者');
      console.log(deaths);

      let morningmsg = '';
      if (Object.keys(deaths).length) {
        morningmsg = '朝になると、';
        for (member in deaths) {
          morningmsg = `${morningmsg + member}さんの無残な死体が発見されました。<br />`;
        }
      } else {
        morningmsg = '平和な朝を迎えました。';
      }

      io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: morningmsg, issys: 4 });

      gamestates[userRoom[socket.id]].daytime = 0;
      gamestates[userRoom[socket.id]].daycount++;
      const livingpeople = {};
      const sidecount = { wolf: 0, fox: 0, man: 0 };
      for (member in gamestates[userRoom[socket.id]].member) {
        livingpeople[gameHash[userRoom[socket.id]][member]] = gamestates[userRoom[socket.id]].member[member].live;
        if (gamestates[userRoom[socket.id]].member[member].live && (gamestates[userRoom[socket.id]].member[member].role == 'werewolf')) {
          sidecount.wolf++;
        } else if (gamestates[userRoom[socket.id]].member[member].live && (gamestates[userRoom[socket.id]].member[member].role == 'fox')) {
          sidecount.fox++;
        } else if (gamestates[userRoom[socket.id]].member[member].live) {
          sidecount.man++;
        }
      }
      const judgement = judge(sidecount.wolf, sidecount.fox, sidecount.man);
      if (judgement.end) {
        io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: judgement.endmsg, issys: 4 });
      }
      console.log(sidecount);
      console.log(judgement);

      io.sockets.in(userRoom[socket.id]).emit('morning', { daycount: gamestates[userRoom[socket.id]].daycount, wholive: livingpeople });


      console.log('朝にさせた、朝のゲームの状況');
      console.log(gamestates[userRoom[socket.id]]);
      console.log('人狼');
      console.log(gamestates[userRoom[socket.id]].wolfaction);
      console.log('占い師');
      console.log(gamestates[userRoom[socket.id]].seeraction);
      console.log('狩人');
      console.log(gamestates[userRoom[socket.id]].hunteraction);
      console.log('以上');
    }
  });


  socket.on('envote', () => {
    console.log('投票時間にさせようとしている');
    if (of_array(socket.id, adminHash)) {
      gamestates[userRoom[socket.id]].daytime = 1;
      gamestates[userRoom[socket.id]].votecount = 1;
      const livingpeople = {};
      const sidecount = { wolf: 0, fox: 0, man: 0 };
      for (member in gamestates[userRoom[socket.id]].member) {
        gamestates[userRoom[socket.id]].member[member].vote[gamestates[userRoom[socket.id]].daycount] = { 1: '' };// 日数の投票先1回目を空にする
        livingpeople[gameHash[userRoom[socket.id]][member]] = gamestates[userRoom[socket.id]].member[member].live;
        if (gamestates[userRoom[socket.id]].member[member].live && (gamestates[userRoom[socket.id]].member[member].role == 'werewolf')) {
          sidecount.wolf++;
        } else if (gamestates[userRoom[socket.id]].member[member].live && (gamestates[userRoom[socket.id]].member[member].role == 'fox')) {
          sidecount.fox++;
        } else if (gamestates[userRoom[socket.id]].member[member].live) {
          sidecount.man++;
        }
      }
      const judgement = judge(sidecount.wolf, sidecount.fox, sidecount.man);
      if (judgement.end) {
        io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: judgement.endmsg, issys: 4 });
      }
      console.log(sidecount);
      console.log(judgement);

      io.sockets.in(userRoom[socket.id]).emit('vote', { daycount: gamestates[userRoom[socket.id]].daycount, wholive: livingpeople });
    }
  });
  socket.on('envoteend', () => {
    console.log('投票を締め切ろうとしている');
    if (of_array(socket.id, adminHash)) {
      const livingpeople = {};
      const votelist = {};
      const sidecount = { wolf: 0, fox: 0, man: 0 };
      for (member in gamestates[userRoom[socket.id]].member) {
        livingpeople[gameHash[userRoom[socket.id]][member]] = gamestates[userRoom[socket.id]].member[member].live;
        votelist[member] = gamestates[userRoom[socket.id]].member[member].vote[gamestates[userRoom[socket.id]].daycount][gamestates[userRoom[socket.id]].votecount];
        if (gamestates[userRoom[socket.id]].member[member].live && (gamestates[userRoom[socket.id]].member[member].role == 'werewolf')) {
          sidecount.wolf++;
        } else if (gamestates[userRoom[socket.id]].member[member].live && (gamestates[userRoom[socket.id]].member[member].role == 'fox')) {
          sidecount.fox++;
        } else if (gamestates[userRoom[socket.id]].member[member].live) {
          sidecount.man++;
        }
      }
      let votemsg = '';
      let mostvote = 0;
      let mostvoteplayer = '';
      let mostcount = 0;
      const votedcount = {};
      const votedmember = {};
      for (member in votelist) {
        votedcount[member] = in_array(userHash[member], votelist);
        votemsg = `${votemsg + userHash[member]}さんの投票先：${votelist[member]}<br />`;
        if (mostvote < votedcount[member]) {
          mostvoteplayer = member;
          mostvote = votedcount[member];
          mostcount = 0;
        } else if (mostvote == votedcount[member]) {
          mostvoteplayer = member;
          mostvote = votedcount[member];
          mostcount++;
        }
      }
      if (mostcount == 0) {
        if (gamestates[userRoom[socket.id]].member[mostvoteplayer]) { // ゲーム参加者だった場合
          gamestates[userRoom[socket.id]].member[mostvoteplayer].live = false;
        }
        gamestates[userRoom[socket.id]].votekill[gamestates[userRoom[socket.id]].daycount] = mostvoteplayer;
        io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: `${gamestates[userRoom[socket.id]].daycount}日目${gamestates[userRoom[socket.id]].votecount}回目の投票結果 ${userHash[mostvoteplayer]}さんが処刑されます。<br />${votemsg}`, issys: 4 });
        io.sockets.in(userRoom[socket.id]).emit('voteend', { daycount: gamestates[userRoom[socket.id]].daycount, wholive: livingpeople });
        gamestates[userRoom[socket.id]].daytime = 2;
      } else {
        io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: `${gamestates[userRoom[socket.id]].daycount}日目${gamestates[userRoom[socket.id]].votecount}回目の投票結果 同票の方がいます。<br />${votemsg}`, issys: 4 });
        io.sockets.in(userRoom[socket.id]).emit('vote', { daycount: gamestates[userRoom[socket.id]].daycount, wholive: livingpeople });
        gamestates[userRoom[socket.id]].votecount++;
        io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: `${gamestates[userRoom[socket.id]].daycount}日目${gamestates[userRoom[socket.id]].votecount}回目の投票を開始します。`, issys: 2 });
      }
      console.log(votelist);
      console.log(votedcount);
      console.log(`最多得票者${userHash[mostvoteplayer]} mostcount${mostcount}`);
    }
  });
  socket.on('ennight', () => {
    console.log('夜にさせようとしている');
    if (of_array(socket.id, adminHash)) {
      const livingpeople = {};
      const playerroles = {};
      gamestates[userRoom[socket.id]].daytime = 3;
      gamestates[userRoom[socket.id]].votecount = 0;
      const sidecount = { wolf: 0, fox: 0, man: 0 };
      for (member in gamestates[userRoom[socket.id]].member) {
        livingpeople[gameHash[userRoom[socket.id]][member]] = gamestates[userRoom[socket.id]].member[member].live;
        playerroles[gameHash[userRoom[socket.id]][member]] = gamestates[userRoom[socket.id]].member[member].role;
        if (gamestates[userRoom[socket.id]].member[member].live && (gamestates[userRoom[socket.id]].member[member].role == 'werewolf')) {
          sidecount.wolf++;
        } else if (gamestates[userRoom[socket.id]].member[member].live && (gamestates[userRoom[socket.id]].member[member].role == 'fox')) {
          sidecount.fox++;
        } else if (gamestates[userRoom[socket.id]].member[member].live) {
          sidecount.man++;
        }
      }
      const judgement = judge(sidecount.wolf, sidecount.fox, sidecount.man);
      if (judgement.end) {
        io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: judgement.endmsg, issys: 4 });
      }

      let mediumresult = '○';
      const votekilled = gamestates[userRoom[socket.id]].votekill[gamestates[userRoom[socket.id]].daycount];
      const votekilledrole = gamestates[userRoom[socket.id]].member[votekilled].role;
      if (votekilledrole == 'werewolf') {
        mediumresult = '●';
      }
      console.log(sidecount);
      console.log(judgement);

      io.sockets.in(userRoom[socket.id]).emit('night', { daycount: gamestates[userRoom[socket.id]].daycount, wholive: livingpeople, playerrole: playerroles, medium: mediumresult, mediumto: userHash[votekilled] });
    }
  });


  // 切断したときに送信
  socket.on('disconnect', (data) => {
    if (adminHash[socket.id]) { // roommasterが切断した場合、ルームの全員切断させる
      var leaveroom = userRoom[socket.id];
      const adminname = userHash[socket.id];
      var msg = `管理者：${adminname}が退出したため、ルームを削除しました。`;
      io.sockets.in(leaveroom).emit('errmsg', { sendmsg: msg, issys: 1 });
      delete userHash[socket.id];
      delete userRoom[socket.id];
      delete gamestates[socket.id];
      delete gameHash[socket.id];
      delete adminHash[socket.id];
      console.log(userRoom);
    } else if (userHash[socket.id]) {
 // roomに入っている場合、情報を削除

      var msg = `${userHash[socket.id]}さんが退出しました`;
      var leaveroom = userRoom[socket.id];
      if (gamestates[leaveroom]) { // ゲームが開始していた場合
        console.log('開始してる');
        if (gamestates[leaveroom].member[socket.id]) { // ゲーム参加者だった場合
          console.log('参加者');
          if (gamestates[leaveroom].member[socket.id].live) { // 生存者だった場合
            console.log('生存者');
            gamestates[leaveroom].member[socket.id].live = false;
            msg = `${userHash[socket.id]}さんが突然死しました。(切断)`;
          }
        }
      }
      console.log(`${socket.id}  room disconnect`); // Debug disconnectのidをconsoleに流す
      console.log(socket.adapter.rooms[leaveroom]); // debug leaveroomの配列を流す
      if (socket.adapter.rooms[leaveroom]) { // よくわからんけどroomに人がいれば抜けた後の情報を送る
        let memberno = 0;
        const memberlist = {};
        for (member in socket.adapter.rooms[leaveroom].sockets) {
          memberlist[memberno] = userHash[member];
          console.log(`disconnectした時の${leaveroom}の${member}`); // debug
          memberno++;
        }
        delete userHash[socket.id];
        delete userRoom[socket.id];
        io.sockets.in(leaveroom).emit('roommember', { members: memberlist });
        io.sockets.in(leaveroom).emit('S_to_C_message', { sendmsg: msg, issys: 1, emittime: genedate() });
      } else { // roomに人がいなければ消すだけ(多分起こらない)
        delete userHash[socket.id];
        delete userRoom[socket.id];
      }
    } else {
      console.log(`${socket.id}  noroom disconnect`);
    }
    console.log(userHash);
    console.log(userRoom);
  });
}); // Socket終了


const game = {
  start:function(room,members,config){

    const numwerewolf = Number(config.werewolf);
    const nummadman = Number(config.madman);
    const numfox = Number(config.fox);
    const numseer = Number(config.seer);
    const nummedium = Number(config.medium);
    const numhunter = Number(config.hunter);
    const numvillager = Number(config.villager);
    const numdaytime = Number(config.daytime);
    const numnighttime = Number(config.nighttime);
    const numplayer = numwerewolf + nummadman + numfox + numseer + nummedium + numhunter + numvillager;
    const numwolfside = numwerewolf + nummadman;
    const numfoxside = numfox;
    const nummanside = numseer + nummedium + numhunter + numvillager;
    if (Object.keys(members).length < numplayer) {
      return false;
    } else { // else ifで勝利条件判定trueの場合、だめって返すようにしたい
      let roles = [];
      pusharray(numwerewolf, 'werewolf', roles);
      pusharray(nummadman, 'madman', roles);
      pusharray(numfox, 'fox', roles);
      pusharray(numseer, 'seer', roles);
      pusharray(nummedium, 'medium', roles);
      pusharray(numhunter, 'hunter', roles);
      pusharray(numvillager, 'villager', roles);
      console.log(roles);
      roles = shuffle(roles);
      console.log(roles);
      //const haiyaku = `配役 人狼${data.werewolf}/狂人${data.madman}/妖狐${data.fox}/占い師${data.seer}/霊能者${data.medium}/狩人${data.hunter}/村人${data.villager}<br />人狼陣営(狂人含め)：${numwolfside}人/妖狐陣営：${numfoxside}人/村人陣営：${nummanside}人/合計人数${numplayer}/昼時間${data.daytime}分/夜時間${data.nighttime}分/GMモード${isgmmode}`;
      //io.sockets.in(userRoom[socket.id]).emit('S_to_C_message', { sendmsg: haiyaku, issys: 4 });
      gamestates[room] = {};
      gamestates[room].daycount = 1;
      gamestates[room].daytime = 3;
      gamestates[room].votecount = 1;
      gamestates[room].wolf = numwolfside;
      gamestates[room].fox = numfoxside;
      gamestates[room].man = nummanside;
      gamestates[room].wolfaction = {};
      gamestates[room].seeraction = {};
      gamestates[room].hunteraction = {};
      gamestates[room].votekill = {};
      gamestates[room].member = {};
      gameHash[room] = {};
      let i = 0;  //ここは後々ルームマスターがゲームに参加するメンバーを選べるようにしたい
      for (member in members) {
        gamestates[room].member[member] = {
          role:roles[i],
          live:true,
          vote:{},
          name:userHash[member]
        };
        //console.log(gamestates[userRoom[socket.id]].member[member]);
        //const ismaster = (master == member);
        //io.to(member).emit('gamestart', { role: roles[i], master: ismaster, yourname: userHash[member] });
        //console.log(`${member}：${roles[i]}`);
        //console.log(i);
        //console.log(ismaster);
        i++;
        if (numplayer <= i) { // ルームにいる人のほうが多かったら途中でbreak
          break;
        }
      }
      return true;
      //console.log(gameHash[userRoom[socket.id]]);
      //const livingpeople = {};
      //const playerroles = {};
      //for (member in gamestates[userRoom[socket.id]].member) {
      //  livingpeople[userHash[member]] = gamestates[userRoom[socket.id]].member[member].live;
      //  playerroles[userHash[member]] = gamestates[userRoom[socket.id]].member[member].role;
      //}
      //io.sockets.in(userRoom[socket.id]).emit('night', { daycount: gamestates[userRoom[socket.id]].daycount, wholive: livingpeople, playerrole: playerroles, daycount: gamestates[userRoom[socket.id]].daycount });
      //console.log('ゲーム開始時生存者');
      //console.log(livingpeople);
      //console.log('');
      //console.log(gamestates);
    }
  },
  vote:function (room, performer, data) { //ユーザーの投票
    let days = gamestates[room].daycount;
    let votecount = gamestates[room].votecount;
    let members = gamestates[room].member;

    if (data.votefor) { // 投票先がある場合
      let votefor = 0;

      for (member in members) {
        if (gamestates[room].member[member].live && data.votefor == gameHash[room].member[member]) { // 生きている場合
          votefor = data.votefor;
        }
      }

      if (votefor) { //投票先がある
        if (gamestates[room].member[performer].vote[days][votecount]) { //すでに投票している
          //socket.emit('S_to_C_message', { sendmsg: `投票を${votefor}さんに変えました。`, issys: 2 });
          return {complete:true, change:true, votefor:votefor};
          console.log(`${performer} has revoted for ${votefor}`);
        } else { //初めての投票
          //socket.emit('S_to_C_message', { sendmsg: `${votefor}さんに投票しました。`, issys: 2 });
          return {complete:true, change:false, votefor:votefor};
          console.log(`${performer} has voted for ${votefor}`);
        }
        gamestates[room].member[performer].vote[days][votecount] = votefor;
				// gamestatesのルームのメンバーの投票先の日数の投票回数のところを投票先にする
      } else { //投票先がない
        //socket.emit('S_to_C_message', { sendmsg: `${votefor}さんには投票できません。`, issys: 1 });
        return {complete:false, change:false, votefor:votefor, errortype:1};
        console.log(`Error We cannot accept ${performer} s voting for ${votefor}`);
      }
    } else { //投票先がない場合
      return {complete:false, change:false, votefor:votefor, errortype:2};
      console.log(`Error ${performer} must choose who to vote for`);
    }
  }

};

// 2桁に直す
const toDoubleDigits = function (num) {
  num += '';
  if (num.length === 1) {
    num = `0${num}`;
  }
  return num;
};

// 日付をYYYY/MM/DD HH:DD:MI:SS形式で取得
let genedate = function () {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = toDoubleDigits(date.getMonth() + 1);
  const dd = toDoubleDigits(date.getDate());
  const hh = toDoubleDigits(date.getHours());
  const mi = toDoubleDigits(date.getMinutes());
  const ss = toDoubleDigits(date.getSeconds());
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
};

// オブジェクト系関数
function in_array(element, arrayvalue) {
  let isinarray = 0;
  for (ekf in arrayvalue) {
    if (arrayvalue[ekf] == element) { // 第一引数が、オブジェクトの要素と一致するものがあればカウント
      isinarray++;
    }
  }
  return isinarray;
}
function of_array(element, arrayvalue) {
  let isinarray = 0;
  for (ekf in arrayvalue) {
    if (ekf == element) { // 第一引数が、オブジェクト名と一致するものがあればカウント
      isinarray++;
    }
  }
  return isinarray;
}
function shuffle(arrayvalue) {
  for (let i = arrayvalue.length - 1; i > 0; i--) {
    const r = Math.floor(Math.random() * (i + 1));
    const tmp = arrayvalue[i];
    arrayvalue[i] = arrayvalue[r];
    arrayvalue[r] = tmp;
  }
  return arrayvalue;
}
function pusharray(numbers, element, arrayvalue) {
  for (let i = numbers; i > 0; i--) {
    arrayvalue.push(element);
  }
  return arrayvalue;
}
function judge(wolf, fox, man) {
  let judgereturn = {};
  if (man <= wolf) {
    if (fox) {
      judgereturn = { end: true, endmsg: '妖狐陣営の勝利です。' };
    } else {
      judgereturn = { end: true, endmsg: '人狼陣営の勝利です。' };
    }
  } else if (wolf < 1) {
    if (fox) {
      judgereturn = { end: true, endmsg: '妖狐陣営の勝利です。' };
    } else {
      judgereturn = { end: true, endmsg: '村人陣営の勝利です。' };
    }
  } else {
    judgereturn = { end: false, emdmsg: '' };
  }
  return judgereturn;
}

function sanitize(str,space) { //サニタイズ 第二引数にdefinedされたモノを入れるとスペースも消す
  if(space){
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r?\n/g, "").replace(/\s+/g,"");
  }else{
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r?\n/g, "");
  }
 }
