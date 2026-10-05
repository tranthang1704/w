import { Server as SocketIOServer } from "socket.io";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "node:url";

export class RealtimeHub {
  constructor(httpServer){
    this.getState = () => null;

    this.io = new SocketIOServer(httpServer,{
      cors:{origin:false},
      serveClient:true
    });

    this.io.on("connection",socket=>{
      const state = this.getState();
      if(state) socket.emit("auction:state",state);
    });

    this.wss = new WebSocketServer({noServer:true});

    this.wss.on("connection",ws=>{
      const state = this.getState();
      if(state && ws.readyState === WebSocket.OPEN){
        ws.send(JSON.stringify({type:"state",state}));
      }
    });

    httpServer.on("upgrade",(request,socket,head)=>{
      const pathname = new URL(request.url || "/","http://localhost").pathname;
      if(pathname === "/"){
        this.wss.handleUpgrade(request,socket,head,ws=>{
          this.wss.emit("connection",ws,request);
        });
      }
    });
  }

  setStateProvider(fn){ this.getState = fn; }

  broadcastState(state){
    this.io.emit("auction:state",state);
    this.broadcastLegacy({type:"state",state});
  }

  broadcastEvent(name,data){
    this.io.emit(name,data);
    this.broadcastLegacy({type:name,data});
  }

  broadcastLegacy(payload){
    const data = JSON.stringify(payload);
    for(const client of this.wss.clients){
      if(client.readyState === WebSocket.OPEN){
        try{ client.send(data); }catch{}
      }
    }
  }
}
