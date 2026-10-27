import {Agent,Request as TransportRequest,fetch as transportFetch} from 'undici';

// Application request deadlines are enforced by AbortSignal, including the SSE body.
const dispatcher=new Agent({headersTimeout:0,bodyTimeout:0,connect:{timeout:0}});
export const modelFetch=(input,init)=>{
 const request=new Request(input,init);
 return transportFetch(new TransportRequest(request.url,request),{dispatcher});
};
