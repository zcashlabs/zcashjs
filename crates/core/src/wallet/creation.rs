//! Durable creation freshness, not a second chain or account ledger.
use super::accounts::{Failure, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use zcash_client_sqlite::ExtensionTransaction;

pub(super) const TABLE: &str = "ext_wallet_creation_snapshot";
pub(super) const SQL: &str = "CREATE TABLE ext_wallet_creation_snapshot(id INTEGER PRIMARY KEY CHECK(id=1),height INTEGER CHECK(height>=0 AND height<4294967295),hash BLOB CHECK(length(hash)=32),tree BLOB CHECK(length(tree)>0 AND length(tree)<=65536),CHECK((height IS NULL)=(hash IS NULL)),CHECK(tree IS NULL OR height IS NOT NULL))";

pub(super) fn validate(conn: &Connection) -> rusqlite::Result<()> {
    let mut statement=conn.prepare("SELECT id,height,hash,tree FROM ext_wallet_creation_snapshot LIMIT 2")?;
    let mut rows=statement.query([])?;
    let row=rows.next()?.ok_or(rusqlite::Error::InvalidQuery)?;
    let height=row.get::<_,Option<i64>>(1)?;
    let hash=row.get::<_,Option<Vec<u8>>>(2)?;
    let tree=row.get::<_,Option<Vec<u8>>>(3)?;
    if row.get::<_,i64>(0)?!=1 || height.is_some_and(|h|!(0..4294967295).contains(&h))
        || height.is_some()!=hash.is_some() || hash.is_some_and(|h|h.len()!=32)
        || tree.is_some_and(|t|height.is_none()||t.is_empty()||t.len()>65536) || rows.next()?.is_some() {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}
pub(super) fn initialize(conn: &mut Connection) -> std::result::Result<(),String> {
    (|| -> rusqlite::Result<()> {
        let tx=conn.transaction()?;
        if !tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",[TABLE],|r|r.get::<_,bool>(0))? {
            tx.execute_batch(SQL)?;
            tx.execute("INSERT INTO ext_wallet_creation_snapshot(id) VALUES(1)",[])?;
        }
        tx.commit()
    })().map_err(|_|"STORAGE_INIT_FAILED".into())
}
pub(super) fn pending(ext: &ExtensionTransaction<'_>, height:u32, hash:&[u8]) -> rusqlite::Result<()> {
    // A historical sync cannot replace a newer locally known creation target.
    ext.execute("UPDATE ext_wallet_creation_snapshot SET height=?1,hash=?2,tree=NULL WHERE id=1 AND (height IS NULL OR height<?1 OR (height=?1 AND hash!=?2))",rusqlite::params![height,hash])?;
    Ok(())
}
pub(super) fn invalidate(ext: &ExtensionTransaction<'_>) -> rusqlite::Result<()> {
    ext.execute("UPDATE ext_wallet_creation_snapshot SET tree=NULL WHERE id=1",[])?;
    Ok(())
}
pub(super) fn birthday_value(ext:&ExtensionTransaction<'_>, parameters:&[u8], genesis:&[u8]) -> Result<Value> {
    let (height,tree)=ext.query_row("SELECT height,tree FROM ext_wallet_creation_snapshot WHERE id=1",[],|r|Ok((r.get::<_,Option<u32>>(0)?,r.get::<_,Option<Vec<u8>>>(1)?)))?;
    let height=height.ok_or(Failure::from("SYNC_REQUIRED"))?;
    let tree=tree.ok_or(Failure::from("SYNC_REQUIRED"))?;
    Ok(json!({"parameters":hex::encode(parameters),"genesis":hex::encode(genesis),"firstScanHeight":height+1,
        "priorTreeState":hex::encode(tree),"source":"light-client"}))
}

// SQLite intentionally leaves its scan queue empty for pre-Sapling tips.
// Only that case may use the separately validated creation target as its tip.
pub(super) fn tip_for_target(tip:Option<u32>, target:u32, p:&crate::Document) -> Result<u32> {
    use zcash_protocol::consensus::{Parameters,NetworkUpgrade};
    tip.or_else(||p.activation_height(NetworkUpgrade::Sapling)
        .filter(|activation|target<u32::from(*activation)).map(|_|target))
        .ok_or(Failure::from("SYNC_REQUIRED"))
}
