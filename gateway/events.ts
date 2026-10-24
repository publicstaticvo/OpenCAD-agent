import {WebSocket,type WebSocketServer} from 'ws';
import type {RevisionStore} from './revision-store.ts';
/** Durable cursor polling is deliberately small; SQLite, not this socket, owns event truth. */
export class EventHub {
 private subscriptions=new Map<WebSocket,{documentId:string;after:number}>();
 private timer:ReturnType<typeof setInterval>;
 constructor(private store:RevisionStore){this.timer=setInterval(()=>this.flush(),40);this.timer.unref();}
 subscribe(socket:WebSocket,documentId:string,after:number){
  const snapshot=this.store.snapshot(documentId);
  socket.send(JSON.stringify({type:'ready',documentId,afterSeq:after,latestSeq:snapshot.lastSeq}));
  this.subscriptions.set(socket,{documentId,after});socket.once('close',()=>this.subscriptions.delete(socket));
  socket.on('error',()=>this.subscriptions.delete(socket));socket.on('message',()=>socket.close(1008,'Events are server-to-client only'));
  this.flush();
 }
 private flush(){
  for(const [socket,sub] of this.subscriptions){
   if(socket.readyState!==WebSocket.OPEN)continue;
   try{
    for(const event of this.store.events(sub.documentId,sub.after)){
     if(socket.bufferedAmount>1048576){socket.close(1013,'Reconnect with last applied seq');break;}
     socket.send(JSON.stringify({type:'event',event}));sub.after=event.seq;
    }
   }catch{socket.close(1011,'Event replay unavailable; refresh snapshot');}
  }
 }
 close(){clearInterval(this.timer);for(const socket of this.subscriptions.keys())socket.terminate();this.subscriptions.clear();}
}
