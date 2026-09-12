import { lookup } from 'node:dns';
import { get } from 'node:https';
import { BlockList, isIP } from 'node:net';
import sharp from 'sharp';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const) blocked.addSubnet(address,prefix,'ipv4');
export function publicIconAddress(address:string): boolean { return isIP(address) === 4 && !blocked.check(address,'ipv4'); }
export function allowedIconRedirect(from:string,to:string):boolean {
  try {const a=new URL(from),b=new URL(to);return b.protocol==='https:'&&!b.username&&!b.password&&(!b.port||b.port==='443')&&a.hostname.replace(/^www\./,'')===b.hostname.replace(/^www\./,'');}catch{return false;}
}
async function publicDnsForSyntheticProxy(hostname:string,signal:AbortSignal):Promise<Array<{address:string;family:4}>> {
  // Some local TUN proxies answer all DNS queries with 198.18/15. Never connect to that
  // reserved address: independently resolve A records, validate them and pin the real socket.
  const response=await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,{signal,redirect:'error'});
  if(!response.ok||!response.body)throw Error('Icon DNS unavailable');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768)throw Error('DNS response too large');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const json=JSON.parse(Buffer.concat(parts).toString('utf8')) as {Status?:number;Answer?:Array<{type:number;data:string}>};
  const addresses=json.Status===0&&Array.isArray(json.Answer)?json.Answer.filter(a=>a.type===1).map(a=>({address:a.data,family:4 as const})):[];
  if(!addresses.length||addresses.some(a=>!publicIconAddress(a.address)))throw Error('Icon address is not public');
  return addresses;
}

/** No cookies or SVG; only a same-site HTTPS redirect. Pin validated public DNS to each socket. */
export async function fetchRegistryIcon(url:string,redirects=0): Promise<string> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || target.port && target.port !== '443') throw Error('Unsupported icon URL');
  const data = await new Promise<Buffer|string>((resolve,reject)=>{
    const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),6000);
    const request = get(target, { signal:controller.signal, agent:false, headers:{Accept:'image/png,image/jpeg,image/webp'},
      lookup(hostname,options,callback) {
        lookup(hostname,{family:4,all:true},(error,addresses)=>{
          if(!error && addresses.length && addresses.every(a=>/^198\.(18|19)\./.test(a.address))) {
            void publicDnsForSyntheticProxy(hostname,controller.signal).then(real=>{if(options.all)callback(null,real);else callback(null,real[0]!.address,4);},error=>callback(error,[],4));return;
          }
          if (error || !addresses.length || addresses.some(a=>!publicIconAddress(a.address))) { callback(error ?? Error('Icon address is not public'),[],4); return; }
          if(options.all) callback(null,addresses); else callback(null,addresses[0]!.address,4);
        });
      }
    },response=>{
      if([301,302,307,308].includes(response.statusCode??0)&&response.headers.location&&redirects<2){
        try {const next=new URL(response.headers.location,target).href;if(allowedIconRedirect(url,next)){response.destroy();resolve(next);return;}}catch{/* Rejected below. */}
      }
      if(response.statusCode!==200 || !/^image\/(png|jpeg|jpg|webp)(;|$)/i.test(response.headers['content-type']??'')) {response.destroy();reject(Error('Unsupported icon response'));return;}
      const parts:Buffer[]=[];let length=0;
      response.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>512*1024){response.destroy(Error('Icon exceeds limit'));return;}parts.push(chunk);});
      response.on('end',()=>resolve(Buffer.concat(parts)));response.on('error',reject);
    });
    request.on('error',reject);request.on('close',()=>clearTimeout(timeout));
  });
  if(typeof data==='string')return fetchRegistryIcon(data,redirects+1);
  return normalizeRegistryIcon(data);
}
export async function normalizeRegistryIcon(data:Buffer):Promise<string> {
  if(data.length>512*1024)throw Error('Icon exceeds limit');
  const input=sharp(data,{limitInputPixels:1024*1024,animated:false});
  const meta=await input.metadata();
  if(!['png','jpeg','webp'].includes(meta.format??'') || (meta.pages??1)>1)throw Error('Unsupported icon format');
  const png=await input.resize(96,96,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}
