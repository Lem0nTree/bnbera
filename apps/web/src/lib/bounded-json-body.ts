/** Reject oversized or stalled public requests before materializing their body. */
export async function boundedJsonBody(request: Request, maxBytes=64*1024): Promise<unknown> {
  const declared=request.headers.get("content-length");
  if(declared!==null && (!/^[0-9]+$/u.test(declared)||Number(declared)>maxBytes))throw new Error("BODY_LIMIT");
  const reader=request.body?.getReader();if(!reader)throw new Error("BODY_REQUIRED");
  const chunks:Uint8Array[]=[];let size=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel();reject(new Error("BODY_TIMEOUT"));},8000);});
  try {
    while(true){const next=await Promise.race([reader.read(),deadline]);if(next.done)break;size+=next.value.byteLength;if(size>maxBytes)throw new Error("BODY_LIMIT");chunks.push(next.value);}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as unknown;
  }finally{clearTimeout(timer);void reader.cancel();}
}
