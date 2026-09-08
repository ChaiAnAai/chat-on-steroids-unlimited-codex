import json,re,urllib.request,urllib.parse,time,concurrent.futures,pathlib
root=pathlib.Path('src/renderer/locales')
keys=json.loads(pathlib.Path('.locale-catalogue.json').read_text(encoding='utf8'))
def translate_chunk(entries,lang):
 protected={}
 chunks=[]
 for i,key in entries:
  def mark(m):
   token='ZXV'+str(len(protected))+'ZXV';protected[token]=m.group();return token
  chunks.append('ZXQ'+str(i)+'ZXQ\n'+re.sub(r'\{[a-zA-Z0-9_]+\}',mark,key).replace('\n',' '))
 query='\n'.join(chunks) if len(entries)>1 else re.sub(r'^ZXQ\d+ZXQ\n', '', chunks[0])
 url='https://translate.googleapis.com/translate_a/single?'+urllib.parse.urlencode({'client':'gtx','sl':'en','tl':lang,'dt':'t','q':query})
 for attempt in range(3):
  try:
   result=json.load(urllib.request.urlopen(url,timeout=40))
   text=''.join(x[0] for x in result[0] if x[0])
   text=re.sub(r'ZXV\s*(\d+)\s*ZXV',lambda m:protected.get('ZXV'+m[1]+'ZXV',m.group()),text,flags=re.I)
   if len(entries)==1: text='ZXQ'+str(entries[0][0])+'ZXQ '+text
   parts=re.split(r'ZXQ\s*(\d+)\s*ZXQ\s*',text,flags=re.I)
   out={}
   for n in range(1,len(parts)-1,2):
    index=int(parts[n]);value=parts[n+1].strip();key=keys[index]
    if key.strip() and not value:continue
    if sorted(re.findall(r'\{[a-zA-Z0-9_]+\}',value))!=sorted(re.findall(r'\{[a-zA-Z0-9_]+\}',key)):continue
    out[key]=(' ' if key.startswith(' ') else '')+value+(' ' if key.endswith(' ') else '')
   if len(out)!=len(entries):raise ValueError('marker or placeholder mismatch')
   return out
  except Exception as error:
   if len(entries)>1:
    mid=len(entries)//2
    return {**translate_chunk(entries[:mid],lang),**translate_chunk(entries[mid:],lang)}
   print('RETRY',lang,json.dumps(entries,ensure_ascii=True),str(error),json.dumps(locals().get('text',''),ensure_ascii=True),flush=True)
   if attempt==2:raise
   time.sleep(1+attempt)
def language(lang):
 file=root/(lang+'.json');out=json.loads(file.read_text(encoding='utf8')) if file.exists() else {}
 batch=[];size=0
 for i,key in enumerate(keys):
  if key in out:continue
  if size+len(key)>2200 and batch:
   out.update(translate_chunk(batch,lang));file.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8');batch=[];size=0
  batch.append((i,key));size+=len(key)+15
 if batch:out.update(translate_chunk(batch,lang))
 file.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print(lang,len(out),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(language,['zh-TW','ja','ko','es','fr','de']))
