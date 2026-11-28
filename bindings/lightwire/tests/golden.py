#!/usr/bin/env python3
"""Independent oracle: installed Python protobuf, descriptors from the pinned .proto text.
No production generator/prost/messages.rs is consulted. This bounded parser supports only
this committed schema's simple top-level declarations and rejects unparsed declarations.
"""
import hashlib, json, pathlib, re, sys
import google.protobuf
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory
ROOT=pathlib.Path(__file__).resolve().parents[1]
source='\n'.join((ROOT/'vendor'/n).read_text() for n in ['compact_formats.proto','service.proto'])
source=re.sub(r'//[^\n]*','',source)
fd=descriptor_pb2.FileDescriptorProto(name='lightwire-independent.proto',package='cash.z.wallet.sdk.rpc',syntax='proto3')
enums={}
for name,body in re.findall(r'enum\s+(\w+)\s*\{([^}]*)\}',source):
    enum=fd.enum_type.add(name=name);enums[name]=True
    for row in body.split(';'):
        if not row.strip():continue
        m=re.fullmatch(r'\s*(\w+)\s*=\s*(-?\d+)\s*',row)
        if not m:raise RuntimeError('unparsed enum '+row)
        enum.value.add(name=m[1],number=int(m[2]))
scalars={'uint32':13,'uint64':4,'int32':5,'int64':3,'bool':8,'string':9,'bytes':12}
for name,body in re.findall(r'message\s+(\w+)\s*\{([^}]*)\}',source):
    message=fd.message_type.add(name=name)
    for row in body.split(';'):
        if not row.strip() or row.strip().startswith('reserved '):continue
        m=re.fullmatch(r'\s*(repeated\s+)?(\w+)\s+(\w+)\s*=\s*(\d+)\s*',row)
        if not m:raise RuntimeError('unparsed field '+row)
        repeated,typ,name,tag=m.groups()
        field=message.field.add(name=name,number=int(tag),label=3 if repeated else 1,type=scalars.get(typ,14 if typ in enums else 11))
        if typ not in scalars:field.type_name='.cash.z.wallet.sdk.rpc.'+typ
pool=descriptor_pool.DescriptorPool();pool.Add(fd)
def cls(name):return message_factory.GetMessageClass(pool.FindMessageTypeByName('cash.z.wallet.sdk.rpc.'+name))
def snake(s):return re.sub(r'(?<!^)(?=[A-Z])','_',s).lower()
def sample(message):
    for f in message.DESCRIPTOR.fields:
        if f.type==11:
            if f.is_repeated:sample(getattr(message,f.name).add())
            else:sample(getattr(message,f.name));getattr(message,f.name).SetInParent()
            continue
        value={13:4294967295,4:18446744073709551615,5:-1,3:-9223372036854775808,8:True,9:'fixture-'+f.name+'-é',12:bytes(range(52 if f.name=='ciphertext' else 32)),14:2}[f.type]
        if f.is_repeated:getattr(message,f.name).append(value)
        else:setattr(message,f.name,value)
    return message

def dto(message):
    out={}
    for f in message.DESCRIPTOR.fields:
        v=getattr(message,f.name)
        def one(v):
            if f.type==11:return dto(v)
            if f.type==12:return v.hex()
            if f.type in (3,4):return str(v)
            return v
        out[snake(f.name)]=[one(x) for x in v] if f.is_repeated else (None if f.type==11 and not message.HasField(f.name) else one(v))
    return out
unary=['GetLatestBlock','GetLightdInfo','GetTransaction','GetAddressUtxos','GetTaddressBalance','GetTreeState','SendTransaction']
streams=['GetSubtreeRoots','GetBlockRange','GetTaddressTransactions','GetMempoolStream']
rpcs={m[0]:m[1:] for m in re.findall(r'rpc\s+(\w+)\s*\((\w+)\)\s*returns\s*\((stream\s+)?(\w+)\)',source)}
vectors=[]
for method in unary+streams:
    request,stream,response=rpcs[method]
    if bool(stream) != (method in streams):raise RuntimeError('wrong stream kind')
    for direction,typ in [('request',request),('item' if stream else 'response',response)]:
        message=sample(cls(typ)());wire=message.SerializeToString(deterministic=True)
        parsed=cls(typ)();parsed.ParseFromString(wire)
        if dto(parsed)!=dto(message):raise RuntimeError('Python roundtrip failed')
        vectors.append(dict(method=method,direction=direction,dto=dto(message),hex=wire.hex()))
malformed=[]
for f in vectors:
    if f['direction']=='request':continue
    typ=rpcs[f['method']][2]; wire=bytes.fromhex(f['hex']);cuts=[]
    for end in range(1,len(wire)):
        try:cls(typ)().ParseFromString(wire[:end])
        except Exception:cuts.append(end)
    malformed.append({'method':f['method'],'direction':f['direction'],'hex':f['hex'],'cuts':cuts})
negative_text=json.dumps(malformed,separators=(',',':'))+'\n'
negative_target=ROOT/'tests/malformed.json'
if '--write' in sys.argv:negative_target.write_text(negative_text)
elif negative_target.read_text()!=negative_text:raise RuntimeError('malformed fixture mismatch')
text=json.dumps(vectors,indent=2,ensure_ascii=False)+'\n';target=ROOT/'tests/golden.json'
if '--write' in sys.argv:target.write_text(text)
elif target.read_text()!=text:raise RuntimeError('committed independent vectors mismatch')
print(json.dumps({'oracle':'google.protobuf '+google.protobuf.__version__,'vectors':len(vectors),'malformed':sum(len(f['cuts']) for f in malformed),'malformed_sha256':hashlib.sha256(negative_text.encode()).hexdigest(),'sha256':hashlib.sha256(text.encode()).hexdigest(),'descriptor_sha256':hashlib.sha256(fd.SerializeToString()).hexdigest()}))
