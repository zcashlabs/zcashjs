//! Wallet-owned query revision; updated in the same transaction as native writes.
use rusqlite::Connection;
use zcash_client_sqlite::ExtensionTransaction;

pub(super) const TABLE: &str = "ext_wallet_revision";
pub(super) const SQL: &str = "CREATE TABLE ext_wallet_revision(id INTEGER PRIMARY KEY CHECK(id=1),epoch BLOB NOT NULL CHECK(typeof(epoch)='blob' AND length(epoch)=16),sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence>=0))";

pub(super) fn validate(conn: &Connection) -> rusqlite::Result<()> {
    let mut rows = conn.prepare("SELECT id,epoch,sequence FROM ext_wallet_revision LIMIT 2")?;
    let mut rows = rows.query([])?;
    let row = rows.next()?.ok_or(rusqlite::Error::InvalidQuery)?;
    if row.get::<_, i64>(0)? != 1 || row.get::<_, Vec<u8>>(1)?.len() != 16
        || row.get::<_, i64>(2)? < 0 || rows.next()?.is_some() {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}

pub(super) fn initialize(conn: &mut Connection, epoch: &[u8; 16]) -> Result<(), String> {
    (|| -> rusqlite::Result<()> {
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)", [TABLE], |r| r.get(0))?;
        if !exists { tx.execute_batch(SQL)?; }
        else { validate(&tx)?; }
        // Every newly acquired owner invalidates revisions from the prior owner.
        tx.execute("INSERT INTO ext_wallet_revision VALUES(1,?1,0) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,sequence=0", [epoch])?;
        tx.commit()
    })().map_err(|_| "STORAGE_INIT_FAILED".into())
}

pub(super) fn read(ext: &ExtensionTransaction<'_>) -> rusqlite::Result<String> {
    ext.query_row("SELECT epoch,sequence FROM ext_wallet_revision WHERE id=1", [], |r| {
        let epoch: Vec<u8> = r.get(0)?;
        let sequence: i64 = r.get(1)?;
        if epoch.len() != 16 || sequence < 0 { return Err(rusqlite::Error::InvalidQuery); }
        Ok(format!("{}:{sequence}", hex::encode(epoch)))
    })
}

pub(super) fn advance(ext: &ExtensionTransaction<'_>) -> rusqlite::Result<()> {
    if ext.execute("UPDATE ext_wallet_revision SET sequence=sequence+1 WHERE id=1 AND sequence<9223372036854775807", [])? != 1 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}
