//! Durable exact-byte submission reservations. Network I/O remains with the host.
use super::accounts::{fields,string,Failure,Result};
use prost::Message;
use rusqlite::{params,OptionalExtension};
use serde_json::{json,Value};
use zcash_client_backend::data_api::{WalletRead,locking::{OutputLockStore,LockOwner}};
use zcash_client_sqlite::ExtensionTransaction;

pub(super) const ABANDONED:&str="ext_wallet_abandoned";
pub(super) const ABANDONED_SQL:&str="CREATE TABLE ext_wallet_abandoned(operation BLOB PRIMARY KEY NOT NULL REFERENCES ext_wallet_proposals(operation) CHECK(typeof(operation)='blob' AND length(operation)=32))";
pub(super) const DEFINITIONS:[(&str,&str);4]=[
("ext_wallet_submission_meta","CREATE TABLE ext_wallet_submission_meta(id INTEGER PRIMARY KEY CHECK(id=1),identity BLOB NOT NULL CHECK(typeof(identity)='blob' AND length(identity)=32),retry_epoch INTEGER NOT NULL CHECK(retry_epoch>=0),position INTEGER NOT NULL CHECK(position>=0))"),
("ext_wallet_submission","CREATE TABLE ext_wallet_submission(operation BLOB NOT NULL,step INTEGER NOT NULL,consent TEXT CHECK(consent IS NULL OR (json_valid(consent) AND length(consent)<=4096)),max_attempts INTEGER CHECK(max_attempts>0 AND max_attempts<=9007199254740991),min_interval INTEGER CHECK(min_interval>0 AND min_interval<=9007199254740991),automatic_count INTEGER NOT NULL DEFAULT 0 CHECK(automatic_count>=0),last_start INTEGER,next_eligible INTEGER,observation TEXT CHECK(observation IS NULL OR (json_valid(observation) AND length(observation)<=8192)),observation_sequence INTEGER NOT NULL DEFAULT 0 CHECK(observation_sequence>=0),used_observation INTEGER NOT NULL DEFAULT 0 CHECK(used_observation>=0),PRIMARY KEY(operation,step),FOREIGN KEY(operation,step) REFERENCES ext_wallet_finalized(operation,step))"),
("ext_wallet_attempts","CREATE TABLE ext_wallet_attempts(sequence INTEGER PRIMARY KEY CHECK(sequence>0),attempt BLOB NOT NULL UNIQUE CHECK(typeof(attempt)='blob' AND length(attempt)=32),operation BLOB NOT NULL,step INTEGER NOT NULL,automatic INTEGER NOT NULL CHECK(automatic IN (0,1)),source TEXT NOT NULL CHECK(length(source)>0 AND length(source)<=256),started INTEGER NOT NULL CHECK(started>=0 AND started<=8640000000000000),completed INTEGER CHECK(completed IS NULL OR (completed>=0 AND completed<=8640000000000000)),outcome TEXT NOT NULL CHECK(outcome IN ('started','acknowledged','rejected','unknown')),diagnostic TEXT CHECK(diagnostic IS NULL OR length(diagnostic)<=64),FOREIGN KEY(operation,step) REFERENCES ext_wallet_submission(operation,step))"),(ABANDONED,ABANDONED_SQL)];

pub(super) fn initialize(conn:&mut rusqlite::Connection)->std::result::Result<(),String>{
    (||->Result<()>{
        let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='ext_wallet_submission_meta')",[],|r|r.get(0))?;
        if !exists {
            for (_,sql) in &DEFINITIONS[..3] {tx.execute_batch(sql)?;}
            let mut identity=[0;32];getrandom::fill(&mut identity).map_err(|_|Failure("ENTROPY_UNAVAILABLE".into()))?;
            tx.execute("INSERT INTO ext_wallet_submission_meta VALUES(1,?1,0,0)",[identity])?;
        }
        if !tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[ABANDONED],|r|r.get::<_,bool>(0))? {tx.execute_batch(ABANDONED_SQL)?;}
        for (name,sql) in DEFINITIONS {
            let actual:String=tx.query_row("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?1",[name],|r|r.get(0))?;
            if actual!=sql{return Err("SCHEMA_MISMATCH".into());}
        }
        let valid:bool=tx.query_row("SELECT count(*)=1 AND min(length(identity))=32 AND min(retry_epoch)>=0 AND min(position)>=0 FROM ext_wallet_submission_meta",[],|r|r.get(0))?;
        if !valid{return Err("STORAGE_ERROR".into());}tx.commit()?;Ok(())
    })().map_err(|e|e.0)
}
pub(super) fn abandoned(ext:&ExtensionTransaction<'_>,operation:&[u8])->Result<bool>{
    Ok(ext.query_row("SELECT EXISTS(SELECT 1 FROM ext_wallet_abandoned WHERE operation=?1)",[operation],|r|r.get(0))?)
}
pub(super) fn require_active(ext:&ExtensionTransaction<'_>,operation:&[u8])->Result<()>{
    if abandoned(ext,operation)?{return Err("ROLE_PRECONDITION".into());}Ok(())
}
fn number(v:&Value,name:&str)->Result<i64>{let n=v[name].as_u64().filter(|n|*n<=9007199254740991).ok_or(Failure("INVALID_ARGUMENT".into()))?;Ok(n as i64)}
fn wall_time(v:&Value)->Result<i64>{let n=number(v,"wallTimeMs")?;if n>8640000000000000{return Err("INVALID_ARGUMENT".into());}Ok(n)}
fn sequence(v:&Value,name:&str)->Result<i64>{let s=string(v,name)?;let n=s.parse::<i64>().map_err(|_|Failure("INVALID_ARGUMENT".into()))?;if n<0||n.to_string()!=s{return Err("INVALID_ARGUMENT".into());}Ok(n)}
fn id(s:&str)->Result<Vec<u8>>{if s.len()!=64{return Err("INVALID_ARGUMENT".into());}let b=hex::decode(s).map_err(|_|Failure("INVALID_ARGUMENT".into()))?;if hex::encode(&b)!=s{return Err("INVALID_ARGUMENT".into());}Ok(b)}
fn parse(s:&str)->Result<Value>{serde_json::from_str(s).map_err(|_|Failure("STORAGE_ERROR".into()))}
fn label(s:&str)->Result<()> {if s.is_empty()||s.len()>256||s.chars().any(char::is_control){return Err("INVALID_ARGUMENT".into());}Ok(())}
fn step(input:&Value)->Result<u32> {let n=number(input,"stepIndex")?;if n>=16{return Err("INVALID_ARGUMENT".into());}Ok(n as u32)}

fn review(ext:&ExtensionTransaction<'_>,p:&crate::Document,operation:&str)->Result<Option<Value>>{
    let raw=id(operation)?;
    let row=ext.query_row("SELECT CASE WHEN length(plan)<=2097152 THEN plan END,CASE WHEN length(policy)<=16384 THEN policy END,account,revision FROM ext_wallet_proposals WHERE operation=?1",[raw],|r|Ok((r.get::<_,Vec<u8>>(0)?,r.get::<_,String>(1)?,r.get::<_,uuid::Uuid>(2)?,r.get::<_,String>(3)?))).optional()?;
    row.map(|(encoded,policy,account,revision)|{
        let plan=zcash_client_backend::proto::proposal::Proposal::decode(&encoded[..]).map_err(|_|Failure("STORAGE_ERROR".into()))?;
        if plan.steps.is_empty()||plan.steps.len()>16{return Err("RESOURCE_LIMIT".into());}
        super::proposal::review(&plan,p,&account.to_string(),operation,&parse(&policy)?,&revision)
    }).transpose()
}
fn attempts(ext:&ExtensionTransaction<'_>,operation:&[u8],index:usize)->Result<Value>{
    let rows:String=ext.query_row("SELECT json_group_array(json_object('attemptId',lower(hex(attempt)),'outcome',outcome,'sourceId',source,'startedAt',started,'completedAt',completed,'diagnosticCode',diagnostic)) FROM (SELECT * FROM ext_wallet_attempts WHERE operation=?1 AND step=?2 ORDER BY sequence)",params![operation,index],|r|r.get(0))?;
    parse(&rows)
}
fn block_matches<D:WalletRead>(db:&D,height:u32,hash:&str)->Result<Option<bool>> where Failure:From<D::Error>{
    let mut expected=id(hash)?;expected.reverse();
    Ok(db.get_block_hash(height.into())?.map(|h|h.0.as_slice()==expected.as_slice()))
}
fn checked_observation<D:WalletRead>(db:&D,observation:&Value)->Result<(Value,bool)> where Failure:From<D::Error>{
    if observation.is_null(){return Ok((Value::Null,false));}
    let mut value=self::observation(&json!({"observation":observation}),&observation["txid"]).map_err(|_|Failure("STORAGE_ERROR".into()))?;
    let tip=&observation["tip"];
    let known=if let (Some(height),Some(hash))=(tip["height"].as_u64(),tip["hash"].as_str()) {
        block_matches(db,height as u32,hash)?==Some(true)&&db.chain_height()?.map(u32::from)==Some(height as u32)
    }else{false};
    if let (Some(height),Some(hash))=(observation["inclusion"]["height"].as_u64(),observation["inclusion"]["blockHash"].as_str()){
        match block_matches(db,height as u32,hash)? {
            Some(false)=>{value["priorInclusion"]=value["inclusion"].clone();value["inclusion"]=Value::Null;value["state"]=json!("offMainChain");},
            Some(true) if known&&observation["state"]=="mined"=>{value["inclusion"]["confirmations"]=json!(tip["height"].as_u64().unwrap()-height+1);},
            _=>{value["inclusion"]["confirmations"]=Value::Null;}
        }
    }else if !value["inclusion"].is_null(){value["inclusion"]["confirmations"]=Value::Null;}
    Ok((value,known))
}
fn state<D:WalletRead>(db:&D,ext:&ExtensionTransaction<'_>,p:&crate::Document,operation:&str)->Result<Value> where Failure:From<D::Error>{
    let Some(review)=review(ext,p,operation)? else{return Ok(Value::Null)};
    let raw=id(operation)?;
    // Bound the entire operation before JSON aggregation, across every step.
    let size:i64=ext.query_row("SELECT COALESCE(sum(512+length(source)+COALESCE(length(diagnostic),0)),0) FROM ext_wallet_attempts WHERE operation=?1",[&raw],|r|r.get(0))?;
    if size>2097152{return Err("RESOURCE_LIMIT".into());}
    let finalized=super::pczt_finalize::read_all(ext,p,operation)?;
    let original=ext.query_row("SELECT artifact,CASE WHEN length(bytes)<=4194304 THEN bytes END FROM ext_wallet_pczt WHERE operation=?1",[&raw],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Vec<u8>>(1)?))).optional()?;
    let latest=ext.query_row("SELECT artifact,CASE WHEN length(bytes)<=4194304 THEN bytes END FROM ext_wallet_pczt_artifacts WHERE operation=?1 ORDER BY sequence DESC LIMIT 1",[&raw],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Vec<u8>>(1)?))).optional()?.or(original);
    let artifact=latest.is_some();
    let facts=if let Some((artifact,bytes))=latest {
        if artifact!=super::proposal::digest(b"zakura-wallet-pczt/1",&[operation.as_bytes(),&bytes]){return Err(Failure("STORAGE_ERROR".into()));}
        let(parameters,genesis):(Vec<u8>,Vec<u8>)=ext.query_row("SELECT parameters,genesis FROM ext_wallet_storage WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?)))?;
        let pczt=crate::standalone_pczt::parse_standalone_pczt(&parameters,&genesis,review["targetHeight"].as_u64().ok_or(Failure("STORAGE_ERROR".into()))? as u32,review["branchId"].as_u64().ok_or(Failure("STORAGE_ERROR".into()))? as u32,&bytes,4194304).map_err(Failure)?;
        let inspection=parse(&pczt.inspect().map_err(Failure)?)?;
        json!({"artifactId":artifact,"proofsComplete":inspection["proofsComplete"],"authorizationComplete":inspection["authorizationComplete"]})
    }else{Value::Null};
    let mut steps:Vec<Value>=vec![];let mut eligible:Vec<bool>=vec![];let mut sequences=vec![];let mut position=0i64;let mut has_attempt=false;let mut mined=true;
    for (index,step) in review["steps"].as_array().ok_or(Failure("STORAGE_ERROR".into()))?.iter().enumerate(){
        let history=attempts(ext,&raw,index)?;has_attempt|=!history.as_array().ok_or(Failure("STORAGE_ERROR".into()))?.is_empty();
        let row=ext.query_row("SELECT CASE WHEN length(observation)<=8192 THEN observation END,observation_sequence FROM ext_wallet_submission WHERE operation=?1 AND step=?2",params![raw,index],|r|Ok((r.get::<_,Option<String>>(0)?,r.get::<_,i64>(1)?))).optional()?;
        sequences.push(row.as_ref().map(|(_,n)|n.to_string()).unwrap_or_else(||"0".into()));
        let (observation,known)=if let Some((observation,n))=row{position=position.max(n);checked_observation(db,&observation.map(|s|parse(&s)).transpose()?.unwrap_or(Value::Null))?}else{(Value::Null,false)};
        let inclusion=if observation["state"]=="mined" {observation["inclusion"].clone()}else{Value::Null};
        mined&=inclusion["confirmations"].as_u64().is_some_and(|n|n>0);
        let expiry=step["expiryHeight"].as_u64().ok_or(Failure("STORAGE_ERROR".into()))?;
        let reached=if expiry==0 {json!(false)}else if known {json!(observation["tip"]["height"].as_u64().unwrap()>=expiry)}else{Value::Null};
        let finalized=&finalized["transactions"][index];let stored=!finalized.is_null();
        let parent_ready=known&&(observation["state"]=="mempool"||inclusion["confirmations"].as_u64().is_some_and(|n|n>0));
        let blocked=step["dependsOn"].as_array().ok_or(Failure("STORAGE_ERROR".into()))?.iter().filter(|parent|parent.as_u64().and_then(|i|eligible.get(i as usize)).is_none_or(|ready|!*ready)).cloned().collect::<Vec<_>>();
        eligible.push(parent_ready);
        steps.push(json!({"index":index,"dependsOn":step["dependsOn"],"txid":if stored{finalized["txid"].clone()}else{Value::Null},"exactBytesSha256":if stored{finalized["exactBytesSha256"].clone()}else{Value::Null},"attempts":history,"inclusion":inclusion,"observation":observation,"expiry":{"height":if expiry==0{Value::Null}else{json!(expiry)},"reached":reached,"confirmedUnminedAt":null},"blockedBy":blocked}));
    }
    let complete_bytes=finalized["transactions"].as_array().is_some_and(|t|!t.is_empty()&&t.len()==steps.len());
    let is_abandoned=abandoned(ext,&raw)?;
    let mut missing=vec![];if !artifact&&!complete_bytes{missing.push("artifact");}if !complete_bytes{missing.push("finalizedBytes");}if is_abandoned{missing.clear();}
    Ok(json!({"state":{"operationId":operation,"revision":super::revision::read(ext)?,"accountIds":[review["accountId"]],"lockExpiryHeight":review["lockExpiryHeight"],"phase":if is_abandoned{"abandoned"}else if mined{"complete"}else if has_attempt{"observing"}else if complete_bytes{"ready"}else if facts["authorizationComplete"]==false{"awaitingAuthorization"}else{"proposed"},"missing":missing,"steps":steps},"observationSequence":position.to_string(),"observationSequences":sequences,"artifactFacts":facts}))
}
fn observation(input:&Value,txid:&Value)->Result<Value>{
    let v=input.get("observation").ok_or(Failure("INVALID_ARGUMENT".into()))?;
    fields(v,&["sourceId","observedAt","txid","state","inclusion","tip","priorInclusion"])?;
    if v.to_string().len()>8192{return Err("RESOURCE_LIMIT".into());}
    label(string(v,"sourceId")?)?;let time=string(v,"observedAt")?;
    if time.len()>40||time.len()<20||!time.ends_with('Z'){return Err("INVALID_ARGUMENT".into());}
    if &v["txid"]!=txid{return Err("PROTOCOL_MISMATCH".into());}id(string(v,"txid")?)?;
    if !matches!(string(v,"state")?,"notSeen"|"mempool"|"mined"|"offMainChain"|"unknown"){return Err("INVALID_ARGUMENT".into());}
    for name in ["inclusion","priorInclusion","tip"] {
        let point=v.get(name).ok_or(Failure("INVALID_ARGUMENT".into()))?;
        if point.is_null(){continue;}
        fields(point,if name=="tip"{&["height","hash"][..]}else{&["height","blockHash","confirmations"][..]})?;
        if number(point,"height")?>u32::MAX as i64{return Err("INVALID_ARGUMENT".into());}
        let hash=if name=="tip"{"hash"}else{"blockHash"};
        if name=="tip"||!point[hash].is_null(){id(string(point,hash)?)?;}
        if name!="tip"&&!point["confirmations"].is_null(){number(point,"confirmations")?;}
    }
    if v["state"]=="mined"&&v["inclusion"].is_null(){return Err("PROTOCOL_MISMATCH".into());}
    if v["state"]!="mined"&&!v["inclusion"].is_null(){return Err("PROTOCOL_MISMATCH".into());}
    if let (Some(h),Some(t))=(v["inclusion"]["height"].as_u64(),v["tip"]["height"].as_u64()){
        if h>t||(h==t&&!v["inclusion"]["blockHash"].is_null()&&v["inclusion"]["blockHash"]!=v["tip"]["hash"]){return Err("PROTOCOL_MISMATCH".into());}
    }
    Ok(v.clone())
}
fn list(ext:&ExtensionTransaction<'_>,input:&Value)->Result<Value>{
    let after=sequence(input,"afterSequence")?;
    let high=if input.get("highWater").is_some(){sequence(input,"highWater")?}else{ext.query_row("SELECT COALESCE(MAX(sequence),0) FROM ext_wallet_proposals",[],|r|r.get::<_,i64>(0))?};
    let limit=number(input,"limit")?;if limit==0||limit>200||after>high{return Err("INVALID_ARGUMENT".into());}
    let account=if let Some(value)=input.get("accountId") {let s=value.as_str().ok_or(Failure("INVALID_ARGUMENT".into()))?;let id=uuid::Uuid::parse_str(s).map_err(|_|Failure("INVALID_ARGUMENT".into()))?;if id.to_string()!=s{return Err("INVALID_ARGUMENT".into());}Some(id)}else{None};
    let rows:String=ext.query_row("SELECT json_group_array(json_object('sequence',CAST(sequence AS TEXT),'operationId',lower(hex(operation)))) FROM (SELECT sequence,operation FROM ext_wallet_proposals WHERE sequence>?1 AND sequence<=?2 AND (?3 IS NULL OR account=?3) ORDER BY sequence LIMIT ?4)",params![after,high,account,limit],|r|r.get(0))?;
    let position:i64=ext.query_row("SELECT position FROM ext_wallet_submission_meta WHERE id=1",[],|r|r.get(0))?;
    Ok(json!({"revision":super::revision::read(ext)?,"highWater":high.to_string(),"observationPosition":position.to_string(),"items":parse(&rows)?}))
}
fn retry_policy(input:&Value)->Result<Option<(i64,i64)>> {
    input.get("policy").map(|policy|{fields(policy,&["maxAttempts","minIntervalMs"])?;let max=number(policy,"maxAttempts")?;let interval=number(policy,"minIntervalMs")?;if max==0||interval==0{return Err("INVALID_ARGUMENT".into());}Ok((max,interval))}).transpose()
}
fn adopt_policy(ext:&ExtensionTransaction<'_>,operation:&[u8],index:u32,max:i64,interval:i64)->Result<()> {
    ext.execute("INSERT INTO ext_wallet_submission(operation,step) VALUES(?1,?2) ON CONFLICT(operation,step) DO NOTHING",params![operation,index])?;
    ext.execute("UPDATE ext_wallet_submission SET max_attempts=CASE WHEN max_attempts IS NULL THEN ?3 ELSE min(max_attempts,?3) END,min_interval=CASE WHEN min_interval IS NULL THEN ?4 ELSE max(min_interval,?4) END,next_eligible=CASE WHEN last_start IS NULL THEN NULL ELSE last_start+max(COALESCE(min_interval,0),?4) END WHERE operation=?1 AND step=?2",params![operation,index,max,interval])?;
    super::revision::advance(ext)?;Ok(())
}
fn begin<D:WalletRead>(db:&D,ext:&ExtensionTransaction<'_>,p:&crate::Document,input:&Value,operation:&str)->Result<Value> where Failure:From<D::Error>{
    let index=step(input)?;let raw=id(operation)?;let wall=wall_time(input)?;let elapsed=number(input,"monotonicElapsedMs")?;
    let mode=string(input,"mode")?;if mode!="explicit"&&mode!="automatic"{return Err("INVALID_ARGUMENT".into());}let automatic=mode=="automatic";
    let source=string(input,"sourceId")?;label(source)?;
    let route=match input.get("routeBinding"){Some(Value::Null)=>None,Some(Value::String(s))=>{id(s)?;Some(s.as_str())},_=>return Err("INVALID_ARGUMENT".into())};
    let origin=if !automatic{let s=string(input,"origin")?;if !matches!(s,"broadcast"|"send"|"shield"){return Err("INVALID_ARGUMENT".into());}Some(s)}else{if input.get("origin").is_some(){return Err("INVALID_ARGUMENT".into());}None};
    let policy=retry_policy(input)?;
    if automatic&&policy.is_none(){return Err("INVALID_ARGUMENT".into());}
    let submitted_sequence=sequence(input,"observationSequence")?;
    let plan=review(ext,p,operation)?.ok_or(Failure("OPERATION_NOT_FOUND".into()))?;
    let selected=plan["steps"].as_array().and_then(|v|v.get(index as usize)).ok_or(Failure("INVALID_ARGUMENT".into()))?;
    let maximum=number(input,"maximum")?;if maximum==0||maximum>2097152{return Err("RESOURCE_LIMIT".into());}
    let length:Option<i64>=ext.query_row("SELECT length(bytes) FROM ext_wallet_finalized WHERE operation=?1 AND step=?2",params![raw,index],|r|r.get(0)).optional()?;
    if length.is_some_and(|n|n>maximum){return Err("RESOURCE_LIMIT".into());}
    let finalized=super::pczt_finalize::read_step(ext,p,operation,index)?;
    if finalized.is_null(){return if automatic{Ok(Value::Null)}else{Err("NOT_FINALIZED".into())};}
    ext.execute("INSERT INTO ext_wallet_submission(operation,step) VALUES(?1,?2) ON CONFLICT(operation,step) DO NOTHING",params![raw,index])?;
    if let Some((max,interval))=policy {adopt_policy(ext,&raw,index,max,interval)?;}
    let(consent,max,interval,count,last,next,observed,used,observation)=ext.query_row("SELECT CASE WHEN length(consent)<=4096 THEN consent END,max_attempts,min_interval,automatic_count,last_start,next_eligible,observation_sequence,used_observation,CASE WHEN length(observation)<=8192 THEN observation END FROM ext_wallet_submission WHERE operation=?1 AND step=?2",params![raw,index],|r|Ok((r.get::<_,Option<String>>(0)?,r.get::<_,Option<i64>>(1)?,r.get::<_,Option<i64>>(2)?,r.get::<_,i64>(3)?,r.get::<_,Option<i64>>(4)?,r.get::<_,Option<i64>>(5)?,r.get::<_,i64>(6)?,r.get::<_,i64>(7)?,r.get::<_,Option<String>>(8)?)))?;
    let (identity,epoch,parameters,genesis):(Vec<u8>,i64,Vec<u8>,Vec<u8>)=ext.query_row("SELECT m.identity,m.retry_epoch,s.parameters,s.genesis FROM ext_wallet_submission_meta m JOIN ext_wallet_storage s ON s.id=m.id WHERE m.id=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
    let (encoded,policy_text):(Vec<u8>,String)=ext.query_row("SELECT CASE WHEN length(plan)<=2097152 THEN plan END,CASE WHEN length(policy)<=16384 THEN policy END FROM ext_wallet_proposals WHERE operation=?1",[&raw],|r|Ok((r.get(0)?,r.get(1)?)))?;
    let binding=super::proposal::digest(b"zakura-submission-consent/1",&[&identity,&parameters,&genesis,&raw,&index.to_le_bytes(),&encoded,policy_text.as_bytes(),finalized["txid"].as_str().ok_or(Failure("STORAGE_ERROR".into()))?.as_bytes(),finalized["exactBytesSha256"].as_str().ok_or(Failure("STORAGE_ERROR".into()))?.as_bytes()]);
    let prior:bool=ext.query_row("SELECT EXISTS(SELECT 1 FROM ext_wallet_attempts WHERE operation=?1 AND step=?2)",params![raw,index],|r|r.get(0))?;
    if automatic {
        let consent=consent.map(|s|parse(&s)).transpose()?.unwrap_or(Value::Null);
        if !prior||route.is_none()||consent["version"]!=1||consent["epoch"]!=epoch||consent["binding"]!=binding||consent["routeBinding"]!=json!(route)||count>=max.ok_or(Failure("STORAGE_ERROR".into()))?||last.is_none()||next.is_none()||wall<last.unwrap()||wall<next.unwrap()||elapsed<interval.ok_or(Failure("STORAGE_ERROR".into()))?{return Ok(Value::Null);}
    }
    if submitted_sequence!=observed||observed<=used{return if automatic{Ok(Value::Null)}else{Err("RECOVERY_REQUIRED".into())};}
    let (observation,known)=checked_observation(db,&observation.map(|s|parse(&s)).transpose()?.unwrap_or(Value::Null))?;
    if observation["state"]=="mined"{return if automatic{Ok(Value::Null)}else{Err("PAYMENT_BLOCKED".into())};}
    if !known{return Err("RECOVERY_REQUIRED".into());}
    if observation["priorInclusion"].is_object(){
        let prior=&observation["priorInclusion"];
        let different=if let (Some(height),Some(hash))=(prior["height"].as_u64(),prior["blockHash"].as_str()){block_matches(db,height as u32,hash)?==Some(false)}else{false};
        if !different{return Err("RECOVERY_REQUIRED".into());}
    }
    let tip=observation["tip"]["height"].as_u64().ok_or(Failure("RECOVERY_REQUIRED".into()))? as u32;
    let expiry=selected["expiryHeight"].as_u64().ok_or(Failure("STORAGE_ERROR".into()))?;
    if expiry!=0&&u64::from(tip)>=expiry{return Err("TRANSACTION_EXPIRED".into());}
    let next_height=tip.checked_add(1).ok_or(Failure("PAYMENT_BLOCKED".into()))?;
    if u32::from(zcash_protocol::consensus::BranchId::for_height(p,next_height.into())) as u64!=plan["branchId"].as_u64().ok_or(Failure("STORAGE_ERROR".into()))?{return Err("PAYMENT_BLOCKED".into());}
    for parent in selected["dependsOn"].as_array().ok_or(Failure("STORAGE_ERROR".into()))? {
        let parent=parent.as_u64().filter(|n|*n<u64::from(index)).ok_or(Failure("STORAGE_ERROR".into()))?;
        let observed:Option<String>=ext.query_row("SELECT observation FROM ext_wallet_submission WHERE operation=?1 AND step=?2",params![raw,parent],|r|r.get(0)).optional()?.flatten();
        let (observed,known)=checked_observation(db,&observed.map(|s|parse(&s)).transpose()?.unwrap_or(Value::Null))?;
        if !known||(observed["state"]!="mempool"&&observed["inclusion"]["confirmations"].as_u64().is_none_or(|n|n==0)){return if automatic{Ok(Value::Null)}else{Err("PAYMENT_BLOCKED".into())};}
    }
    let outstanding:bool=ext.query_row("SELECT EXISTS(SELECT 1 FROM ext_wallet_attempts WHERE operation=?1 AND step=?2 AND outcome='started')",params![raw,index],|r|r.get(0))?;
    if outstanding{return Err("PAYMENT_BLOCKED".into());}
    let next=wall.checked_add(interval.unwrap_or(0)).filter(|n|*n<=9007199254740991).ok_or(Failure("RESOURCE_LIMIT".into()))?;
    let consent=if let Some(origin)=origin{Some(json!({"version":1,"epoch":epoch,"binding":binding,"routeBinding":route,"origin":origin,"at":wall}).to_string())}else{None};
    let mut attempt=[0;32];getrandom::fill(&mut attempt).map_err(|_|Failure("ENTROPY_UNAVAILABLE".into()))?;
    ext.execute("INSERT INTO ext_wallet_attempts(sequence,attempt,operation,step,automatic,source,started,outcome) SELECT COALESCE(MAX(sequence),0)+1,?1,?2,?6,?3,?4,?5,'started' FROM ext_wallet_attempts",params![attempt,raw,automatic,source,wall,index])?;
    ext.execute("UPDATE ext_wallet_submission SET consent=COALESCE(?2,consent),automatic_count=automatic_count+?3,last_start=?4,next_eligible=?5,used_observation=observation_sequence WHERE operation=?1 AND step=?6",params![raw,consent,automatic as i64,wall,next,index])?;
    super::revision::advance(ext)?;
    Ok(json!({"attemptId":hex::encode(attempt),"bytes":finalized["bytes"],"txid":finalized["txid"]}))
}
pub fn payment_call(generation:u32,command:&str,input:&str)->std::result::Result<String,String>{
    (||->Result<Value>{
        if input.len()>16384{return Err("RESOURCE_LIMIT".into());}
        let input:Value=serde_json::from_str(input).map_err(|_|Failure("INVALID_ARGUMENT".into()))?;
        fields(&input,match command{
            "payment_get"|"payment_abandon"=>&["operationId"][..],
            "payment_list"=>&["afterSequence","highWater","limit","accountId"],
            "payment_recovery_position"=>&["afterSequence"],
            "payment_reconcile"=>&["operationId","wallTimeMs","policy"],
            "payment_observe"=>&["operationId","stepIndex","observation","wallTimeMs"],
            "payment_attempt_begin"=>&["operationId","stepIndex","sourceId","routeBinding","mode","origin","wallTimeMs","monotonicElapsedMs","observationSequence","policy","maximum"],
            "payment_attempt_finish"=>&["operationId","attemptId","outcome","txid","wallTimeMs","diagnosticCode"],
            _=>return Err("INVALID_ARGUMENT".into())})?;
        super::DOMAIN.with(|domain|{
            let mut domain=domain.try_borrow_mut().map_err(|_|Failure("STORAGE_BUSY".into()))?;
            if domain.failed.is_some(){return Err("DOMAIN_INVALID".into());}
            let active=domain.active.iter_mut().find(|a|a.generation==generation).ok_or(Failure("STALE_HANDLE".into()))?;
            let p=active.wallet.params().clone();
            active.wallet.transactionally_with_extension(|db,ext|->Result<Value>{
                if command=="payment_list"{return list(ext,&input);}
                if command=="payment_recovery_position"{
                    let position=sequence(&input,"afterSequence")?;
                    let high:i64=ext.query_row("SELECT COALESCE(MAX(sequence),0) FROM ext_wallet_proposals",[],|r|r.get(0))?;
                    if position>high{return Err("INVALID_ARGUMENT".into());}
                    ext.execute("UPDATE ext_wallet_submission_meta SET position=?1 WHERE id=1",[position])?;super::revision::advance(ext)?;
                    return Ok(json!({"revision":super::revision::read(ext)?,"observationPosition":position.to_string()}));
                }
                let operation=string(&input,"operationId")?;let raw=id(operation)?;
                if command=="payment_get"{return state(db,ext,&p,operation);}
                if command=="payment_abandon"{
                    let encoded:Vec<u8>=ext.query_row("SELECT CASE WHEN length(plan)<=2097152 THEN plan END FROM ext_wallet_proposals WHERE operation=?1",[&raw],|r|r.get(0)).optional()?.ok_or(Failure("OPERATION_NOT_FOUND".into()))?;
                    if abandoned(ext,&raw)?{return state(db,ext,&p,operation);}
                    let used:bool=ext.query_row("SELECT EXISTS(SELECT 1 FROM ext_wallet_pczt WHERE operation=?1 UNION ALL SELECT 1 FROM ext_wallet_pczt_artifacts WHERE operation=?1 UNION ALL SELECT 1 FROM ext_wallet_finalized WHERE operation=?1 UNION ALL SELECT 1 FROM ext_wallet_attempts WHERE operation=?1)",[&raw],|r|r.get(0))?;
                    if used{return Err("ROLE_PRECONDITION".into());}
                    let plan=zcash_client_backend::proto::proposal::Proposal::decode(&encoded[..]).map_err(|_|Failure("STORAGE_ERROR".into()))?;
                    let lock_owner=LockOwner::new(raw.as_slice().try_into().map_err(|_|Failure("STORAGE_ERROR".into()))?);
                    for step in plan.steps {for input in step.inputs {
                        if let Some(zcash_client_backend::proto::proposal::proposed_input::Value::ReceivedOutput(output))=input.value {
                            let txid=output.parse_txid().map_err(|_|Failure("STORAGE_ERROR".into()))?;
                            let pool=output.pool_type::<()>().map_err(|_|Failure("STORAGE_ERROR".into()))?;
                            db.unlock_output(&zcash_client_backend::wallet::OutputRef::new(txid,pool,output.index),lock_owner)?;
                        }
                    }}
                    ext.execute("INSERT INTO ext_wallet_abandoned VALUES(?1)",[&raw])?;super::revision::advance(ext)?;
                    return state(db,ext,&p,operation);
                }
                if command!="payment_reconcile"{require_active(ext,&raw)?;}
                if command=="payment_attempt_begin"{return begin(db,ext,&p,&input,operation);}
                let now=wall_time(&input)?;
                if review(ext,&p,operation)?.is_none(){return Err("OPERATION_NOT_FOUND".into());}
                match command {
                    "payment_reconcile"=>{
                        if let Some((max,interval))=retry_policy(&input)? {let all=super::pczt_finalize::read_all(ext,&p,operation)?;for tx in all["transactions"].as_array().ok_or(Failure("STORAGE_ERROR".into()))? {adopt_policy(ext,&raw,tx["stepIndex"].as_u64().ok_or(Failure("STORAGE_ERROR".into()))? as u32,max,interval)?;}}
                        if ext.execute("UPDATE ext_wallet_attempts SET outcome='unknown',completed=?2,diagnostic='INTERRUPTED' WHERE operation=?1 AND outcome='started'",params![raw,now])?>0{super::revision::advance(ext)?;}
                    },
                    "payment_observe"=>{
                        let index=step(&input)?;
                        let finalized=super::pczt_finalize::read_step(ext,&p,operation,index)?;if finalized.is_null(){return Err("NOT_FINALIZED".into());}
                        let mut observed=observation(&input,&finalized["txid"])?;
                        let prior:Option<String>=ext.query_row("SELECT CASE WHEN length(observation)<=8192 THEN observation END FROM ext_wallet_submission WHERE operation=?1 AND step=?2",params![raw,index],|r|r.get(0)).optional()?.flatten();
                        if let Some(prior)=prior {
                            let prior=parse(&prior)?;
                            let inclusion=if !prior["inclusion"].is_null(){&prior["inclusion"]}else{&prior["priorInclusion"]};
                            if !inclusion.is_null(){observed["priorInclusion"]=inclusion.clone();}
                        }
                        let(observed,_)=checked_observation(db,&observed)?;
                        if ext.execute("INSERT INTO ext_wallet_submission(operation,step,observation,observation_sequence) VALUES(?1,?3,?2,1) ON CONFLICT(operation,step) DO UPDATE SET observation=excluded.observation,observation_sequence=observation_sequence+1 WHERE observation_sequence<9223372036854775807",params![raw,observed.to_string(),index])?!=1{return Err("RESOURCE_LIMIT".into());}
                        super::revision::advance(ext)?;
                    },
                    "payment_attempt_finish"=>{
                        let attempt=id(string(&input,"attemptId")?)?;let outcome=string(&input,"outcome")?;
                        if !matches!(outcome,"acknowledged"|"rejected"|"unknown"){return Err("INVALID_ARGUMENT".into());}
                        let diagnostic=match input.get("diagnosticCode"){None|Some(Value::Null)=>None,Some(Value::String(s)) if !s.is_empty()&&s.len()<=64&&s.bytes().all(|b|b.is_ascii_uppercase()||b.is_ascii_digit()||b==b'_')=>Some(s.as_str()),_=>return Err("INVALID_ARGUMENT".into())};
                        if outcome=="acknowledged"||input.get("txid").is_some() {
                            let index:u32=ext.query_row("SELECT step FROM ext_wallet_attempts WHERE operation=?1 AND attempt=?2",params![raw,attempt],|r|r.get(0))?;
                            let finalized=super::pczt_finalize::read_step(ext,&p,operation,index)?;
                            if input["txid"]!=finalized["txid"]{return Err("PROTOCOL_MISMATCH".into());}
                        }
                        let previous:Option<String>=ext.query_row("SELECT outcome FROM ext_wallet_attempts WHERE operation=?1 AND attempt=?2",params![raw,attempt],|r|r.get(0)).optional()?;
                        let Some(previous)=previous else{return Err("INVALID_ARGUMENT".into())};
                        if previous!="started"&&previous!=outcome{return Err("PAYMENT_BLOCKED".into());}
                        if previous=="started"{
                            ext.execute("UPDATE ext_wallet_attempts SET outcome=?3,completed=?4,diagnostic=?5 WHERE operation=?1 AND attempt=?2",params![raw,attempt,outcome,now,diagnostic])?;super::revision::advance(ext)?;
                        }
                    },_=>unreachable!()
                }
                state(db,ext,&p,operation)
            })
        })
    })().map(|value|value.to_string()).map_err(|e|e.0)
}
