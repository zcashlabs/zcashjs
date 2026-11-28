//! View-only account policy, enforced here through public upstream APIs (#46).
//!
//! A view-only account (`AccountPurpose::ViewOnly`, upstream `has_spend_key = 0`) keeps its
//! viewing history, nullifiers and shared checkpoints, but never spending state:
//! - its notes carry no witness marks in the commitment trees ([`drop_marks`]);
//! - its balance reports no spendable or locked value ([`bucket`]);
//! - it cannot be the source of a proposal ([`refuse_spend`]).
use super::accounts::{Failure, Result};
use incrementalmerkletree::Position;
use std::collections::BTreeSet;
use zcash_client_backend::data_api::{Account, AccountPurpose, Balance, WalletCommitmentTrees, WalletRead};
use zcash_client_sqlite::{AccountUuid, ExtensionTransaction, SqlTransaction, WalletDb};

/// Positions in `marked` that belong to a view-only account's note in `pool`.
/// `commitment_tree_position` is unique per pool, so a position has exactly one owner.
fn owned(ext: &ExtensionTransaction<'_>, pool: &str, marked: &BTreeSet<Position>) -> Result<Vec<u64>> {
    if marked.is_empty() { return Ok(vec![]); }
    let positions = serde_json::to_string(&marked.iter().map(|p| u64::from(*p)).collect::<Vec<_>>())
        .map_err(|_| Failure::from("STORAGE_ERROR"))?;
    let found: String = ext.query_row(&format!(
        "SELECT json_group_array(m.value) FROM json_each(?1) m WHERE EXISTS(
           SELECT 1 FROM {pool}_received_notes rn JOIN accounts a ON a.id = rn.account_id
           WHERE rn.commitment_tree_position = m.value AND a.has_spend_key = 0)"), [positions], |r| r.get(0))?;
    serde_json::from_str(&found).map_err(|_| Failure::from("STORAGE_ERROR"))
}

/// Removes every witness mark held for a view-only account's note, immediately rather than
/// as of a checkpoint, so a rewind cannot restore it. Spending accounts are untouched.
/// Run after every scan and by the one-time legacy migration; idempotent.
pub(super) fn drop_marks<P: zcash_protocol::consensus::Parameters, CL, R>(
    db: &mut WalletDb<SqlTransaction<'_>, P, CL, R>, ext: &ExtensionTransaction<'_>,
) -> Result<()> {
    let tree = |_| Failure::from("STORAGE_ERROR");
    let marked = db.with_sapling_tree_mut(|t| t.marked_positions()).map_err(tree)?;
    for position in owned(ext, "sapling", &marked)? {
        db.with_sapling_tree_mut(|t| t.remove_mark(position.into(), None)).map_err(tree)?;
    }
    let marked = db.with_orchard_tree_mut(|t| t.marked_positions()).map_err(tree)?;
    for position in owned(ext, "orchard", &marked)? {
        db.with_orchard_tree_mut(|t| t.remove_mark(position.into(), None)).map_err(tree)?;
    }
    if let Some(marked) = db.with_ironwood_tree_mut(|t| t.marked_positions()).map_err(tree)? {
        for position in owned(ext, "ironwood", &marked)? {
            db.with_ironwood_tree_mut(|t| t.remove_mark(position.into(), None)).map_err(tree)?;
        }
    }
    Ok(())
}

pub(super) fn is_view_only<D: WalletRead<AccountId = AccountUuid>>(db: &D, account: AccountUuid) -> Result<bool>
where Failure: From<D::Error> {
    Ok(db.get_account(account)?.is_some_and(|a| a.purpose() == AccountPurpose::ViewOnly))
}

/// A view-only account's value is never spendable or locked: both are reported as pending
/// spendability, matching upstream's treatment of an output it cannot yet spend. Spendable
/// and locked notes are never pending change, so no value moves between other buckets;
/// totals and uneconomic value are unchanged.
pub(super) struct Bucket { pub total: u64, pub spendable: u64, pub locked: u64, pub change: u64, pub pending: u64, pub uneconomic: u64 }
pub(super) fn bucket(balance: &Balance, view_only: bool) -> Bucket {
    let (spendable, locked) = (u64::from(balance.spendable_value()), u64::from(balance.locked_value()));
    let pending = u64::from(balance.value_pending_spendability());
    let (spendable, locked, pending) = if view_only { (0, 0, pending + spendable + locked) } else { (spendable, locked, pending) };
    Bucket { total: u64::from(balance.total()), spendable, locked, change: u64::from(balance.change_pending_confirmation()), pending, uneconomic: u64::from(balance.uneconomic_value()) }
}
/// A proposal never selects a view-only account's inputs; upstream reports the same
/// outcome as an account with nothing spendable.
pub(super) fn refuse_spend<D: WalletRead<AccountId = AccountUuid>>(db: &D, account: AccountUuid, shielding: bool) -> Result<()>
where Failure: From<D::Error> {
    if is_view_only(db, account)? { return Err(if shielding { "NOTHING_TO_SHIELD" } else { "INSUFFICIENT_FUNDS" }.into()); }
    Ok(())
}
