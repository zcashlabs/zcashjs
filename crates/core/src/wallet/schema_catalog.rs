// Native SQLite source-effect catalog. See tests/wallet-schema-source.json and schema.md.
// Generated from source DDL, never from interrupted wallet samples.
use super::{Effect, Migration, Object};
pub(super) const MIGRATIONS: &[Migration] = &[
    // initial_setup; source sha256 0683485e06e39f842de6be94373cee77c9bdc3a12ae3907023800f580f3267f0
    Migration { id: 0xbc4f5e57d6004b6c990fb3538f0bfce1, dependencies: &[], effects: &[
        Effect { name: r###"accounts"###, object: Some(Object { kind: r###"table"###, table: r###"accounts"###, sql: Some(r###"CREATE TABLE accounts (
                account INTEGER PRIMARY KEY,
                extfvk TEXT NOT NULL,
                address TEXT NOT NULL
            )"###) }) },
        Effect { name: r###"blocks"###, object: Some(Object { kind: r###"table"###, table: r###"blocks"###, sql: Some(r###"CREATE TABLE blocks (
                height INTEGER PRIMARY KEY,
                hash BLOB NOT NULL,
                time INTEGER NOT NULL,
                sapling_tree BLOB NOT NULL
            )"###) }) },
        Effect { name: r###"received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"received_notes"###, sql: Some(r###"CREATE TABLE received_notes (
                id_note INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                account INTEGER NOT NULL,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rcm BLOB NOT NULL,
                nf BLOB NOT NULL UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                spent INTEGER,
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (account) REFERENCES accounts(account),
                FOREIGN KEY (spent) REFERENCES transactions(id_tx),
                CONSTRAINT tx_output UNIQUE (tx, output_index)
            )"###) }) },
        Effect { name: r###"sapling_witnesses"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_witnesses"###, sql: Some(r###"CREATE TABLE sapling_witnesses (
                id_witness INTEGER PRIMARY KEY,
                note INTEGER NOT NULL,
                block INTEGER NOT NULL,
                witness BLOB NOT NULL,
                FOREIGN KEY (note) REFERENCES received_notes(id_note),
                FOREIGN KEY (block) REFERENCES blocks(height),
                CONSTRAINT witness_height UNIQUE (note, block)
            )"###) }) },
        Effect { name: r###"sent_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sent_notes"###, sql: Some(r###"CREATE TABLE sent_notes (
                id_note INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                from_account INTEGER NOT NULL,
                address TEXT NOT NULL,
                value INTEGER NOT NULL,
                memo BLOB,
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (from_account) REFERENCES accounts(account),
                CONSTRAINT tx_output UNIQUE (tx, output_index)
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_received_notes_1"###, object: Some(Object { kind: r###"index"###, table: r###"received_notes"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_received_notes_2"###, object: Some(Object { kind: r###"index"###, table: r###"received_notes"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_sapling_witnesses_1"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_witnesses"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_sent_notes_1"###, object: Some(Object { kind: r###"index"###, table: r###"sent_notes"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_transactions_1"###, object: Some(Object { kind: r###"index"###, table: r###"transactions"###, sql: None }) },
        Effect { name: r###"transactions"###, object: Some(Object { kind: r###"table"###, table: r###"transactions"###, sql: Some(r###"CREATE TABLE transactions (
                id_tx INTEGER PRIMARY KEY,
                txid BLOB NOT NULL UNIQUE,
                created TEXT,
                block INTEGER,
                tx_index INTEGER,
                expiry_height INTEGER,
                raw BLOB,
                FOREIGN KEY (block) REFERENCES blocks(height)
            )"###) }) },
    ] },
    // utxos_table; source sha256 e01a0dace42bca9617dbdea0000fa08ed534ea6e371b8e0b9c152f2e5a06ef4b
    Migration { id: 0xa2e0ed2e8852475eb0a4f154b15b9dbe, dependencies: &[0xbc4f5e57d6004b6c990fb3538f0bfce1], effects: &[
        Effect { name: r###"sqlite_autoindex_utxos_1"###, object: Some(Object { kind: r###"index"###, table: r###"utxos"###, sql: None }) },
        Effect { name: r###"utxos"###, object: Some(Object { kind: r###"table"###, table: r###"utxos"###, sql: Some(r###"CREATE TABLE utxos (
                id_utxo INTEGER PRIMARY KEY,
                address TEXT NOT NULL,
                prevout_txid BLOB NOT NULL,
                prevout_idx INTEGER NOT NULL,
                script BLOB NOT NULL,
                value_zat INTEGER NOT NULL,
                height INTEGER NOT NULL,
                spent_in_tx INTEGER,
                FOREIGN KEY (spent_in_tx) REFERENCES transactions(id_tx),
                CONSTRAINT tx_outpoint UNIQUE (prevout_txid, prevout_idx)
            )"###) }) },
    ] },
    // ufvk_support; source sha256 ec59b9cad641fd047758dbd3eec752a19d48183c439d0825a73ff0406284c881
    Migration { id: 0xbe57ef3b388e42ea97e2678dafcf9754, dependencies: &[0xbc4f5e57d6004b6c990fb3538f0bfce1], effects: &[
        Effect { name: r###"accounts"###, object: Some(Object { kind: r###"table"###, table: r###"accounts"###, sql: Some(r###"CREATE TABLE "accounts" (
                account INTEGER PRIMARY KEY,
                ufvk TEXT NOT NULL,
                address TEXT,
                transparent_address TEXT
            )"###) }) },
        Effect { name: r###"sent_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sent_notes"###, sql: Some(r###"CREATE TABLE "sent_notes" (
                id_note INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                output_pool INTEGER NOT NULL ,
                output_index INTEGER NOT NULL,
                from_account INTEGER NOT NULL,
                address TEXT NOT NULL,
                value INTEGER NOT NULL,
                memo BLOB,
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (from_account) REFERENCES accounts(account),
                CONSTRAINT tx_output UNIQUE (tx, output_pool, output_index)
            )"###) }) },
    ] },
    // addresses_table; source sha256 c486064c25444121712edfbbf23a9d7b772cc532dcc948f392a12e6dca2186d7
    Migration { id: 0xd956978c9c874d6e815dfb8f088d094c, dependencies: &[0xbe57ef3b388e42ea97e2678dafcf9754], effects: &[
        Effect { name: r###"accounts"###, object: Some(Object { kind: r###"table"###, table: r###"accounts"###, sql: Some(r###"CREATE TABLE "accounts" (
                account INTEGER PRIMARY KEY,
                ufvk TEXT NOT NULL
            )"###) }) },
        Effect { name: r###"addresses"###, object: Some(Object { kind: r###"table"###, table: r###"addresses"###, sql: Some(r###"CREATE TABLE addresses (
                account INTEGER NOT NULL,
                diversifier_index_be BLOB NOT NULL,
                address TEXT NOT NULL,
                cached_transparent_receiver_address TEXT,
                FOREIGN KEY (account) REFERENCES accounts(account),
                CONSTRAINT diversification UNIQUE (account, diversifier_index_be)
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_addresses_1"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: None }) },
    ] },
    // add_utxo_account; source sha256 5bad41bd91ac61eaec248fc9efcf1be9046bffc9faa0f66a1739926a7424e355
    Migration { id: 0x761884d630d844efb2040b82551c4ca1, dependencies: &[0xa2e0ed2e8852475eb0a4f154b15b9dbe, 0xd956978c9c874d6e815dfb8f088d094c], effects: &[
        Effect { name: r###"utxos"###, object: Some(Object { kind: r###"table"###, table: r###"utxos"###, sql: Some(r###"CREATE TABLE "utxos" (
                id_utxo INTEGER PRIMARY KEY,
                received_by_account INTEGER NOT NULL,
                address TEXT NOT NULL,
                prevout_txid BLOB NOT NULL,
                prevout_idx INTEGER NOT NULL,
                script BLOB NOT NULL,
                value_zat INTEGER NOT NULL,
                height INTEGER NOT NULL,
                spent_in_tx INTEGER,
                FOREIGN KEY (received_by_account) REFERENCES accounts(account),
                FOREIGN KEY (spent_in_tx) REFERENCES transactions(id_tx),
                CONSTRAINT tx_outpoint UNIQUE (prevout_txid, prevout_idx)
            )"###) }) },
    ] },
    // sent_notes_to_internal; source sha256 6931e56dd90607ce6621a629d5ee4c78aa232a87c33db9c5b4201e06a8e0137a
    Migration { id: 0x0ddbe561825942129ab766fdc4a74e1d, dependencies: &[0xbe57ef3b388e42ea97e2678dafcf9754], effects: &[
        Effect { name: r###"sent_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sent_notes"###, sql: Some(r###"CREATE TABLE "sent_notes" (
                id_note INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                output_pool INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                from_account INTEGER NOT NULL,
                to_address TEXT,
                to_account INTEGER,
                value INTEGER NOT NULL,
                memo BLOB,
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (from_account) REFERENCES accounts(account),
                FOREIGN KEY (to_account) REFERENCES accounts(account),
                CONSTRAINT tx_output UNIQUE (tx, output_pool, output_index),
                CONSTRAINT note_recipient CHECK (
                    (to_address IS NOT NULL) != (to_account IS NOT NULL)
                )
            )"###) }) },
    ] },
    // add_transaction_views; source sha256 d4063973e8204d8be29a1cadb9bb68a3f056628b2b03cc81b6d2e233704a23ca
    Migration { id: 0x282fad2e83724ca08bed71821320909f, dependencies: &[0x761884d630d844efb2040b82551c4ca1, 0x0ddbe561825942129ab766fdc4a74e1d], effects: &[
        Effect { name: r###"transactions"###, object: Some(Object { kind: r###"table"###, table: r###"transactions"###, sql: Some(r###"CREATE TABLE transactions (
                id_tx INTEGER PRIMARY KEY,
                txid BLOB NOT NULL UNIQUE,
                created TEXT,
                block INTEGER,
                tx_index INTEGER,
                expiry_height INTEGER,
                raw BLOB, fee INTEGER,
                FOREIGN KEY (block) REFERENCES blocks(height)
            )"###) }) },
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            SELECT notes.id_tx,
                   notes.mined_height,
                   notes.tx_index,
                   notes.txid,
                   notes.expiry_height,
                   notes.raw,
                   SUM(notes.value) + MAX(notes.fee) AS net_value,
                   MAX(notes.fee)                    AS fee_paid,
                   SUM(notes.sent_count) == 0        AS is_wallet_internal,
                   SUM(notes.is_change) > 0          AS has_change,
                   SUM(notes.sent_count)             AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present)           AS memo_count,
                   blocks.time                       AS block_time
            FROM (
                SELECT transactions.id_tx            AS id_tx,
                       transactions.block            AS mined_height,
                       transactions.tx_index         AS tx_index,
                       transactions.txid             AS txid,
                       transactions.expiry_height    AS expiry_height,
                       transactions.raw              AS raw,
                       0                             AS fee,
                       CASE
                            WHEN received_notes.is_change THEN 0
                            ELSE value
                       END AS value,
                       0                             AS sent_count,
                       CASE
                            WHEN received_notes.is_change THEN 1
                            ELSE 0
                       END AS is_change,
                       CASE
                            WHEN received_notes.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                           WHEN received_notes.memo IS NULL THEN 0
                           ELSE 1
                       END AS memo_present
                FROM   transactions
                       JOIN received_notes ON transactions.id_tx = received_notes.tx
                UNION
                SELECT transactions.id_tx            AS id_tx,
                       transactions.block            AS mined_height,
                       transactions.tx_index         AS tx_index,
                       transactions.txid             AS txid,
                       transactions.expiry_height    AS expiry_height,
                       transactions.raw              AS raw,
                       transactions.fee              AS fee,
                       -sent_notes.value             AS value,
                       CASE
                           WHEN sent_notes.from_account = sent_notes.to_account THEN 0
                           ELSE 1
                       END AS sent_count,
                       0                             AS is_change,
                       0                             AS received_count,
                       CASE
                           WHEN sent_notes.memo IS NULL THEN 0
                           ELSE 1
                       END AS memo_present
                FROM   transactions
                       JOIN sent_notes ON transactions.id_tx = sent_notes.tx
            ) AS notes
            LEFT JOIN blocks ON notes.mined_height = blocks.height
            GROUP BY notes.id_tx"###) }) },
        Effect { name: r###"v_tx_received"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_received"###, sql: Some(r###"CREATE VIEW v_tx_received AS
            SELECT transactions.id_tx            AS id_tx,
                   transactions.block            AS mined_height,
                   transactions.tx_index         AS tx_index,
                   transactions.txid             AS txid,
                   transactions.expiry_height    AS expiry_height,
                   transactions.raw              AS raw,
                   MAX(received_notes.account)   AS received_by_account,
                   SUM(received_notes.value)     AS received_total,
                   COUNT(received_notes.id_note) AS received_note_count,
                   SUM(
                       CASE
                           WHEN received_notes.memo IS NULL THEN 0
                           ELSE 1
                       END
                   ) AS memo_count,
                   blocks.time                   AS block_time
            FROM   transactions
                   JOIN received_notes
                          ON transactions.id_tx = received_notes.tx
                   LEFT JOIN blocks
                          ON transactions.block = blocks.height
            GROUP BY received_notes.tx, received_notes.account"###) }) },
        Effect { name: r###"v_tx_sent"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_sent"###, sql: Some(r###"CREATE VIEW v_tx_sent AS
            SELECT transactions.id_tx           AS id_tx,
                   transactions.block           AS mined_height,
                   transactions.tx_index        AS tx_index,
                   transactions.txid            AS txid,
                   transactions.expiry_height   AS expiry_height,
                   transactions.raw             AS raw,
                   MAX(sent_notes.from_account) AS sent_from_account,
                   SUM(sent_notes.value)        AS sent_total,
                   COUNT(sent_notes.id_note)    AS sent_note_count,
                   SUM(
                       CASE
                           WHEN sent_notes.memo IS NULL THEN 0
                           ELSE 1
                       END
                   ) AS memo_count,
                   blocks.time                  AS block_time
            FROM   transactions
                   JOIN sent_notes
                          ON transactions.id_tx = sent_notes.tx
                   LEFT JOIN blocks
                          ON transactions.block = blocks.height
            GROUP BY sent_notes.tx, sent_notes.from_account"###) }) },
    ] },
    // v_transactions_net; source sha256 172a8826dd668ff31d70ce6deea2aca08bd0aebe3b1df2fa79aa8852acaa2348
    Migration { id: 0x2aa4d24f51aa4a4c8d9be5b8a762865f, dependencies: &[0x282fad2e83724ca08bed71821320909f], effects: &[
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                SELECT received_notes.account        AS account_id,
                       received_notes.tx             AS id_tx,
                       2                             AS pool,
                       received_notes.value          AS value,
                       CASE
                            WHEN received_notes.is_change THEN 1
                            ELSE 0
                       END AS is_change,
                       CASE
                            WHEN received_notes.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                           WHEN received_notes.memo IS NULL THEN 0
                           ELSE 1
                       END AS memo_present
                FROM   received_notes
                UNION
                SELECT utxos.received_by_account     AS account_id,
                       transactions.id_tx            AS id_tx,
                       0                             AS pool,
                       utxos.value_zat               AS value,
                       0                             AS is_change,
                       1                             AS received_count,
                       0                             AS memo_present
                FROM utxos
                JOIN transactions
                     ON transactions.txid = utxos.prevout_txid
                UNION
                SELECT received_notes.account        AS account_id,
                       received_notes.spent          AS id_tx,
                       2                             AS pool,
                       -received_notes.value         AS value,
                       0                             AS is_change,
                       0                             AS received_count,
                       0                             AS memo_present
                FROM   received_notes
                WHERE  received_notes.spent IS NOT NULL
            ),
            sent_note_counts AS (
                SELECT sent_notes.from_account AS account_id,
                       sent_notes.tx AS id_tx,
                       COUNT(DISTINCT sent_notes.id_note) as sent_notes,
                       SUM(
                         CASE
                             WHEN sent_notes.memo IS NULL THEN 0
                             ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                LEFT JOIN received_notes
                          ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                             (received_notes.tx, 2, received_notes.output_index)
                WHERE  received_notes.is_change IS NULL
                   OR  received_notes.is_change = 0
                GROUP BY account_id, id_tx
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) as max_height FROM blocks
            )
            SELECT notes.account_id                  AS account_id,
                   transactions.id_tx                AS id_tx,
                   transactions.block                AS mined_height,
                   transactions.tx_index             AS tx_index,
                   transactions.txid                 AS txid,
                   transactions.expiry_height        AS expiry_height,
                   transactions.raw                  AS raw,
                   SUM(notes.value)                  AS account_balance_delta,
                   transactions.fee                  AS fee_paid,
                   SUM(notes.is_change) > 0          AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        blocks.height IS NULL
                        AND transactions.expiry_height <= blocks_max_height.max_height
                   ) AS expired_unmined
            FROM transactions
            JOIN notes ON notes.id_tx = transactions.id_tx
            JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = transactions.block
            LEFT JOIN sent_note_counts
                      ON sent_note_counts.account_id = notes.account_id
                      AND sent_note_counts.id_tx = notes.id_tx
            GROUP BY notes.account_id, transactions.id_tx"###) }) },
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            SELECT received_notes.tx           AS id_tx,
                   2                           AS output_pool,
                   received_notes.output_index AS output_index,
                   sent_notes.from_account     AS from_account,
                   received_notes.account      AS to_account,
                   NULL                        AS to_address,
                   received_notes.value        AS value,
                   received_notes.is_change    AS is_change,
                   received_notes.memo         AS memo
            FROM received_notes
            LEFT JOIN sent_notes
                      ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                         (received_notes.tx, 2, sent_notes.output_index)
            UNION
            SELECT transactions.id_tx          AS id_tx,
                   0                           AS output_pool,
                   utxos.prevout_idx           AS output_index,
                   NULL                        AS from_account,
                   utxos.received_by_account   AS to_account,
                   utxos.address               AS to_address,
                   utxos.value_zat             AS value,
                   false                       AS is_change,
                   NULL                        AS memo
            FROM utxos
            JOIN transactions
                 ON transactions.txid = utxos.prevout_txid
            UNION
            SELECT sent_notes.tx               AS id_tx,
                   sent_notes.output_pool      AS output_pool,
                   sent_notes.output_index     AS output_index,
                   sent_notes.from_account     AS from_account,
                   received_notes.account      AS to_account,
                   sent_notes.to_address       AS to_address,
                   sent_notes.value            AS value,
                   false                       AS is_change,
                   sent_notes.memo             AS memo
            FROM sent_notes
            LEFT JOIN received_notes
                      ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                         (received_notes.tx, 2, received_notes.output_index)
            WHERE  received_notes.is_change IS NULL
               OR  received_notes.is_change = 0"###) }) },
        Effect { name: r###"v_tx_received"###, object: None },
        Effect { name: r###"v_tx_sent"###, object: None },
    ] },
    // received_notes_nullable_nf; source sha256 f1cf1704d1e4ad38d040f03b89c314d76d68c58d5cc3d93b0a5621441867d8aa
    Migration { id: 0xbdcdcedc7b294f1c830735f937f0d32a, dependencies: &[0x2aa4d24f51aa4a4c8d9be5b8a762865f], effects: &[
        Effect { name: r###"received_notes"###, object: None },
        Effect { name: r###"sapling_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE TABLE sapling_received_notes (
                id_note INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                account INTEGER NOT NULL,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rcm BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                spent INTEGER,
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (account) REFERENCES accounts(account),
                FOREIGN KEY (spent) REFERENCES transactions(id_tx),
                CONSTRAINT tx_output UNIQUE (tx, output_index)
            )"###) }) },
        Effect { name: r###"sapling_witnesses"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_witnesses"###, sql: Some(r###"CREATE TABLE sapling_witnesses (
                id_witness INTEGER PRIMARY KEY,
                note INTEGER NOT NULL,
                block INTEGER NOT NULL,
                witness BLOB NOT NULL,
                FOREIGN KEY (note) REFERENCES sapling_received_notes(id_note),
                FOREIGN KEY (block) REFERENCES blocks(height),
                CONSTRAINT witness_height UNIQUE (note, block)
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_received_notes_1"###, object: None },
        Effect { name: r###"sqlite_autoindex_received_notes_2"###, object: None },
        Effect { name: r###"sqlite_autoindex_sapling_received_notes_1"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_notes"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_sapling_received_notes_2"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_notes"###, sql: None }) },
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                SELECT sapling_received_notes.account        AS account_id,
                       sapling_received_notes.tx             AS id_tx,
                       2                             AS pool,
                       sapling_received_notes.value          AS value,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 1
                            ELSE 0
                       END AS is_change,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                           WHEN sapling_received_notes.memo IS NULL THEN 0
                           ELSE 1
                       END AS memo_present
                FROM   sapling_received_notes
                UNION
                SELECT utxos.received_by_account     AS account_id,
                       transactions.id_tx            AS id_tx,
                       0                             AS pool,
                       utxos.value_zat               AS value,
                       0                             AS is_change,
                       1                             AS received_count,
                       0                             AS memo_present
                FROM utxos
                JOIN transactions
                     ON transactions.txid = utxos.prevout_txid
                UNION
                SELECT sapling_received_notes.account        AS account_id,
                       sapling_received_notes.spent          AS id_tx,
                       2                             AS pool,
                       -sapling_received_notes.value         AS value,
                       0                             AS is_change,
                       0                             AS received_count,
                       0                             AS memo_present
                FROM   sapling_received_notes
                WHERE  sapling_received_notes.spent IS NOT NULL
            ),
            sent_note_counts AS (
                SELECT sent_notes.from_account AS account_id,
                       sent_notes.tx AS id_tx,
                       COUNT(DISTINCT sent_notes.id_note) as sent_notes,
                       SUM(
                         CASE
                             WHEN sent_notes.memo IS NULL THEN 0
                             ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                LEFT JOIN sapling_received_notes
                          ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                             (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
                WHERE  sapling_received_notes.is_change IS NULL
                   OR  sapling_received_notes.is_change = 0
                GROUP BY account_id, id_tx
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) as max_height FROM blocks
            )
            SELECT notes.account_id                  AS account_id,
                   transactions.id_tx                AS id_tx,
                   transactions.block                AS mined_height,
                   transactions.tx_index             AS tx_index,
                   transactions.txid                 AS txid,
                   transactions.expiry_height        AS expiry_height,
                   transactions.raw                  AS raw,
                   SUM(notes.value)                  AS account_balance_delta,
                   transactions.fee                  AS fee_paid,
                   SUM(notes.is_change) > 0          AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        blocks.height IS NULL
                        AND transactions.expiry_height <= blocks_max_height.max_height
                   ) AS expired_unmined
            FROM transactions
            JOIN notes ON notes.id_tx = transactions.id_tx
            JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = transactions.block
            LEFT JOIN sent_note_counts
                      ON sent_note_counts.account_id = notes.account_id
                      AND sent_note_counts.id_tx = notes.id_tx
            GROUP BY notes.account_id, transactions.id_tx"###) }) },
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            SELECT sapling_received_notes.tx           AS id_tx,
                   2                                   AS output_pool,
                   sapling_received_notes.output_index AS output_index,
                   sent_notes.from_account             AS from_account,
                   sapling_received_notes.account      AS to_account,
                   NULL                                AS to_address,
                   sapling_received_notes.value        AS value,
                   sapling_received_notes.is_change    AS is_change,
                   sapling_received_notes.memo         AS memo
            FROM sapling_received_notes
            LEFT JOIN sent_notes
                      ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                         (sapling_received_notes.tx, 2, sent_notes.output_index)
            UNION
            SELECT transactions.id_tx          AS id_tx,
                   0                           AS output_pool,
                   utxos.prevout_idx           AS output_index,
                   NULL                        AS from_account,
                   utxos.received_by_account   AS to_account,
                   utxos.address               AS to_address,
                   utxos.value_zat             AS value,
                   false                       AS is_change,
                   NULL                        AS memo
            FROM utxos
            JOIN transactions
                 ON transactions.txid = utxos.prevout_txid
            UNION
            SELECT sent_notes.tx                  AS id_tx,
                   sent_notes.output_pool         AS output_pool,
                   sent_notes.output_index        AS output_index,
                   sent_notes.from_account        AS from_account,
                   sapling_received_notes.account AS to_account,
                   sent_notes.to_address          AS to_address,
                   sent_notes.value               AS value,
                   false                          AS is_change,
                   sent_notes.memo                AS memo
            FROM sent_notes
            LEFT JOIN sapling_received_notes
                      ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                         (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
            WHERE  sapling_received_notes.is_change IS NULL
               OR  sapling_received_notes.is_change = 0"###) }) },
    ] },
    // shardtree_support; source sha256 7281bf86e973059fed17a3dcff7e027154942f5238925b4c64d9e4c6a748736c
    Migration { id: 0x7da6489de83546578be5f512bcce6cbf, dependencies: &[0xbdcdcedc7b294f1c830735f937f0d32a], effects: &[
        Effect { name: r###"blocks"###, object: Some(Object { kind: r###"table"###, table: r###"blocks"###, sql: Some(r###"CREATE TABLE blocks (
                height INTEGER PRIMARY KEY,
                hash BLOB NOT NULL,
                time INTEGER NOT NULL,
                sapling_tree BLOB NOT NULL
            , sapling_commitment_tree_size INTEGER, orchard_commitment_tree_size INTEGER)"###) }) },
        Effect { name: r###"sapling_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE TABLE sapling_received_notes (
                id_note INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                account INTEGER NOT NULL,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rcm BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                spent INTEGER, commitment_tree_position INTEGER,
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (account) REFERENCES accounts(account),
                FOREIGN KEY (spent) REFERENCES transactions(id_tx),
                CONSTRAINT tx_output UNIQUE (tx, output_index)
            )"###) }) },
        Effect { name: r###"sapling_tree_cap"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_tree_cap"###, sql: Some(r###"CREATE TABLE sapling_tree_cap (
                -- cap_id exists only to be able to take advantage of `ON CONFLICT`
                -- upsert functionality; the table will only ever contain one row
                cap_id INTEGER PRIMARY KEY,
                cap_data BLOB NOT NULL
            )"###) }) },
        Effect { name: r###"sapling_tree_checkpoint_marks_removed"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_tree_checkpoint_marks_removed"###, sql: Some(r###"CREATE TABLE sapling_tree_checkpoint_marks_removed (
                checkpoint_id INTEGER NOT NULL,
                mark_removed_position INTEGER NOT NULL,
                FOREIGN KEY (checkpoint_id) REFERENCES sapling_tree_checkpoints(checkpoint_id)
                ON DELETE CASCADE,
                CONSTRAINT spend_position_unique UNIQUE (checkpoint_id, mark_removed_position)
            )"###) }) },
        Effect { name: r###"sapling_tree_checkpoints"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_tree_checkpoints"###, sql: Some(r###"CREATE TABLE sapling_tree_checkpoints (
                checkpoint_id INTEGER PRIMARY KEY,
                position INTEGER
            )"###) }) },
        Effect { name: r###"sapling_tree_shards"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_tree_shards"###, sql: Some(r###"CREATE TABLE sapling_tree_shards (
                shard_index INTEGER PRIMARY KEY,
                subtree_end_height INTEGER,
                root_hash BLOB,
                shard_data BLOB,
                contains_marked INTEGER,
                CONSTRAINT root_unique UNIQUE (root_hash)
            )"###) }) },
        Effect { name: r###"scan_queue"###, object: Some(Object { kind: r###"table"###, table: r###"scan_queue"###, sql: Some(r###"CREATE TABLE scan_queue (
                block_range_start INTEGER NOT NULL,
                block_range_end INTEGER NOT NULL,
                priority INTEGER NOT NULL,
                CONSTRAINT range_start_uniq UNIQUE (block_range_start),
                CONSTRAINT range_end_uniq UNIQUE (block_range_end),
                CONSTRAINT range_bounds_order CHECK (
                    block_range_start < block_range_end
                )
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_sapling_tree_checkpoint_marks_removed_1"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_tree_checkpoint_marks_removed"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_sapling_tree_shards_1"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_tree_shards"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_scan_queue_1"###, object: Some(Object { kind: r###"index"###, table: r###"scan_queue"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_scan_queue_2"###, object: Some(Object { kind: r###"index"###, table: r###"scan_queue"###, sql: None }) },
    ] },
    // orchard_shardtree; source sha256 ab0ddcba9fec4ea083fd32a4d03d8bcb12fc1efe1787aa5c3d998f56ee6c5549
    Migration { id: 0x3a6487f7e06842bb9d126bb8dbe6da00, dependencies: &[0x7da6489de83546578be5f512bcce6cbf], effects: &[
        Effect { name: r###"orchard_tree_cap"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_tree_cap"###, sql: Some(r###"CREATE TABLE orchard_tree_cap (
                -- cap_id exists only to be able to take advantage of `ON CONFLICT`
                -- upsert functionality; the table will only ever contain one row
                cap_id INTEGER PRIMARY KEY,
                cap_data BLOB NOT NULL
            )"###) }) },
        Effect { name: r###"orchard_tree_checkpoint_marks_removed"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_tree_checkpoint_marks_removed"###, sql: Some(r###"CREATE TABLE orchard_tree_checkpoint_marks_removed (
                checkpoint_id INTEGER NOT NULL,
                mark_removed_position INTEGER NOT NULL,
                FOREIGN KEY (checkpoint_id) REFERENCES orchard_tree_checkpoints(checkpoint_id)
                ON DELETE CASCADE,
                CONSTRAINT spend_position_unique UNIQUE (checkpoint_id, mark_removed_position)
            )"###) }) },
        Effect { name: r###"orchard_tree_checkpoints"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_tree_checkpoints"###, sql: Some(r###"CREATE TABLE orchard_tree_checkpoints (
                checkpoint_id INTEGER PRIMARY KEY,
                position INTEGER
            )"###) }) },
        Effect { name: r###"orchard_tree_shards"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_tree_shards"###, sql: Some(r###"CREATE TABLE orchard_tree_shards (
                shard_index INTEGER PRIMARY KEY,
                subtree_end_height INTEGER,
                root_hash BLOB,
                shard_data BLOB,
                contains_marked INTEGER,
                CONSTRAINT root_unique UNIQUE (root_hash)
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_orchard_tree_checkpoint_marks_removed_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_tree_checkpoint_marks_removed"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_orchard_tree_shards_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_tree_shards"###, sql: None }) },
        Effect { name: r###"v_orchard_shard_scan_ranges"###, object: Some(Object { kind: r###"view"###, table: r###"v_orchard_shard_scan_ranges"###, sql: Some(r###"CREATE VIEW v_orchard_shard_scan_ranges AS
                SELECT
                    shard.shard_index,
                    shard.shard_index << 16 AS start_position,
                    (shard.shard_index + 1) << 16 AS end_position_exclusive,
                    IFNULL(prev_shard.subtree_end_height, @ACTIVATION@) AS subtree_start_height,
                    shard.subtree_end_height,
                    shard.contains_marked,
                    scan_queue.block_range_start,
                    scan_queue.block_range_end,
                    scan_queue.priority
                FROM orchard_tree_shards shard
                LEFT OUTER JOIN orchard_tree_shards prev_shard
                    ON shard.shard_index = prev_shard.shard_index + 1
                -- Join with scan ranges that overlap with the subtree's involved blocks.
                INNER JOIN scan_queue ON (
                    subtree_start_height < scan_queue.block_range_end AND
                    (
                        scan_queue.block_range_start <= shard.subtree_end_height OR
                        shard.subtree_end_height IS NULL
                    )
                )"###) }) },
        Effect { name: r###"v_orchard_shard_unscanned_ranges"###, object: Some(Object { kind: r###"view"###, table: r###"v_orchard_shard_unscanned_ranges"###, sql: Some(r###"CREATE VIEW v_orchard_shard_unscanned_ranges AS
                WITH wallet_birthday AS (SELECT MIN(birthday_height) AS height FROM accounts)
                SELECT
                    shard_index,
                    start_position,
                    end_position_exclusive,
                    subtree_start_height,
                    subtree_end_height,
                    contains_marked,
                    block_range_start,
                    block_range_end,
                    priority
                FROM v_orchard_shard_scan_ranges
                INNER JOIN wallet_birthday
                WHERE priority > 10
                AND block_range_end > wallet_birthday.height"###) }) },
        Effect { name: r###"v_orchard_shards_scan_state"###, object: Some(Object { kind: r###"view"###, table: r###"v_orchard_shards_scan_state"###, sql: Some(r###"CREATE VIEW v_orchard_shards_scan_state AS
            SELECT
                shard_index,
                start_position,
                end_position_exclusive,
                subtree_start_height,
                subtree_end_height,
                contains_marked,
                MAX(priority) AS max_priority
            FROM v_orchard_shard_scan_ranges
            GROUP BY
                shard_index,
                start_position,
                end_position_exclusive,
                subtree_start_height,
                subtree_end_height,
                contains_marked"###) }) },
    ] },
    // receiving_key_scopes; source sha256 b9bbaffcd5692e0ace89042923a8209568803aec74a080e8559ce3359856548b
    Migration { id: 0xee89ed2bc1c2421e9e98c1e3e54a7fc2, dependencies: &[0x7da6489de83546578be5f512bcce6cbf], effects: &[
        Effect { name: r###"sapling_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE TABLE sapling_received_notes (
                id_note INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                account INTEGER NOT NULL,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rcm BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                spent INTEGER, commitment_tree_position INTEGER, recipient_key_scope INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (account) REFERENCES accounts(account),
                FOREIGN KEY (spent) REFERENCES transactions(id_tx),
                CONSTRAINT tx_output UNIQUE (tx, output_index)
            )"###) }) },
    ] },
    // add_account_birthdays; source sha256 7584f087b0796a566cac0fe0f2e2e225171a297cabe5310739a0f9662f871e42
    Migration { id: 0xeeec0d0dfee042318c685f3a7c7c2245, dependencies: &[0x7da6489de83546578be5f512bcce6cbf], effects: &[
        Effect { name: r###"accounts"###, object: Some(Object { kind: r###"table"###, table: r###"accounts"###, sql: Some(r###"CREATE TABLE "accounts" (
                account INTEGER PRIMARY KEY,
                ufvk TEXT NOT NULL,
                birthday_height INTEGER NOT NULL,
                recover_until_height INTEGER
            )"###) }) },
    ] },
    // sapling_memo_consistency; source sha256 57fdec420b7e06f2ea294370af2154c288ff0bfaebb3ad0c725639c222a32472
    Migration { id: 0x7029b90465574aa19da56904b65d2ba5, dependencies: &[0xbdcdcedc7b294f1c830735f937f0d32a], effects: &[
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                SELECT sapling_received_notes.account        AS account_id,
                       sapling_received_notes.tx             AS id_tx,
                       2                             AS pool,
                       sapling_received_notes.value          AS value,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 1
                            ELSE 0
                       END AS is_change,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (sapling_received_notes.memo IS NULL OR sapling_received_notes.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present
                FROM   sapling_received_notes
                UNION
                SELECT utxos.received_by_account     AS account_id,
                       transactions.id_tx            AS id_tx,
                       0                             AS pool,
                       utxos.value_zat               AS value,
                       0                             AS is_change,
                       1                             AS received_count,
                       0                             AS memo_present
                FROM utxos
                JOIN transactions
                     ON transactions.txid = utxos.prevout_txid
                UNION
                SELECT sapling_received_notes.account        AS account_id,
                       sapling_received_notes.spent          AS id_tx,
                       2                             AS pool,
                       -sapling_received_notes.value         AS value,
                       0                             AS is_change,
                       0                             AS received_count,
                       0                             AS memo_present
                FROM   sapling_received_notes
                WHERE  sapling_received_notes.spent IS NOT NULL
            ),
            sent_note_counts AS (
                SELECT sent_notes.from_account AS account_id,
                       sent_notes.tx AS id_tx,
                       COUNT(DISTINCT sent_notes.id_note) as sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6')
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                LEFT JOIN sapling_received_notes
                          ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                             (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
                WHERE  sapling_received_notes.is_change IS NULL
                   OR  sapling_received_notes.is_change = 0
                GROUP BY account_id, id_tx
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) as max_height FROM blocks
            )
            SELECT notes.account_id                  AS account_id,
                   transactions.id_tx                AS id_tx,
                   transactions.block                AS mined_height,
                   transactions.tx_index             AS tx_index,
                   transactions.txid                 AS txid,
                   transactions.expiry_height        AS expiry_height,
                   transactions.raw                  AS raw,
                   SUM(notes.value)                  AS account_balance_delta,
                   transactions.fee                  AS fee_paid,
                   SUM(notes.is_change) > 0          AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        blocks.height IS NULL
                        AND transactions.expiry_height <= blocks_max_height.max_height
                   ) AS expired_unmined
            FROM transactions
            JOIN notes ON notes.id_tx = transactions.id_tx
            JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = transactions.block
            LEFT JOIN sent_note_counts
                      ON sent_note_counts.account_id = notes.account_id
                      AND sent_note_counts.id_tx = notes.id_tx
            GROUP BY notes.account_id, transactions.id_tx"###) }) },
    ] },
    // v_transactions_transparent_history; source sha256 e4bf70cf493962b52de603a4d23316048f175e48eaed6e82a2e047db9d9a6529
    Migration { id: 0xaa0a4168b41b44c5a47dc4c66603cfab, dependencies: &[0x7029b90465574aa19da56904b65d2ba5], effects: &[
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                SELECT sapling_received_notes.account        AS account_id,
                       transactions.block                    AS block,
                       transactions.txid                     AS txid,
                       2                                     AS pool,
                       sapling_received_notes.value          AS value,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 1
                            ELSE 0
                       END AS is_change,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (sapling_received_notes.memo IS NULL OR sapling_received_notes.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present
                FROM sapling_received_notes
                JOIN transactions
                     ON transactions.id_tx = sapling_received_notes.tx
                UNION
                SELECT utxos.received_by_account     AS account_id,
                       utxos.height                  AS block,
                       utxos.prevout_txid            AS txid,
                       0                             AS pool,
                       utxos.value_zat               AS value,
                       0                             AS is_change,
                       1                             AS received_count,
                       0                             AS memo_present
                FROM utxos
                UNION
                SELECT sapling_received_notes.account        AS account_id,
                       transactions.block                    AS block,
                       transactions.txid                     AS txid,
                       2                                     AS pool,
                       -sapling_received_notes.value         AS value,
                       0                             AS is_change,
                       0                             AS received_count,
                       0                             AS memo_present
                FROM sapling_received_notes
                JOIN transactions
                     ON transactions.id_tx = sapling_received_notes.spent
            ),
            sent_note_counts AS (
                SELECT sent_notes.from_account AS account_id,
                       transactions.txid       AS txid,
                       COUNT(DISTINCT sent_notes.id_note) as sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR sapling_received_notes.tx IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                JOIN transactions
                     ON transactions.id_tx = sent_notes.tx
                LEFT JOIN sapling_received_notes
                          ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                             (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
                WHERE COALESCE(sapling_received_notes.is_change, 0) = 0
                GROUP BY account_id, txid
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) as max_height FROM blocks
            )
            SELECT notes.account_id                  AS account_id,
                   notes.block                       AS mined_height,
                   notes.txid                        AS txid,
                   transactions.tx_index             AS tx_index,
                   transactions.expiry_height        AS expiry_height,
                   transactions.raw                  AS raw,
                   SUM(notes.value)                  AS account_balance_delta,
                   transactions.fee                  AS fee_paid,
                   SUM(notes.is_change) > 0          AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        blocks.height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined
            FROM notes
            LEFT JOIN transactions
                 ON notes.txid = transactions.txid
            JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = notes.block
            LEFT JOIN sent_note_counts
                      ON sent_note_counts.account_id = notes.account_id
                      AND sent_note_counts.txid = notes.txid
            GROUP BY notes.account_id, notes.txid"###) }) },
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            SELECT transactions.txid                   AS txid,
                   2                                   AS output_pool,
                   sapling_received_notes.output_index AS output_index,
                   sent_notes.from_account             AS from_account,
                   sapling_received_notes.account      AS to_account,
                   NULL                                AS to_address,
                   sapling_received_notes.value        AS value,
                   sapling_received_notes.is_change    AS is_change,
                   sapling_received_notes.memo         AS memo
            FROM sapling_received_notes
            JOIN transactions
                 ON transactions.id_tx = sapling_received_notes.tx
            LEFT JOIN sent_notes
                      ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                         (sapling_received_notes.tx, 2, sent_notes.output_index)
            UNION
            SELECT utxos.prevout_txid          AS txid,
                   0                           AS output_pool,
                   utxos.prevout_idx           AS output_index,
                   NULL                        AS from_account,
                   utxos.received_by_account   AS to_account,
                   utxos.address               AS to_address,
                   utxos.value_zat             AS value,
                   false                       AS is_change,
                   NULL                        AS memo
            FROM utxos
            UNION
            SELECT transactions.txid              AS txid,
                   sent_notes.output_pool         AS output_pool,
                   sent_notes.output_index        AS output_index,
                   sent_notes.from_account        AS from_account,
                   sapling_received_notes.account AS to_account,
                   sent_notes.to_address          AS to_address,
                   sent_notes.value               AS value,
                   false                          AS is_change,
                   sent_notes.memo                AS memo
            FROM sent_notes
            JOIN transactions
                 ON transactions.id_tx = sent_notes.tx
            LEFT JOIN sapling_received_notes
                      ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                         (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
            WHERE COALESCE(sapling_received_notes.is_change, 0) = 0"###) }) },
    ] },
    // v_tx_outputs_use_legacy_false; source sha256 b19ac5bbb906b5d487735018949c3036f57a7e9d1d3e898f2b21fb678cd2142c
    Migration { id: 0xb3e21434286f41f38d7144cce968ab2b, dependencies: &[0xaa0a4168b41b44c5a47dc4c66603cfab], effects: &[
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            SELECT transactions.txid                   AS txid,
                   2                                   AS output_pool,
                   sapling_received_notes.output_index AS output_index,
                   sent_notes.from_account             AS from_account,
                   sapling_received_notes.account      AS to_account,
                   NULL                                AS to_address,
                   sapling_received_notes.value        AS value,
                   sapling_received_notes.is_change    AS is_change,
                   sapling_received_notes.memo         AS memo
            FROM sapling_received_notes
            JOIN transactions
                 ON transactions.id_tx = sapling_received_notes.tx
            LEFT JOIN sent_notes
                      ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                         (sapling_received_notes.tx, 2, sent_notes.output_index)
            UNION
            SELECT utxos.prevout_txid          AS txid,
                   0                           AS output_pool,
                   utxos.prevout_idx           AS output_index,
                   NULL                        AS from_account,
                   utxos.received_by_account   AS to_account,
                   utxos.address               AS to_address,
                   utxos.value_zat             AS value,
                   0                           AS is_change,
                   NULL                        AS memo
            FROM utxos
            UNION
            SELECT transactions.txid              AS txid,
                   sent_notes.output_pool         AS output_pool,
                   sent_notes.output_index        AS output_index,
                   sent_notes.from_account        AS from_account,
                   sapling_received_notes.account AS to_account,
                   sent_notes.to_address          AS to_address,
                   sent_notes.value               AS value,
                   0                              AS is_change,
                   sent_notes.memo                AS memo
            FROM sent_notes
            JOIN transactions
                 ON transactions.id_tx = sent_notes.tx
            LEFT JOIN sapling_received_notes
                      ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                         (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
            WHERE COALESCE(sapling_received_notes.is_change, 0) = 0"###) }) },
    ] },
    // v_transactions_shielding_balance; source sha256 ec2ed96b26e81ee8b76a023ef1511cf1b6d42b87e030f1b32f63469fc86988b1
    Migration { id: 0xb8fe51124365473c8b422b07c0f0adaf, dependencies: &[0xb3e21434286f41f38d7144cce968ab2b], effects: &[
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                SELECT sapling_received_notes.account        AS account_id,
                       transactions.block                    AS block,
                       transactions.txid                     AS txid,
                       2                                     AS pool,
                       sapling_received_notes.value          AS value,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 1
                            ELSE 0
                       END AS is_change,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (sapling_received_notes.memo IS NULL OR sapling_received_notes.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present
                FROM sapling_received_notes
                JOIN transactions
                     ON transactions.id_tx = sapling_received_notes.tx
                UNION
                SELECT utxos.received_by_account     AS account_id,
                       utxos.height                  AS block,
                       utxos.prevout_txid            AS txid,
                       0                             AS pool,
                       utxos.value_zat               AS value,
                       0                             AS is_change,
                       1                             AS received_count,
                       0                             AS memo_present
                FROM utxos
                UNION
                SELECT sapling_received_notes.account        AS account_id,
                       transactions.block                    AS block,
                       transactions.txid                     AS txid,
                       2                                     AS pool,
                       -sapling_received_notes.value         AS value,
                       0                             AS is_change,
                       0                             AS received_count,
                       0                             AS memo_present
                FROM sapling_received_notes
                JOIN transactions
                     ON transactions.id_tx = sapling_received_notes.spent
                UNION
                SELECT utxos.received_by_account     AS account_id,
                       transactions.block            AS block,
                       transactions.txid             AS txid,
                       0                             AS pool,
                       -utxos.value_zat              AS value,
                       0                             AS is_change,
                       0                             AS received_count,
                       0                             AS memo_present
                FROM utxos
                JOIN transactions
                     ON transactions.id_tx = utxos.spent_in_tx
            ),
            sent_note_counts AS (
                SELECT sent_notes.from_account AS account_id,
                       transactions.txid       AS txid,
                       COUNT(DISTINCT sent_notes.id_note) as sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR sapling_received_notes.tx IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                JOIN transactions
                     ON transactions.id_tx = sent_notes.tx
                LEFT JOIN sapling_received_notes
                          ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                             (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
                WHERE COALESCE(sapling_received_notes.is_change, 0) = 0
                GROUP BY account_id, txid
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) as max_height FROM blocks
            )
            SELECT notes.account_id                  AS account_id,
                   notes.block                       AS mined_height,
                   notes.txid                        AS txid,
                   transactions.tx_index             AS tx_index,
                   transactions.expiry_height        AS expiry_height,
                   transactions.raw                  AS raw,
                   SUM(notes.value)                  AS account_balance_delta,
                   transactions.fee                  AS fee_paid,
                   SUM(notes.is_change) > 0          AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        blocks.height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined
            FROM notes
            LEFT JOIN transactions
                 ON notes.txid = transactions.txid
            JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = notes.block
            LEFT JOIN sent_note_counts
                      ON sent_note_counts.account_id = notes.account_id
                      AND sent_note_counts.txid = notes.txid
            GROUP BY notes.account_id, notes.txid"###) }) },
    ] },
    // v_transactions_note_uniqueness; source sha256 b65d5011432cd0444da7526b495ef5b449acc035fd5fd5a9a8c9851f71ae08e3
    Migration { id: 0xdba47c8613b5460194b20cde0abe1e45, dependencies: &[0xb8fe51124365473c8b422b07c0f0adaf], effects: &[
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                SELECT sapling_received_notes.id_note        AS id,
                       sapling_received_notes.account        AS account_id,
                       transactions.block                    AS block,
                       transactions.txid                     AS txid,
                       2                                     AS pool,
                       sapling_received_notes.value          AS value,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 1
                            ELSE 0
                       END AS is_change,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (sapling_received_notes.memo IS NULL OR sapling_received_notes.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present
                FROM sapling_received_notes
                JOIN transactions
                     ON transactions.id_tx = sapling_received_notes.tx
                UNION
                SELECT utxos.id_utxo                 AS id,
                       utxos.received_by_account     AS account_id,
                       utxos.height                  AS block,
                       utxos.prevout_txid            AS txid,
                       0                             AS pool,
                       utxos.value_zat               AS value,
                       0                             AS is_change,
                       1                             AS received_count,
                       0                             AS memo_present
                FROM utxos
                UNION
                SELECT sapling_received_notes.id_note        AS id,
                       sapling_received_notes.account        AS account_id,
                       transactions.block                    AS block,
                       transactions.txid                     AS txid,
                       2                                     AS pool,
                       -sapling_received_notes.value         AS value,
                       0                             AS is_change,
                       0                             AS received_count,
                       0                             AS memo_present
                FROM sapling_received_notes
                JOIN transactions
                     ON transactions.id_tx = sapling_received_notes.spent
                UNION
                SELECT utxos.id_utxo                 AS id,
                       utxos.received_by_account     AS account_id,
                       transactions.block            AS block,
                       transactions.txid             AS txid,
                       0                             AS pool,
                       -utxos.value_zat              AS value,
                       0                             AS is_change,
                       0                             AS received_count,
                       0                             AS memo_present
                FROM utxos
                JOIN transactions
                     ON transactions.id_tx = utxos.spent_in_tx
            ),
            sent_note_counts AS (
                SELECT sent_notes.from_account AS account_id,
                       transactions.txid       AS txid,
                       COUNT(DISTINCT sent_notes.id_note) as sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR sapling_received_notes.tx IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                JOIN transactions
                     ON transactions.id_tx = sent_notes.tx
                LEFT JOIN sapling_received_notes
                          ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                             (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
                WHERE COALESCE(sapling_received_notes.is_change, 0) = 0
                GROUP BY account_id, txid
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) as max_height FROM blocks
            )
            SELECT notes.account_id                  AS account_id,
                   notes.block                       AS mined_height,
                   notes.txid                        AS txid,
                   transactions.tx_index             AS tx_index,
                   transactions.expiry_height        AS expiry_height,
                   transactions.raw                  AS raw,
                   SUM(notes.value)                  AS account_balance_delta,
                   transactions.fee                  AS fee_paid,
                   SUM(notes.is_change) > 0          AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        blocks.height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined
            FROM notes
            LEFT JOIN transactions
                 ON notes.txid = transactions.txid
            JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = notes.block
            LEFT JOIN sent_note_counts
                      ON sent_note_counts.account_id = notes.account_id
                      AND sent_note_counts.txid = notes.txid
            GROUP BY notes.account_id, notes.txid"###) }) },
    ] },
    // v_sapling_shard_unscanned_ranges; source sha256 499d8123db79c5644105a9a4094376e3c74b82d6ae921ca96b24072c5022a64f
    Migration { id: 0xfa934bdc97b649808a83b2cb1ac465fd, dependencies: &[0xeeec0d0dfee042318c685f3a7c7c2245], effects: &[
        Effect { name: r###"v_sapling_shard_scan_ranges"###, object: Some(Object { kind: r###"view"###, table: r###"v_sapling_shard_scan_ranges"###, sql: Some(r###"CREATE VIEW v_sapling_shard_scan_ranges AS
                SELECT
                    shard.shard_index,
                    shard.shard_index << 16 AS start_position,
                    (shard.shard_index + 1) << 16 AS end_position_exclusive,
                    IFNULL(prev_shard.subtree_end_height, @ACTIVATION@) AS subtree_start_height,
                    shard.subtree_end_height,
                    shard.contains_marked,
                    scan_queue.block_range_start,
                    scan_queue.block_range_end,
                    scan_queue.priority
                FROM sapling_tree_shards shard
                LEFT OUTER JOIN sapling_tree_shards prev_shard
                    ON shard.shard_index = prev_shard.shard_index + 1
                -- Join with scan ranges that overlap with the subtree's involved blocks.
                INNER JOIN scan_queue ON (
                    subtree_start_height < scan_queue.block_range_end AND
                    (
                        scan_queue.block_range_start <= shard.subtree_end_height OR
                        shard.subtree_end_height IS NULL
                    )
                )"###) }) },
        Effect { name: r###"v_sapling_shard_unscanned_ranges"###, object: Some(Object { kind: r###"view"###, table: r###"v_sapling_shard_unscanned_ranges"###, sql: Some(r###"CREATE VIEW v_sapling_shard_unscanned_ranges AS
                WITH wallet_birthday AS (SELECT MIN(birthday_height) AS height FROM accounts)
                SELECT
                    shard_index,
                    start_position,
                    end_position_exclusive,
                    subtree_start_height,
                    subtree_end_height,
                    contains_marked,
                    block_range_start,
                    block_range_end,
                    priority
                FROM v_sapling_shard_scan_ranges
                INNER JOIN wallet_birthday
                WHERE priority > 10
                AND block_range_end > wallet_birthday.height"###) }) },
    ] },
    // wallet_summaries; source sha256 5929f50c05620b48a792310e376ec5c279dd7819adf4aedb878c5b053690d97f
    Migration { id: 0xc5bf7f71229741ff89e175e07c4e8838, dependencies: &[0xfa934bdc97b649808a83b2cb1ac465fd], effects: &[
        Effect { name: r###"blocks"###, object: Some(Object { kind: r###"table"###, table: r###"blocks"###, sql: Some(r###"CREATE TABLE blocks (
                height INTEGER PRIMARY KEY,
                hash BLOB NOT NULL,
                time INTEGER NOT NULL,
                sapling_tree BLOB NOT NULL
            , sapling_commitment_tree_size INTEGER, orchard_commitment_tree_size INTEGER, sapling_output_count INTEGER, orchard_action_count INTEGER)"###) }) },
        Effect { name: r###"v_sapling_shards_scan_state"###, object: Some(Object { kind: r###"view"###, table: r###"v_sapling_shards_scan_state"###, sql: Some(r###"CREATE VIEW v_sapling_shards_scan_state AS
            SELECT
                shard_index,
                start_position,
                end_position_exclusive,
                subtree_start_height,
                subtree_end_height,
                contains_marked,
                MAX(priority) AS max_priority
            FROM v_sapling_shard_scan_ranges
            GROUP BY
                shard_index,
                start_position,
                end_position_exclusive,
                subtree_start_height,
                subtree_end_height,
                contains_marked"###) }) },
    ] },
    // full_account_ids; source sha256 a7b2cf55603034c52ae20df73aaa4c6319954f504d44ef5811b2c55178d6bce2
    Migration { id: 0x6d02ec7687204cc6b646c4e2ce69221c, dependencies: &[0xee89ed2bc1c2421e9e98c1e3e54a7fc2, 0xeeec0d0dfee042318c685f3a7c7c2245, 0xdba47c8613b5460194b20cde0abe1e45, 0xc5bf7f71229741ff89e175e07c4e8838], effects: &[
        Effect { name: r###"accounts"###, object: Some(Object { kind: r###"table"###, table: r###"accounts"###, sql: Some(r###"CREATE TABLE "accounts" (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                account_kind INTEGER NOT NULL DEFAULT 0,
                hd_seed_fingerprint BLOB,
                hd_account_index INTEGER,
                ufvk TEXT,
                uivk TEXT NOT NULL,
                orchard_fvk_item_cache BLOB,
                sapling_fvk_item_cache BLOB,
                p2pkh_fvk_item_cache BLOB,
                birthday_height INTEGER NOT NULL,
                birthday_sapling_tree_size INTEGER,
                birthday_orchard_tree_size INTEGER,
                recover_until_height INTEGER,
                CHECK (
                  (
                    account_kind = 0
                    AND hd_seed_fingerprint IS NOT NULL
                    AND hd_account_index IS NOT NULL
                    AND ufvk IS NOT NULL
                  )
                  OR
                  (
                    account_kind = 1
                    AND hd_seed_fingerprint IS NULL
                    AND hd_account_index IS NULL
                  )
                )
            )"###) }) },
        Effect { name: r###"accounts_ufvk"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX accounts_ufvk ON "accounts" (ufvk)"###) }) },
        Effect { name: r###"accounts_uivk"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX accounts_uivk ON "accounts" (uivk)"###) }) },
        Effect { name: r###"addresses"###, object: Some(Object { kind: r###"table"###, table: r###"addresses"###, sql: Some(r###"CREATE TABLE "addresses" (
                account_id INTEGER NOT NULL,
                diversifier_index_be BLOB NOT NULL,
                address TEXT NOT NULL,
                cached_transparent_receiver_address TEXT,
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                CONSTRAINT diversification UNIQUE (account_id, diversifier_index_be)
            )"###) }) },
        Effect { name: r###"addresses_accounts"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX "addresses_accounts" ON "addresses" (
                "account_id" ASC
            )"###) }) },
        Effect { name: r###"hd_account"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX hd_account ON "accounts" (hd_seed_fingerprint, hd_account_index)"###) }) },
        Effect { name: r###"sapling_received_note_spends"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_received_note_spends"###, sql: Some(r###"CREATE TABLE sapling_received_note_spends (
                sapling_received_note_id INTEGER NOT NULL,
                transaction_id INTEGER NOT NULL,
                FOREIGN KEY (sapling_received_note_id)
                    REFERENCES sapling_received_notes(id)
                    ON DELETE CASCADE,
                FOREIGN KEY (transaction_id)
                    -- We do not delete transactions, so this does not cascade
                    REFERENCES transactions(id_tx),
                UNIQUE (sapling_received_note_id, transaction_id)
            )"###) }) },
        Effect { name: r###"sapling_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE TABLE "sapling_received_notes" (
                id INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rcm BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                CONSTRAINT tx_output UNIQUE (tx, output_index)
            )"###) }) },
        Effect { name: r###"sapling_received_notes_account"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE INDEX "sapling_received_notes_account" ON "sapling_received_notes" (
                "account_id" ASC
            )"###) }) },
        Effect { name: r###"sapling_received_notes_tx"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE INDEX "sapling_received_notes_tx" ON "sapling_received_notes" (
                "tx" ASC
            )"###) }) },
        Effect { name: r###"sapling_witnesses"###, object: None },
        Effect { name: r###"sent_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sent_notes"###, sql: Some(r###"CREATE TABLE "sent_notes" (
                id INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                output_pool INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                from_account_id INTEGER NOT NULL,
                to_address TEXT,
                to_account_id INTEGER,
                value INTEGER NOT NULL,
                memo BLOB,
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (from_account_id) REFERENCES accounts(id),
                FOREIGN KEY (to_account_id) REFERENCES accounts(id),
                CONSTRAINT tx_output UNIQUE (tx, output_pool, output_index),
                CONSTRAINT note_recipient CHECK (
                    (to_address IS NOT NULL) OR (to_account_id IS NOT NULL)
                )
            )"###) }) },
        Effect { name: r###"sent_notes_from_account"###, object: Some(Object { kind: r###"index"###, table: r###"sent_notes"###, sql: Some(r###"CREATE INDEX sent_notes_from_account ON "sent_notes" (from_account_id)"###) }) },
        Effect { name: r###"sent_notes_to_account"###, object: Some(Object { kind: r###"index"###, table: r###"sent_notes"###, sql: Some(r###"CREATE INDEX sent_notes_to_account ON "sent_notes" (to_account_id)"###) }) },
        Effect { name: r###"sent_notes_tx"###, object: Some(Object { kind: r###"index"###, table: r###"sent_notes"###, sql: Some(r###"CREATE INDEX sent_notes_tx ON "sent_notes" (tx)"###) }) },
        Effect { name: r###"sqlite_autoindex_sapling_received_note_spends_1"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_note_spends"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_sapling_witnesses_1"###, object: None },
        Effect { name: r###"sqlite_autoindex_transparent_received_output_spends_1"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_received_output_spends"###, sql: None }) },
        Effect { name: r###"sqlite_sequence"###, object: Some(Object { kind: r###"table"###, table: r###"sqlite_sequence"###, sql: Some(r###"CREATE TABLE sqlite_sequence(name,seq)"###) }) },
        Effect { name: r###"transparent_received_output_spends"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_received_output_spends"###, sql: Some(r###"CREATE TABLE transparent_received_output_spends (
                transparent_received_output_id INTEGER NOT NULL,
                transaction_id INTEGER NOT NULL,
                FOREIGN KEY (transparent_received_output_id)
                    REFERENCES utxos(id)
                    ON DELETE CASCADE,
                FOREIGN KEY (transaction_id)
                    -- We do not delete transactions, so this does not cascade
                    REFERENCES transactions(id_tx),
                UNIQUE (transparent_received_output_id, transaction_id)
            )"###) }) },
        Effect { name: r###"utxos"###, object: Some(Object { kind: r###"table"###, table: r###"utxos"###, sql: Some(r###"CREATE TABLE "utxos" (
                id INTEGER PRIMARY KEY,
                received_by_account_id INTEGER NOT NULL,
                address TEXT NOT NULL,
                prevout_txid BLOB NOT NULL,
                prevout_idx INTEGER NOT NULL,
                script BLOB NOT NULL,
                value_zat INTEGER NOT NULL,
                height INTEGER NOT NULL,
                FOREIGN KEY (received_by_account_id) REFERENCES accounts(id),
                CONSTRAINT tx_outpoint UNIQUE (prevout_txid, prevout_idx)
            )"###) }) },
        Effect { name: r###"utxos_received_by_account"###, object: Some(Object { kind: r###"index"###, table: r###"utxos"###, sql: Some(r###"CREATE INDEX utxos_received_by_account ON "utxos" (received_by_account_id)"###) }) },
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                SELECT sapling_received_notes.id             AS id,
                       sapling_received_notes.account_id     AS account_id,
                       transactions.block                    AS block,
                       transactions.txid                     AS txid,
                       2                                     AS pool,
                       sapling_received_notes.value          AS value,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 1
                            ELSE 0
                       END AS is_change,
                       CASE
                            WHEN sapling_received_notes.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (sapling_received_notes.memo IS NULL OR sapling_received_notes.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present
                FROM sapling_received_notes
                JOIN transactions
                     ON transactions.id_tx = sapling_received_notes.tx
                UNION
                SELECT utxos.id                      AS id,
                       utxos.received_by_account_id  AS account_id,
                       utxos.height                  AS block,
                       utxos.prevout_txid            AS txid,
                       0                             AS pool,
                       utxos.value_zat               AS value,
                       0                             AS is_change,
                       1                             AS received_count,
                       0                             AS memo_present
                FROM utxos
                UNION
                SELECT sapling_received_notes.id             AS id,
                       sapling_received_notes.account_id     AS account_id,
                       transactions.block                    AS block,
                       transactions.txid                     AS txid,
                       2                                     AS pool,
                       -sapling_received_notes.value         AS value,
                       0                             AS is_change,
                       0                             AS received_count,
                       0                             AS memo_present
                FROM sapling_received_notes
                JOIN sapling_received_note_spends
                     ON sapling_received_note_id = sapling_received_notes.id
                JOIN transactions
                     ON transactions.id_tx = sapling_received_note_spends.transaction_id
                UNION
                SELECT utxos.id                      AS id,
                       utxos.received_by_account_id  AS account_id,
                       transactions.block            AS block,
                       transactions.txid             AS txid,
                       0                             AS pool,
                       -utxos.value_zat              AS value,
                       0                             AS is_change,
                       0                             AS received_count,
                       0                             AS memo_present
                FROM utxos
            JOIN transparent_received_output_spends txo_spends
                 ON txo_spends.transparent_received_output_id = txos.id
            JOIN transactions
                 ON transactions.id_tx = txo_spends.transaction_id
            ),
            sent_note_counts AS (
                SELECT sent_notes.from_account_id AS account_id,
                       transactions.txid       AS txid,
                       COUNT(DISTINCT sent_notes.id) as sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR sapling_received_notes.tx IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                JOIN transactions
                     ON transactions.id_tx = sent_notes.tx
                LEFT JOIN sapling_received_notes
                          ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                             (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
                WHERE COALESCE(sapling_received_notes.is_change, 0) = 0
                GROUP BY account_id, txid
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) as max_height FROM blocks
            )
            SELECT notes.account_id                  AS account_id,
                   notes.block                       AS mined_height,
                   notes.txid                        AS txid,
                   transactions.tx_index             AS tx_index,
                   transactions.expiry_height        AS expiry_height,
                   transactions.raw                  AS raw,
                   SUM(notes.value)                  AS account_balance_delta,
                   transactions.fee                  AS fee_paid,
                   SUM(notes.is_change) > 0          AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        blocks.height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined
            FROM notes
            LEFT JOIN transactions
                 ON notes.txid = transactions.txid
            JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = notes.block
            LEFT JOIN sent_note_counts
                      ON sent_note_counts.account_id = notes.account_id
                      AND sent_note_counts.txid = notes.txid
            GROUP BY notes.account_id, notes.txid"###) }) },
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            SELECT transactions.txid                   AS txid,
                   2                                   AS output_pool,
                   sapling_received_notes.output_index AS output_index,
                   sent_notes.from_account_id          AS from_account_id,
                   sapling_received_notes.account_id   AS to_account_id,
                   NULL                                AS to_address,
                   sapling_received_notes.value        AS value,
                   sapling_received_notes.is_change    AS is_change,
                   sapling_received_notes.memo         AS memo
            FROM sapling_received_notes
            JOIN transactions
                 ON transactions.id_tx = sapling_received_notes.tx
            LEFT JOIN sent_notes
                      ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                         (sapling_received_notes.tx, 2, sent_notes.output_index)
            UNION
            SELECT utxos.prevout_txid           AS txid,
                   0                            AS output_pool,
                   utxos.prevout_idx            AS output_index,
                   NULL                         AS from_account_id,
                   utxos.received_by_account_id AS to_account_id,
                   utxos.address                AS to_address,
                   utxos.value_zat              AS value,
                   0                            AS is_change,
                   NULL                         AS memo
            FROM utxos
            UNION
            SELECT transactions.txid                 AS txid,
                   sent_notes.output_pool            AS output_pool,
                   sent_notes.output_index           AS output_index,
                   sent_notes.from_account_id        AS from_account_id,
                   sapling_received_notes.account_id AS to_account_id,
                   sent_notes.to_address             AS to_address,
                   sent_notes.value                  AS value,
                   0                                 AS is_change,
                   sent_notes.memo                   AS memo
            FROM sent_notes
            JOIN transactions
                 ON transactions.id_tx = sent_notes.tx
            LEFT JOIN sapling_received_notes
                      ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                         (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
            WHERE COALESCE(sapling_received_notes.is_change, 0) = 0"###) }) },
    ] },
    // orchard_received_notes; source sha256 e532856009547fa61c3f4631296eb5f3e437f0b72ab1f37920a2d78a4ab9a798
    Migration { id: 0x51d7a273aa194109932580e4a5545048, dependencies: &[0x6d02ec7687204cc6b646c4e2ce69221c], effects: &[
        Effect { name: r###"orchard_received_note_spends"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_received_note_spends"###, sql: Some(r###"CREATE TABLE orchard_received_note_spends (
                orchard_received_note_id INTEGER NOT NULL,
                transaction_id INTEGER NOT NULL,
                FOREIGN KEY (orchard_received_note_id)
                    REFERENCES orchard_received_notes(id)
                    ON DELETE CASCADE,
                FOREIGN KEY (transaction_id)
                    -- We do not delete transactions, so this does not cascade
                    REFERENCES transactions(id_tx),
                UNIQUE (orchard_received_note_id, transaction_id)
            )"###) }) },
        Effect { name: r###"orchard_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE TABLE orchard_received_notes (
                id INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                action_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rho BLOB NOT NULL,
                rseed BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                CONSTRAINT tx_output UNIQUE (tx, action_index)
            )"###) }) },
        Effect { name: r###"orchard_received_notes_account"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE INDEX orchard_received_notes_account ON orchard_received_notes (
                account_id ASC
            )"###) }) },
        Effect { name: r###"orchard_received_notes_tx"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE INDEX orchard_received_notes_tx ON orchard_received_notes (
                tx ASC
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_orchard_received_note_spends_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_note_spends"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_orchard_received_notes_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_notes"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_orchard_received_notes_2"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_notes"###, sql: None }) },
        Effect { name: r###"v_received_note_spends"###, object: Some(Object { kind: r###"view"###, table: r###"v_received_note_spends"###, sql: Some(r###"CREATE VIEW v_received_note_spends AS
                SELECT
                    2 AS pool,
                    sapling_received_note_id AS received_note_id,
                    transaction_id
                FROM sapling_received_note_spends
                UNION
                SELECT
                    3 AS pool,
                    orchard_received_note_id AS received_note_id,
                    transaction_id
                FROM orchard_received_note_spends"###) }) },
        Effect { name: r###"v_received_notes"###, object: Some(Object { kind: r###"view"###, table: r###"v_received_notes"###, sql: Some(r###"CREATE VIEW v_received_notes AS
                    SELECT
                        sapling_received_notes.id AS id_within_pool_table,
                        sapling_received_notes.tx,
                        2 AS pool,
                        sapling_received_notes.output_index AS output_index,
                        account_id,
                        sapling_received_notes.value,
                        is_change,
                        sapling_received_notes.memo,
                        sent_notes.id AS sent_note_id
                    FROM sapling_received_notes
                    LEFT JOIN sent_notes
                    ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                       (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
                UNION
                    SELECT
                        orchard_received_notes.id AS id_within_pool_table,
                        orchard_received_notes.tx,
                        3 AS pool,
                        orchard_received_notes.action_index AS output_index,
                        account_id,
                        orchard_received_notes.value,
                        is_change,
                        orchard_received_notes.memo,
                        sent_notes.id AS sent_note_id
                    FROM orchard_received_notes
                    LEFT JOIN sent_notes
                    ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                       (orchard_received_notes.tx, 3, orchard_received_notes.action_index)"###) }) },
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
                WITH
                notes AS (
                    -- Shielded notes received in this transaction
                    SELECT v_received_notes.account_id     AS account_id,
                           transactions.block              AS block,
                           transactions.txid               AS txid,
                           v_received_notes.pool           AS pool,
                           id_within_pool_table,
                           v_received_notes.value          AS value,
                           CASE
                                WHEN v_received_notes.is_change THEN 1
                                ELSE 0
                           END AS is_change,
                           CASE
                                WHEN v_received_notes.is_change THEN 0
                                ELSE 1
                           END AS received_count,
                           CASE
                             WHEN (v_received_notes.memo IS NULL OR v_received_notes.memo = X'F6')
                               THEN 0
                             ELSE 1
                           END AS memo_present
                    FROM v_received_notes
                    JOIN transactions
                         ON transactions.id_tx = v_received_notes.tx
                    UNION
                    -- Transparent TXOs received in this transaction
                    SELECT utxos.received_by_account_id AS account_id,
                           utxos.height                 AS block,
                           utxos.prevout_txid           AS txid,
                           0      AS pool,
                           utxos.id                     AS id_within_pool_table,
                           utxos.value_zat              AS value,
                           0                            AS is_change,
                           1                            AS received_count,
                           0                            AS memo_present
                    FROM utxos
                    UNION
                    -- Shielded notes spent in this transaction
                    SELECT v_received_notes.account_id  AS account_id,
                           transactions.block           AS block,
                           transactions.txid            AS txid,
                           v_received_notes.pool        AS pool,
                           id_within_pool_table,
                           -v_received_notes.value      AS value,
                           0                            AS is_change,
                           0                            AS received_count,
                           0                            AS memo_present
                    FROM v_received_notes
                    JOIN v_received_note_spends rns
                         ON rns.pool = v_received_notes.pool
                         AND rns.received_note_id = v_received_notes.id_within_pool_table
                    JOIN transactions
                         ON transactions.id_tx = rns.transaction_id
                    UNION
                    -- Transparent TXOs spent in this transaction
                    SELECT utxos.received_by_account_id AS account_id,
                           transactions.block           AS block,
                           transactions.txid            AS txid,
                           0      AS pool,
                           utxos.id                     AS id_within_pool_table,
                           -utxos.value_zat             AS value,
                           0                            AS is_change,
                           0                            AS received_count,
                           0                            AS memo_present
                    FROM utxos
                    JOIN transparent_received_output_spends tros
                         ON tros.transparent_received_output_id = utxos.id
                    JOIN transactions
                         ON transactions.id_tx = tros.transaction_id
                ),
                -- Obtain a count of the notes that the wallet created in each transaction,
                -- not counting change notes.
                sent_note_counts AS (
                    SELECT sent_notes.from_account_id AS account_id,
                           transactions.txid       AS txid,
                           COUNT(DISTINCT sent_notes.id) as sent_notes,
                           SUM(
                             CASE
                               WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR v_received_notes.tx IS NOT NULL)
                                 THEN 0
                               ELSE 1
                             END
                           ) AS memo_count
                    FROM sent_notes
                    JOIN transactions
                         ON transactions.id_tx = sent_notes.tx
                    LEFT JOIN v_received_notes
                         ON sent_notes.id = v_received_notes.sent_note_id
                    WHERE COALESCE(v_received_notes.is_change, 0) = 0
                    GROUP BY account_id, txid
                ),
                blocks_max_height AS (
                    SELECT MAX(blocks.height) as max_height FROM blocks
                )
                SELECT notes.account_id                  AS account_id,
                       notes.block                       AS mined_height,
                       notes.txid                        AS txid,
                       transactions.tx_index             AS tx_index,
                       transactions.expiry_height        AS expiry_height,
                       transactions.raw                  AS raw,
                       SUM(notes.value)                  AS account_balance_delta,
                       transactions.fee                  AS fee_paid,
                       SUM(notes.is_change) > 0          AS has_change,
                       MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                       SUM(notes.received_count)         AS received_note_count,
                       SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                       blocks.time                       AS block_time,
                       (
                            blocks.height IS NULL
                            AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                       ) AS expired_unmined
                FROM notes
                LEFT JOIN transactions
                     ON notes.txid = transactions.txid
                JOIN blocks_max_height
                LEFT JOIN blocks ON blocks.height = notes.block
                LEFT JOIN sent_note_counts
                     ON sent_note_counts.account_id = notes.account_id
                     AND sent_note_counts.txid = notes.txid
                GROUP BY notes.account_id, notes.txid"###) }) },
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
                SELECT transactions.txid              AS txid,
                       v_received_notes.pool          AS output_pool,
                       v_received_notes.output_index  AS output_index,
                       sent_notes.from_account_id     AS from_account_id,
                       v_received_notes.account_id    AS to_account_id,
                       NULL                           AS to_address,
                       v_received_notes.value         AS value,
                       v_received_notes.is_change     AS is_change,
                       v_received_notes.memo          AS memo
                FROM v_received_notes
                JOIN transactions
                    ON transactions.id_tx = v_received_notes.tx
                LEFT JOIN sent_notes
                    ON sent_notes.id = v_received_notes.sent_note_id
                UNION
                SELECT utxos.prevout_txid           AS txid,
                       0      AS output_pool,
                       utxos.prevout_idx            AS output_index,
                       NULL                         AS from_account_id,
                       utxos.received_by_account_id AS to_account_id,
                       utxos.address                AS to_address,
                       utxos.value_zat              AS value,
                       0                            AS is_change,
                       NULL                         AS memo
                FROM utxos
                UNION
                SELECT transactions.txid            AS txid,
                       sent_notes.output_pool       AS output_pool,
                       sent_notes.output_index      AS output_index,
                       sent_notes.from_account_id   AS from_account_id,
                       v_received_notes.account_id  AS to_account_id,
                       sent_notes.to_address        AS to_address,
                       sent_notes.value             AS value,
                       0                            AS is_change,
                       sent_notes.memo              AS memo
                FROM sent_notes
                JOIN transactions
                    ON transactions.id_tx = sent_notes.tx
                LEFT JOIN v_received_notes
                    ON sent_notes.id = v_received_notes.sent_note_id
                WHERE COALESCE(v_received_notes.is_change, 0) = 0"###) }) },
    ] },
    // ensure_orchard_ua_receiver; source sha256 7121c596da1299416addd29a41d0a6e518e89c008724697cfe3bce62c5e7364e
    Migration { id: 0x604349c75ce54768bea612d106ccda93, dependencies: &[0x51d7a273aa194109932580e4a5545048], effects: &[
    ] },
    // utxos_to_txos; source sha256 129d837051e01154093ee58754941e0a0974bd98a84d0fc4835119177fcce4f2
    Migration { id: 0x3a2562b3f17446a1aa8c1d122ca2e884, dependencies: &[0x51d7a273aa194109932580e4a5545048], effects: &[
        Effect { name: r###"idx_transparent_received_outputs_account_id"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_received_outputs"###, sql: Some(r###"CREATE INDEX idx_transparent_received_outputs_account_id
            ON "transparent_received_outputs" (account_id)"###) }) },
        Effect { name: r###"sqlite_autoindex_transparent_received_outputs_1"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_received_outputs"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_utxos_1"###, object: None },
        Effect { name: r###"transactions"###, object: Some(Object { kind: r###"table"###, table: r###"transactions"###, sql: Some(r###"CREATE TABLE "transactions" (
                id_tx INTEGER PRIMARY KEY,
                txid BLOB NOT NULL UNIQUE,
                created TEXT,
                block INTEGER,
                mined_height INTEGER,
                tx_index INTEGER,
                expiry_height INTEGER,
                raw BLOB,
                fee INTEGER,
                FOREIGN KEY (block) REFERENCES blocks(height),
                CONSTRAINT height_consistency CHECK (block IS NULL OR mined_height = block)
            )"###) }) },
        Effect { name: r###"transparent_received_output_spends"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_received_output_spends"###, sql: Some(r###"CREATE TABLE "transparent_received_output_spends" (
                transparent_received_output_id INTEGER NOT NULL,
                transaction_id INTEGER NOT NULL,
                FOREIGN KEY (transparent_received_output_id)
                    REFERENCES transparent_received_outputs(id)
                    ON DELETE CASCADE,
                FOREIGN KEY (transaction_id)
                    -- We do not delete transactions, so this does not cascade
                    REFERENCES transactions(id_tx),
                UNIQUE (transparent_received_output_id, transaction_id)
            )"###) }) },
        Effect { name: r###"transparent_received_outputs"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_received_outputs"###, sql: Some(r###"CREATE TABLE transparent_received_outputs (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL,
                address TEXT NOT NULL,
                script BLOB NOT NULL,
                value_zat INTEGER NOT NULL,
                max_observed_unspent_height INTEGER,
                FOREIGN KEY (transaction_id) REFERENCES transactions(id_tx),
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                CONSTRAINT transparent_output_unique UNIQUE (transaction_id, output_index)
            )"###) }) },
        Effect { name: r###"utxos"###, object: None },
        Effect { name: r###"utxos_received_by_account"###, object: None },
        Effect { name: r###"v_received_note_spends"###, object: None },
        Effect { name: r###"v_received_notes"###, object: None },
        Effect { name: r###"v_received_output_spends"###, object: Some(Object { kind: r###"view"###, table: r###"v_received_output_spends"###, sql: Some(r###"CREATE VIEW v_received_output_spends AS
            SELECT
                2 AS pool,
                sapling_received_note_id AS received_output_id,
                transaction_id
            FROM sapling_received_note_spends
            UNION
            SELECT
                3 AS pool,
                orchard_received_note_id AS received_output_id,
                transaction_id
            FROM orchard_received_note_spends
            UNION
            SELECT
                0 AS pool,
                transparent_received_output_id AS received_output_id,
                transaction_id
            FROM transparent_received_output_spends"###) }) },
        Effect { name: r###"v_received_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_received_outputs"###, sql: Some(r###"CREATE VIEW v_received_outputs AS
                SELECT
                    sapling_received_notes.id AS id_within_pool_table,
                    sapling_received_notes.tx AS transaction_id,
                    2 AS pool,
                    sapling_received_notes.output_index,
                    account_id,
                    sapling_received_notes.value,
                    is_change,
                    sapling_received_notes.memo,
                    sent_notes.id AS sent_note_id
                FROM sapling_received_notes
                LEFT JOIN sent_notes
                ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                   (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
            UNION
                SELECT
                    orchard_received_notes.id AS id_within_pool_table,
                    orchard_received_notes.tx AS transaction_id,
                    3 AS pool,
                    orchard_received_notes.action_index AS output_index,
                    account_id,
                    orchard_received_notes.value,
                    is_change,
                    orchard_received_notes.memo,
                    sent_notes.id AS sent_note_id
                FROM orchard_received_notes
                LEFT JOIN sent_notes
                ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                   (orchard_received_notes.tx, 3, orchard_received_notes.action_index)
            UNION
                SELECT
                    u.id AS id_within_pool_table,
                    u.transaction_id,
                    0 AS pool,
                    u.output_index,
                    u.account_id,
                    u.value_zat AS value,
                    0 AS is_change,
                    NULL AS memo,
                    sent_notes.id AS sent_note_id
                FROM transparent_received_outputs u
                LEFT JOIN sent_notes
                ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                   (u.transaction_id, 0, u.output_index)"###) }) },
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                -- Outputs received in this transaction
                SELECT ro.account_id              AS account_id,
                       transactions.mined_height  AS mined_height,
                       transactions.txid          AS txid,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       ro.value                   AS value,
                       0                          AS spent_note_count,
                       CASE
                            WHEN ro.is_change THEN 1
                            ELSE 0
                       END AS change_note_count,
                       CASE
                            WHEN ro.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (ro.memo IS NULL OR ro.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present,
                       -- The wallet cannot receive transparent outputs in shielding transactions.
                       CASE
                         WHEN ro.pool = 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN transactions
                     ON transactions.id_tx = ro.transaction_id
                UNION
                -- Outputs spent in this transaction
                SELECT ro.account_id              AS account_id,
                       transactions.mined_height  AS mined_height,
                       transactions.txid          AS txid,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       -ro.value                  AS value,
                       1                          AS spent_note_count,
                       0                          AS change_note_count,
                       0                          AS received_count,
                       0                          AS memo_present,
                       -- The wallet cannot spend shielded outputs in shielding transactions.
                       CASE
                         WHEN ro.pool != 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN v_received_output_spends ros
                     ON ros.pool = ro.pool
                     AND ros.received_output_id = ro.id_within_pool_table
                JOIN transactions
                     ON transactions.id_tx = ros.transaction_id
            ),
            -- Obtain a count of the notes that the wallet created in each transaction,
            -- not counting change notes.
            sent_note_counts AS (
                SELECT sent_notes.from_account_id     AS account_id,
                       transactions.txid              AS txid,
                       COUNT(DISTINCT sent_notes.id)  AS sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                JOIN transactions
                     ON transactions.id_tx = sent_notes.tx
                LEFT JOIN v_received_outputs ro
                     ON sent_notes.id = ro.sent_note_id
                WHERE COALESCE(ro.is_change, 0) = 0
                GROUP BY account_id, txid
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) AS max_height FROM blocks
            )
            SELECT notes.account_id             AS account_id,
                   notes.mined_height           AS mined_height,
                   notes.txid                   AS txid,
                   transactions.tx_index        AS tx_index,
                   transactions.expiry_height   AS expiry_height,
                   transactions.raw             AS raw,
                   SUM(notes.value)             AS account_balance_delta,
                   transactions.fee             AS fee_paid,
                   SUM(notes.change_note_count) > 0  AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        blocks.height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined,
                   SUM(notes.spent_note_count) AS spent_note_count,
                   (
                        -- All of the wallet-spent and wallet-received notes are consistent with a
                        -- shielding transaction.
                        SUM(notes.does_not_match_shielding) = 0
                        -- The transaction contains at least one wallet-spent output.
                        AND SUM(notes.spent_note_count) > 0
                        -- The transaction contains at least one wallet-received note.
                        AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
                        -- We do not know about any external outputs of the transaction.
                        AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                   ) AS is_shielding
            FROM notes
            LEFT JOIN transactions
                 ON notes.txid = transactions.txid
            JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = notes.mined_height
            LEFT JOIN sent_note_counts
                 ON sent_note_counts.account_id = notes.account_id
                 AND sent_note_counts.txid = notes.txid
            GROUP BY notes.account_id, notes.txid"###) }) },
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            -- select all outputs received by the wallet
            SELECT transactions.txid            AS txid,
                   ro.pool                      AS output_pool,
                   ro.output_index              AS output_index,
                   sent_notes.from_account_id   AS from_account_id,
                   ro.account_id                AS to_account_id,
                   NULL                         AS to_address,
                   ro.value                     AS value,
                   ro.is_change                 AS is_change,
                   ro.memo                      AS memo
            FROM v_received_outputs ro
            JOIN transactions
                ON transactions.id_tx = ro.transaction_id
            -- join to the sent_notes table to obtain `from_account_id`
            LEFT JOIN sent_notes ON sent_notes.id = ro.sent_note_id
            UNION
            -- select all outputs sent from the wallet to external recipients
            SELECT transactions.txid            AS txid,
                   sent_notes.output_pool       AS output_pool,
                   sent_notes.output_index      AS output_index,
                   sent_notes.from_account_id   AS from_account_id,
                   NULL                         AS to_account_id,
                   sent_notes.to_address        AS to_address,
                   sent_notes.value             AS value,
                   FALSE                        AS is_change,
                   sent_notes.memo              AS memo
            FROM sent_notes
            JOIN transactions
                ON transactions.id_tx = sent_notes.tx
            LEFT JOIN v_received_outputs ro ON ro.sent_note_id = sent_notes.id
            -- exclude any sent notes for which a row exists in the v_received_outputs view
            WHERE ro.account_id IS NULL"###) }) },
    ] },
    // ephemeral_addresses; source sha256 dcb44684f8e56e14716bb5738d1b7d71a7ce065a7601416e1a710f4a6123e03e
    Migration { id: 0x0e1d42741f8e44e2909d689a4bc2967b, dependencies: &[0x3a2562b3f17446a1aa8c1d122ca2e884], effects: &[
        Effect { name: r###"ephemeral_addresses"###, object: Some(Object { kind: r###"table"###, table: r###"ephemeral_addresses"###, sql: Some(r###"CREATE TABLE ephemeral_addresses (
                account_id INTEGER NOT NULL,
                address_index INTEGER NOT NULL,
                -- nullability of this column is controlled by the index_range_and_address_nullity check
                address TEXT,
                used_in_tx INTEGER,
                seen_in_tx INTEGER,
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                FOREIGN KEY (used_in_tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (seen_in_tx) REFERENCES transactions(id_tx),
                PRIMARY KEY (account_id, address_index),
                CONSTRAINT ephemeral_addr_uniq UNIQUE (address),
                CONSTRAINT used_implies_seen CHECK (
                    used_in_tx IS NULL OR seen_in_tx IS NOT NULL
                ),
                CONSTRAINT index_range_and_address_nullity CHECK (
                    (address_index BETWEEN 0 AND 0x7FFFFFFF AND address IS NOT NULL) OR
                    (address_index BETWEEN 0x80000000 AND 0x7FFFFFFF + 20 AND address IS NULL AND used_in_tx IS NULL AND seen_in_tx IS NULL)
                )
            ) WITHOUT ROWID"###) }) },
        Effect { name: r###"sqlite_autoindex_ephemeral_addresses_2"###, object: Some(Object { kind: r###"index"###, table: r###"ephemeral_addresses"###, sql: None }) },
    ] },
    // spend_key_available; source sha256 e3b09965bc66226152630a8dc94fa9c8187f544544d3abdf824b42f11219e7b6
    Migration { id: 0x07610aacb0e34ba8aaa6cda606f0fd7b, dependencies: &[0x6d02ec7687204cc6b646c4e2ce69221c], effects: &[
        Effect { name: r###"accounts"###, object: Some(Object { kind: r###"table"###, table: r###"accounts"###, sql: Some(r###"CREATE TABLE "accounts" (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                account_kind INTEGER NOT NULL DEFAULT 0,
                hd_seed_fingerprint BLOB,
                hd_account_index INTEGER,
                ufvk TEXT,
                uivk TEXT NOT NULL,
                orchard_fvk_item_cache BLOB,
                sapling_fvk_item_cache BLOB,
                p2pkh_fvk_item_cache BLOB,
                birthday_height INTEGER NOT NULL,
                birthday_sapling_tree_size INTEGER,
                birthday_orchard_tree_size INTEGER,
                recover_until_height INTEGER, has_spend_key INTEGER NOT NULL DEFAULT 1,
                CHECK (
                  (
                    account_kind = 0
                    AND hd_seed_fingerprint IS NOT NULL
                    AND hd_account_index IS NOT NULL
                    AND ufvk IS NOT NULL
                  )
                  OR
                  (
                    account_kind = 1
                    AND hd_seed_fingerprint IS NULL
                    AND hd_account_index IS NULL
                  )
                )
            )"###) }) },
    ] },
    // nullifier_map; source sha256 b49ba2837f81e933a234a97479eec169444cf71111f2fc36760c5060ab4e1929
    Migration { id: 0xe2d71ac56a444c6ba9a06d0a79d355f1, dependencies: &[0xbdcdcedc7b294f1c830735f937f0d32a], effects: &[
        Effect { name: r###"nf_map_locator_idx"###, object: Some(Object { kind: r###"index"###, table: r###"nullifier_map"###, sql: Some(r###"CREATE INDEX nf_map_locator_idx ON nullifier_map(block_height, tx_index)"###) }) },
        Effect { name: r###"nullifier_map"###, object: Some(Object { kind: r###"table"###, table: r###"nullifier_map"###, sql: Some(r###"CREATE TABLE nullifier_map (
                spend_pool INTEGER NOT NULL,
                nf BLOB NOT NULL,
                block_height INTEGER NOT NULL,
                tx_index INTEGER NOT NULL,
                CONSTRAINT tx_locator
                    FOREIGN KEY (block_height, tx_index)
                    REFERENCES tx_locator_map(block_height, tx_index)
                    ON DELETE CASCADE
                    ON UPDATE RESTRICT,
                CONSTRAINT nf_uniq UNIQUE (spend_pool, nf)
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_nullifier_map_1"###, object: Some(Object { kind: r###"index"###, table: r###"nullifier_map"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tx_locator_map_1"###, object: Some(Object { kind: r###"index"###, table: r###"tx_locator_map"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tx_locator_map_2"###, object: Some(Object { kind: r###"index"###, table: r###"tx_locator_map"###, sql: None }) },
        Effect { name: r###"tx_locator_map"###, object: Some(Object { kind: r###"table"###, table: r###"tx_locator_map"###, sql: Some(r###"CREATE TABLE tx_locator_map (
                block_height INTEGER NOT NULL,
                tx_index INTEGER NOT NULL,
                txid BLOB NOT NULL UNIQUE,
                PRIMARY KEY (block_height, tx_index)
            )"###) }) },
    ] },
    // tx_retrieval_queue; source sha256 fd5d1a63039353097b5e571cde5551e2173f07eff39a9a42908be217e845266e
    Migration { id: 0xfec02b6139884b4f969998977fac9e7f, dependencies: &[0x3a6487f7e06842bb9d126bb8dbe6da00, 0x604349c75ce54768bea612d106ccda93, 0x0e1d42741f8e44e2909d689a4bc2967b, 0x07610aacb0e34ba8aaa6cda606f0fd7b, 0xe2d71ac56a444c6ba9a06d0a79d355f1], effects: &[
        Effect { name: r###"sqlite_autoindex_transparent_spend_map_1"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_spend_map"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_transparent_spend_search_queue_1"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_spend_search_queue"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tx_retrieval_queue_1"###, object: Some(Object { kind: r###"index"###, table: r###"tx_retrieval_queue"###, sql: None }) },
        Effect { name: r###"transactions"###, object: Some(Object { kind: r###"table"###, table: r###"transactions"###, sql: Some(r###"CREATE TABLE "transactions" (
                id_tx INTEGER PRIMARY KEY,
                txid BLOB NOT NULL UNIQUE,
                created TEXT,
                block INTEGER,
                mined_height INTEGER,
                tx_index INTEGER,
                expiry_height INTEGER,
                raw BLOB,
                fee INTEGER, target_height INTEGER,
                FOREIGN KEY (block) REFERENCES blocks(height),
                CONSTRAINT height_consistency CHECK (block IS NULL OR mined_height = block)
            )"###) }) },
        Effect { name: r###"transparent_spend_map"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_spend_map"###, sql: Some(r###"CREATE TABLE transparent_spend_map (
                spending_transaction_id INTEGER NOT NULL,
                prevout_txid BLOB NOT NULL,
                prevout_output_index INTEGER NOT NULL,
                FOREIGN KEY (spending_transaction_id) REFERENCES transactions(id_tx)
                -- NOTE: We can't create a unique constraint on just (prevout_txid, prevout_output_index)
                -- because the same output may be attempted to be spent in multiple transactions, even
                -- though only one will ever be mined.
                CONSTRAINT transparent_spend_map_unique UNIQUE (
                    spending_transaction_id, prevout_txid, prevout_output_index
                )
            )"###) }) },
        Effect { name: r###"transparent_spend_search_queue"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_spend_search_queue"###, sql: Some(r###"CREATE TABLE transparent_spend_search_queue (
                address TEXT NOT NULL,
                transaction_id INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                FOREIGN KEY (transaction_id) REFERENCES transactions(id_tx),
                CONSTRAINT value_received_height UNIQUE (transaction_id, output_index)
            )"###) }) },
        Effect { name: r###"tx_retrieval_queue"###, object: Some(Object { kind: r###"table"###, table: r###"tx_retrieval_queue"###, sql: Some(r###"CREATE TABLE tx_retrieval_queue (
                txid BLOB NOT NULL UNIQUE,
                query_type INTEGER NOT NULL,
                dependent_transaction_id INTEGER,
                FOREIGN KEY (dependent_transaction_id) REFERENCES transactions(id_tx)
            )"###) }) },
    ] },
    // tx_retrieval_queue_expiry; source sha256 89ec7d4252b3a8d0f5c4d46bfb6f915bd16468636197eaece16a725c5ab8ad32
    Migration { id: 0x9ffe82d43bf5459a9a217affd9e88e95, dependencies: &[0xfec02b6139884b4f969998977fac9e7f], effects: &[
        Effect { name: r###"tx_retrieval_queue"###, object: Some(Object { kind: r###"table"###, table: r###"tx_retrieval_queue"###, sql: Some(r###"CREATE TABLE tx_retrieval_queue (
                txid BLOB NOT NULL UNIQUE,
                query_type INTEGER NOT NULL,
                dependent_transaction_id INTEGER, request_expiry INTEGER,
                FOREIGN KEY (dependent_transaction_id) REFERENCES transactions(id_tx)
            )"###) }) },
    ] },
    // support_legacy_sqlite; source sha256 ed7bcd08a0f23e792828a8b7d899f1b0c9877bed06f28149f803cae3af2c9b31
    Migration { id: 0x156d8c8f21734b5989b675697d5a2103, dependencies: &[0xfec02b6139884b4f969998977fac9e7f], effects: &[
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            -- select all outputs received by the wallet
            SELECT transactions.txid            AS txid,
                   ro.pool                      AS output_pool,
                   ro.output_index              AS output_index,
                   sent_notes.from_account_id   AS from_account_id,
                   ro.account_id                AS to_account_id,
                   NULL                         AS to_address,
                   ro.value                     AS value,
                   ro.is_change                 AS is_change,
                   ro.memo                      AS memo
            FROM v_received_outputs ro
            JOIN transactions
                ON transactions.id_tx = ro.transaction_id
            -- join to the sent_notes table to obtain `from_account_id`
            LEFT JOIN sent_notes ON sent_notes.id = ro.sent_note_id
            UNION
            -- select all outputs sent from the wallet to external recipients
            SELECT transactions.txid            AS txid,
                   sent_notes.output_pool       AS output_pool,
                   sent_notes.output_index      AS output_index,
                   sent_notes.from_account_id   AS from_account_id,
                   NULL                         AS to_account_id,
                   sent_notes.to_address        AS to_address,
                   sent_notes.value             AS value,
                   0                            AS is_change,
                   sent_notes.memo              AS memo
            FROM sent_notes
            JOIN transactions
                ON transactions.id_tx = sent_notes.tx
            LEFT JOIN v_received_outputs ro ON ro.sent_note_id = sent_notes.id
            -- exclude any sent notes for which a row exists in the v_received_outputs view
            WHERE ro.account_id IS NULL"###) }) },
    ] },
    // fix_broken_commitment_trees; source sha256 fe76c5b6749a1a6538b9ed4676d1e7076996d989a1aaa229d58e16ec3469d657
    Migration { id: 0x9fa43ce0a38745d1be0357a3edc76d01, dependencies: &[0x156d8c8f21734b5989b675697d5a2103], effects: &[
    ] },
    // fix_bad_change_flagging; source sha256 7043fca0e86a33c8f0ef1cb2a52a7ac37841214b5f05fd5206e3f2e3fb49e318
    Migration { id: 0x6d36656d533b4b65ae91dcb95c4ad289, dependencies: &[0x9fa43ce0a38745d1be0357a3edc76d01], effects: &[
    ] },
    // add_account_uuids; source sha256 d7091447e9ab6731dc289db2f06df6e99117f2eee92619f3c35a814b9f015d1f
    Migration { id: 0xcccc623f324343c7b884ceef25149e04, dependencies: &[0x156d8c8f21734b5989b675697d5a2103], effects: &[
        Effect { name: r###"accounts"###, object: Some(Object { kind: r###"table"###, table: r###"accounts"###, sql: Some(r###"CREATE TABLE "accounts" (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                uuid BLOB NOT NULL,
                account_kind INTEGER NOT NULL DEFAULT 0,
                key_source TEXT,
                hd_seed_fingerprint BLOB,
                hd_account_index INTEGER,
                ufvk TEXT,
                uivk TEXT NOT NULL,
                orchard_fvk_item_cache BLOB,
                sapling_fvk_item_cache BLOB,
                p2pkh_fvk_item_cache BLOB,
                birthday_height INTEGER NOT NULL,
                birthday_sapling_tree_size INTEGER,
                birthday_orchard_tree_size INTEGER,
                recover_until_height INTEGER,
                has_spend_key INTEGER NOT NULL DEFAULT 1,
                CHECK (
                  (
                    account_kind = 0
                    AND hd_seed_fingerprint IS NOT NULL
                    AND hd_account_index IS NOT NULL
                    AND ufvk IS NOT NULL
                  )
                  OR
                  (
                    account_kind = 1
                    AND (hd_seed_fingerprint IS NULL) = (hd_account_index IS NULL)
                  )
                )
            )"###) }) },
        Effect { name: r###"accounts_ufvk"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX accounts_ufvk ON accounts (ufvk)"###) }) },
        Effect { name: r###"accounts_uivk"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX accounts_uivk ON accounts (uivk)"###) }) },
        Effect { name: r###"accounts_uuid"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX accounts_uuid ON accounts (uuid)"###) }) },
        Effect { name: r###"hd_account"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX hd_account ON accounts (hd_seed_fingerprint, hd_account_index)"###) }) },
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                -- Outputs received in this transaction
                SELECT ro.account_id              AS account_id,
                       transactions.mined_height  AS mined_height,
                       transactions.txid          AS txid,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       ro.value                   AS value,
                       0                          AS spent_note_count,
                       CASE
                            WHEN ro.is_change THEN 1
                            ELSE 0
                       END AS change_note_count,
                       CASE
                            WHEN ro.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (ro.memo IS NULL OR ro.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present,
                       -- The wallet cannot receive transparent outputs in shielding transactions.
                       CASE
                         WHEN ro.pool = 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN transactions
                     ON transactions.id_tx = ro.transaction_id
                UNION
                -- Outputs spent in this transaction
                SELECT ro.account_id              AS account_id,
                       transactions.mined_height  AS mined_height,
                       transactions.txid          AS txid,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       -ro.value                  AS value,
                       1                          AS spent_note_count,
                       0                          AS change_note_count,
                       0                          AS received_count,
                       0                          AS memo_present,
                       -- The wallet cannot spend shielded outputs in shielding transactions.
                       CASE
                         WHEN ro.pool != 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN v_received_output_spends ros
                     ON ros.pool = ro.pool
                     AND ros.received_output_id = ro.id_within_pool_table
                JOIN transactions
                     ON transactions.id_tx = ros.transaction_id
            ),
            -- Obtain a count of the notes that the wallet created in each transaction,
            -- not counting change notes.
            sent_note_counts AS (
                SELECT sent_notes.from_account_id     AS account_id,
                       transactions.txid              AS txid,
                       COUNT(DISTINCT sent_notes.id)  AS sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                JOIN transactions
                     ON transactions.id_tx = sent_notes.tx
                LEFT JOIN v_received_outputs ro
                     ON sent_notes.id = ro.sent_note_id
                WHERE COALESCE(ro.is_change, 0) = 0
                GROUP BY account_id, txid
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) AS max_height FROM blocks
            )
            SELECT accounts.uuid                AS account_uuid,
                   notes.mined_height           AS mined_height,
                   notes.txid                   AS txid,
                   transactions.tx_index        AS tx_index,
                   transactions.expiry_height   AS expiry_height,
                   transactions.raw             AS raw,
                   SUM(notes.value)             AS account_balance_delta,
                   transactions.fee             AS fee_paid,
                   SUM(notes.change_note_count) > 0  AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        blocks.height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined,
                   SUM(notes.spent_note_count) AS spent_note_count,
                   (
                        -- All of the wallet-spent and wallet-received notes are consistent with a
                        -- shielding transaction.
                        SUM(notes.does_not_match_shielding) = 0
                        -- The transaction contains at least one wallet-spent output.
                        AND SUM(notes.spent_note_count) > 0
                        -- The transaction contains at least one wallet-received note.
                        AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
                        -- We do not know about any external outputs of the transaction.
                        AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                   ) AS is_shielding
            FROM notes
            LEFT JOIN accounts ON accounts.id = notes.account_id
            LEFT JOIN transactions
                 ON notes.txid = transactions.txid
            JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = notes.mined_height
            LEFT JOIN sent_note_counts
                 ON sent_note_counts.account_id = notes.account_id
                 AND sent_note_counts.txid = notes.txid
            GROUP BY notes.account_id, notes.txid"###) }) },
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            WITH unioned AS (
                -- select all outputs received by the wallet
                SELECT transactions.txid            AS txid,
                       ro.pool                      AS output_pool,
                       ro.output_index              AS output_index,
                       from_account.uuid            AS from_account_uuid,
                       to_account.uuid              AS to_account_uuid,
                       NULL                         AS to_address,
                       ro.value                     AS value,
                       ro.is_change                 AS is_change,
                       ro.memo                      AS memo
                FROM v_received_outputs ro
                JOIN transactions
                    ON transactions.id_tx = ro.transaction_id
                -- join to the sent_notes table to obtain `from_account_id`
                LEFT JOIN sent_notes ON sent_notes.id = ro.sent_note_id
                -- join on the accounts table to obtain account UUIDs
                LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
                LEFT JOIN accounts to_account ON to_account.id = ro.account_id
                UNION ALL
                -- select all outputs sent from the wallet to external recipients
                SELECT transactions.txid            AS txid,
                       sent_notes.output_pool       AS output_pool,
                       sent_notes.output_index      AS output_index,
                       from_account.uuid            AS from_account_uuid,
                       NULL                         AS to_account_uuid,
                       sent_notes.to_address        AS to_address,
                       sent_notes.value             AS value,
                       0                            AS is_change,
                       sent_notes.memo              AS memo
                FROM sent_notes
                JOIN transactions
                    ON transactions.id_tx = sent_notes.tx
                LEFT JOIN v_received_outputs ro ON ro.sent_note_id = sent_notes.id
                -- join on the accounts table to obtain account UUIDs
                LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
            )
            -- merge duplicate rows while retaining maximum information
            SELECT
                txid,
                output_pool,
                output_index,
                max(from_account_uuid) AS from_account_uuid,
                max(to_account_uuid) AS to_account_uuid,
                max(to_address) AS to_address,
                max(value) AS value,
                max(is_change) AS is_change,
                max(memo) AS memo
            FROM unioned
            GROUP BY txid, output_pool, output_index"###) }) },
    ] },
    // v_transactions_additional_totals; source sha256 ada468e87bcfa92f78fae8e447b9b2430e8433333abfc99d177b3bf98c850cb4
    Migration { id: 0x7f2fd1b318724b9088ba7d02b470090f, dependencies: &[0xcccc623f324343c7b884ceef25149e04], effects: &[
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                -- Outputs received in this transaction
                SELECT ro.account_id              AS account_id,
                       transactions.mined_height  AS mined_height,
                       transactions.txid          AS txid,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       ro.value                   AS value,
                       ro.value                   AS received_value,
                       0                          AS spent_value,
                       0                          AS spent_note_count,
                       CASE
                            WHEN ro.is_change THEN 1
                            ELSE 0
                       END AS change_note_count,
                       CASE
                            WHEN ro.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (ro.memo IS NULL OR ro.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present,
                       -- The wallet cannot receive transparent outputs in shielding transactions.
                       CASE
                         WHEN ro.pool = 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN transactions
                     ON transactions.id_tx = ro.transaction_id
                UNION
                -- Outputs spent in this transaction
                SELECT ro.account_id              AS account_id,
                       transactions.mined_height  AS mined_height,
                       transactions.txid          AS txid,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       -ro.value                  AS value,
                       0                          AS received_value,
                       ro.value                   AS spent_value,
                       1                          AS spent_note_count,
                       0                          AS change_note_count,
                       0                          AS received_count,
                       0                          AS memo_present,
                       -- The wallet cannot spend shielded outputs in shielding transactions.
                       CASE
                         WHEN ro.pool != 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN v_received_output_spends ros
                     ON ros.pool = ro.pool
                     AND ros.received_output_id = ro.id_within_pool_table
                JOIN transactions
                     ON transactions.id_tx = ros.transaction_id
            ),
            -- Obtain a count of the notes that the wallet created in each transaction,
            -- not counting change notes.
            sent_note_counts AS (
                SELECT sent_notes.from_account_id     AS account_id,
                       transactions.txid              AS txid,
                       COUNT(DISTINCT sent_notes.id)  AS sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                JOIN transactions
                     ON transactions.id_tx = sent_notes.tx
                LEFT JOIN v_received_outputs ro
                     ON sent_notes.id = ro.sent_note_id
                WHERE COALESCE(ro.is_change, 0) = 0
                GROUP BY account_id, txid
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) AS max_height FROM blocks
            )
            SELECT accounts.uuid                AS account_uuid,
                   notes.mined_height           AS mined_height,
                   notes.txid                   AS txid,
                   transactions.tx_index        AS tx_index,
                   transactions.expiry_height   AS expiry_height,
                   transactions.raw             AS raw,
                   SUM(notes.value)             AS account_balance_delta,
                   SUM(notes.spent_value)       AS total_spent,
                   SUM(notes.received_value)    AS total_received,
                   transactions.fee             AS fee_paid,
                   SUM(notes.change_note_count) > 0  AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        blocks.height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined,
                   SUM(notes.spent_note_count) AS spent_note_count,
                   (
                        -- All of the wallet-spent and wallet-received notes are consistent with a
                        -- shielding transaction.
                        SUM(notes.does_not_match_shielding) = 0
                        -- The transaction contains at least one wallet-spent output.
                        AND SUM(notes.spent_note_count) > 0
                        -- The transaction contains at least one wallet-received note.
                        AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
                        -- We do not know about any external outputs of the transaction.
                        AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                   ) AS is_shielding
            FROM notes
            LEFT JOIN accounts ON accounts.id = notes.account_id
            LEFT JOIN transactions
                 ON notes.txid = transactions.txid
            JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = notes.mined_height
            LEFT JOIN sent_note_counts
                 ON sent_note_counts.account_id = notes.account_id
                 AND sent_note_counts.txid = notes.txid
            GROUP BY notes.account_id, notes.txid"###) }) },
    ] },
    // transparent_gap_limit_handling; source sha256 a274af86738fb2fe2bbee63593bb653fda2e0a1b3befb835dc4a5fb9c6be78b5
    Migration { id: 0xc41dfc0ee8704859be47d2f572f5ca73, dependencies: &[0xcccc623f324343c7b884ceef25149e04], effects: &[
        Effect { name: r###"addresses"###, object: Some(Object { kind: r###"table"###, table: r###"addresses"###, sql: Some(r###"CREATE TABLE "addresses" (
                id INTEGER NOT NULL PRIMARY KEY,
                account_id INTEGER NOT NULL,
                key_scope INTEGER NOT NULL,
                diversifier_index_be BLOB NOT NULL,
                address TEXT NOT NULL,
                transparent_child_index INTEGER,
                cached_transparent_receiver_address TEXT,
                exposed_at_height INTEGER,
                receiver_flags INTEGER NOT NULL,
                transparent_receiver_next_check_time INTEGER,
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                CONSTRAINT diversification UNIQUE (account_id, key_scope, diversifier_index_be),
                CONSTRAINT transparent_index_consistency CHECK (
                    (transparent_child_index IS NOT NULL) == (cached_transparent_receiver_address IS NOT NULL)
                )
            )"###) }) },
        Effect { name: r###"addresses_accounts"###, object: None },
        Effect { name: r###"ephemeral_addresses"###, object: None },
        Effect { name: r###"idx_addresses_accounts"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_accounts ON addresses (
                account_id ASC
            )"###) }) },
        Effect { name: r###"idx_addresses_indices"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_indices ON addresses (
                diversifier_index_be ASC
            )"###) }) },
        Effect { name: r###"idx_addresses_t_indices"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_t_indices ON addresses (
                transparent_child_index ASC
            )"###) }) },
        Effect { name: r###"idx_transparent_received_outputs_account_id"###, object: None },
        Effect { name: r###"orchard_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE TABLE orchard_received_notes (
                id INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                action_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rho BLOB NOT NULL,
                rseed BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER, address_id INTEGER REFERENCES addresses(id),
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                CONSTRAINT tx_output UNIQUE (tx, action_index)
            )"###) }) },
        Effect { name: r###"sapling_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE TABLE "sapling_received_notes" (
                id INTEGER PRIMARY KEY,
                tx INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rcm BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER, address_id INTEGER REFERENCES addresses(id),
                FOREIGN KEY (tx) REFERENCES transactions(id_tx),
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                CONSTRAINT tx_output UNIQUE (tx, output_index)
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_ephemeral_addresses_2"###, object: None },
        Effect { name: r###"transparent_received_outputs"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_received_outputs"###, sql: Some(r###"CREATE TABLE "transparent_received_outputs" (
                    id INTEGER PRIMARY KEY,
                    transaction_id INTEGER NOT NULL,
                    output_index INTEGER NOT NULL,
                    account_id INTEGER NOT NULL,
                    address TEXT NOT NULL,
                    script BLOB NOT NULL,
                    value_zat INTEGER NOT NULL,
                    max_observed_unspent_height INTEGER,
                    address_id INTEGER NOT NULL REFERENCES addresses(id),
                    FOREIGN KEY (transaction_id) REFERENCES transactions(id_tx),
                    FOREIGN KEY (account_id) REFERENCES accounts(id),
                    CONSTRAINT transparent_output_unique UNIQUE (transaction_id, output_index)
                )"###) }) },
        Effect { name: r###"v_address_first_use"###, object: Some(Object { kind: r###"view"###, table: r###"v_address_first_use"###, sql: Some(r###"CREATE VIEW v_address_first_use AS
            SELECT
                address_id,
                account_id,
                key_scope,
                diversifier_index_be,
                transparent_child_index,
                MIN(mined_height) AS first_use_height
            FROM v_address_uses
            GROUP BY
                address_id, account_id, key_scope,
                diversifier_index_be, transparent_child_index"###) }) },
        Effect { name: r###"v_address_uses"###, object: Some(Object { kind: r###"view"###, table: r###"v_address_uses"###, sql: Some(r###"CREATE VIEW v_address_uses AS
                SELECT orn.address_id, orn.account_id, orn.tx AS transaction_id, t.mined_height,
                       a.key_scope, a.diversifier_index_be, a.transparent_child_index
                FROM orchard_received_notes orn
                JOIN addresses a ON a.id = orn.address_id
                JOIN transactions t ON t.id_tx = orn.tx
            UNION
                SELECT srn.address_id, srn.account_id, srn.tx AS transaction_id, t.mined_height,
                       a.key_scope, a.diversifier_index_be, a.transparent_child_index
                FROM sapling_received_notes srn
                JOIN addresses a ON a.id = srn.address_id
                JOIN transactions t ON t.id_tx = srn.tx
            UNION
                SELECT tro.address_id, tro.account_id, tro.transaction_id, t.mined_height,
                       a.key_scope, a.diversifier_index_be, a.transparent_child_index
                FROM transparent_received_outputs tro
                JOIN addresses a ON a.id = tro.address_id
                JOIN transactions t ON t.id_tx = tro.transaction_id"###) }) },
        Effect { name: r###"v_received_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_received_outputs"###, sql: Some(r###"CREATE VIEW v_received_outputs AS
                SELECT
                    sapling_received_notes.id AS id_within_pool_table,
                    sapling_received_notes.tx AS transaction_id,
                    2 AS pool,
                    sapling_received_notes.output_index,
                    account_id,
                    sapling_received_notes.value,
                    is_change,
                    sapling_received_notes.memo,
                    sent_notes.id AS sent_note_id,
                    sapling_received_notes.address_id
                FROM sapling_received_notes
                LEFT JOIN sent_notes
                ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                   (sapling_received_notes.tx, 2, sapling_received_notes.output_index)
            UNION
                SELECT
                    orchard_received_notes.id AS id_within_pool_table,
                    orchard_received_notes.tx AS transaction_id,
                    3 AS pool,
                    orchard_received_notes.action_index AS output_index,
                    account_id,
                    orchard_received_notes.value,
                    is_change,
                    orchard_received_notes.memo,
                    sent_notes.id AS sent_note_id,
                    orchard_received_notes.address_id
                FROM orchard_received_notes
                LEFT JOIN sent_notes
                ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                   (orchard_received_notes.tx, 3, orchard_received_notes.action_index)
            UNION
                SELECT
                    u.id AS id_within_pool_table,
                    u.transaction_id,
                    0 AS pool,
                    u.output_index,
                    u.account_id,
                    u.value_zat AS value,
                    0 AS is_change,
                    NULL AS memo,
                    sent_notes.id AS sent_note_id,
                    u.address_id
                FROM transparent_received_outputs u
                LEFT JOIN sent_notes
                ON (sent_notes.tx, sent_notes.output_pool, sent_notes.output_index) =
                   (u.transaction_id, 0, u.output_index)"###) }) },
    ] },
    // ensure_default_transparent_address; source sha256 ed3b87a9592507a4c8ffb1e935f047f0c5342d4e2e1f01831f3d25014d999e1a
    Migration { id: 0x702cf97b83954edcb5845c9f87f0ef35, dependencies: &[0xc41dfc0ee8704859be47d2f572f5ca73], effects: &[
    ] },
    // fix_transparent_received_outputs; source sha256 630335e1ef34067363acbff73bf5fc2969993ccc2f39f4e8176699f4839d02e3
    Migration { id: 0xb951587c34fd4f02a31305ff7adb6268, dependencies: &[0x6d36656d533b4b65ae91dcb95c4ad289, 0x7f2fd1b318724b9088ba7d02b470090f, 0x702cf97b83954edcb5845c9f87f0ef35], effects: &[
        Effect { name: r###"transparent_received_outputs"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_received_outputs"###, sql: Some(r###"CREATE TABLE "transparent_received_outputs" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL,
                address TEXT NOT NULL,
                script BLOB NOT NULL,
                value_zat INTEGER NOT NULL,
                max_observed_unspent_height INTEGER,
                address_id INTEGER NOT NULL REFERENCES addresses(id),
                FOREIGN KEY (transaction_id) REFERENCES transactions(id_tx),
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                CONSTRAINT transparent_output_unique UNIQUE (transaction_id, output_index)
            )"###) }) },
    ] },
    // support_zcashd_wallet_import; source sha256 14514c00d151807d17d719d804348c12b7c76ad21be46379a05bcc8954ff61cc
    Migration { id: 0x254d4f20f0f6463580ed9d52c536d5df, dependencies: &[0xb951587c34fd4f02a31305ff7adb6268], effects: &[
        Effect { name: r###"accounts"###, object: Some(Object { kind: r###"table"###, table: r###"accounts"###, sql: Some(r###"CREATE TABLE "accounts" (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                uuid BLOB NOT NULL,
                account_kind INTEGER NOT NULL DEFAULT 0,
                key_source TEXT,
                hd_seed_fingerprint BLOB,
                hd_account_index INTEGER,
                ufvk TEXT,
                uivk TEXT NOT NULL,
                orchard_fvk_item_cache BLOB,
                sapling_fvk_item_cache BLOB,
                p2pkh_fvk_item_cache BLOB,
                birthday_height INTEGER NOT NULL,
                birthday_sapling_tree_size INTEGER,
                birthday_orchard_tree_size INTEGER,
                recover_until_height INTEGER,
                has_spend_key INTEGER NOT NULL DEFAULT 1, zcashd_legacy_address_index INTEGER NOT NULL DEFAULT -1,
                CHECK (
                  (
                    account_kind = 0
                    AND hd_seed_fingerprint IS NOT NULL
                    AND hd_account_index IS NOT NULL
                    AND ufvk IS NOT NULL
                  )
                  OR
                  (
                    account_kind = 1
                    AND (hd_seed_fingerprint IS NULL) = (hd_account_index IS NULL)
                  )
                )
            )"###) }) },
        Effect { name: r###"addresses"###, object: Some(Object { kind: r###"table"###, table: r###"addresses"###, sql: Some(r###"CREATE TABLE "addresses" (
                id INTEGER NOT NULL PRIMARY KEY,
                account_id INTEGER NOT NULL,
                key_scope INTEGER NOT NULL,
                diversifier_index_be BLOB,
                address TEXT NOT NULL,
                transparent_child_index INTEGER,
                cached_transparent_receiver_address TEXT,
                exposed_at_height INTEGER,
                receiver_flags INTEGER NOT NULL,
                transparent_receiver_next_check_time INTEGER,
                imported_transparent_receiver_pubkey BLOB,
                FOREIGN KEY (account_id) REFERENCES accounts(id),
                CONSTRAINT diversification UNIQUE (account_id, key_scope, diversifier_index_be),
                CONSTRAINT transparent_pubkey_unique UNIQUE (imported_transparent_receiver_pubkey),
                CONSTRAINT transparent_index_consistency CHECK (
                    (transparent_child_index IS NULL OR diversifier_index_be < x'0000000F00000000000000')
                    AND (
                        (
                            cached_transparent_receiver_address IS NULL
                            AND transparent_child_index IS NULL
                            AND imported_transparent_receiver_pubkey IS NULL
                        )
                        OR (
                            cached_transparent_receiver_address IS NOT NULL
                            AND (transparent_child_index IS NULL) == (imported_transparent_receiver_pubkey IS NOT NULL)
                        )
                    )
                ),
                CONSTRAINT foreign_or_diversified CHECK (
                    (diversifier_index_be IS NULL) == (key_scope = -1)
                )
            )"###) }) },
        Effect { name: r###"hd_account"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX hd_account ON accounts (hd_seed_fingerprint, hd_account_index, zcashd_legacy_address_index)"###) }) },
        Effect { name: r###"idx_addresses_pubkeys"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_pubkeys ON addresses (
                imported_transparent_receiver_pubkey ASC
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_addresses_2"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: None }) },
    ] },
    // fix_v_transactions_expired_unmined; source sha256 9628d9aafc7cbf634433a67e90d268243afd5052451e9b77827e39fe73271a0a
    Migration { id: 0x547331735f3c4870831ea48a4a93b1d7, dependencies: &[0xb951587c34fd4f02a31305ff7adb6268], effects: &[
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                -- Outputs received in this transaction
                SELECT ro.account_id              AS account_id,
                       transactions.mined_height  AS mined_height,
                       transactions.txid          AS txid,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       ro.value                   AS value,
                       ro.value                   AS received_value,
                       0                          AS spent_value,
                       0                          AS spent_note_count,
                       CASE
                            WHEN ro.is_change THEN 1
                            ELSE 0
                       END AS change_note_count,
                       CASE
                            WHEN ro.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (ro.memo IS NULL OR ro.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present,
                       -- The wallet cannot receive transparent outputs in shielding transactions.
                       CASE
                         WHEN ro.pool = 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN transactions
                     ON transactions.id_tx = ro.transaction_id
                UNION
                -- Outputs spent in this transaction
                SELECT ro.account_id              AS account_id,
                       transactions.mined_height  AS mined_height,
                       transactions.txid          AS txid,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       -ro.value                  AS value,
                       0                          AS received_value,
                       ro.value                   AS spent_value,
                       1                          AS spent_note_count,
                       0                          AS change_note_count,
                       0                          AS received_count,
                       0                          AS memo_present,
                       -- The wallet cannot spend shielded outputs in shielding transactions.
                       CASE
                         WHEN ro.pool != 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN v_received_output_spends ros
                     ON ros.pool = ro.pool
                     AND ros.received_output_id = ro.id_within_pool_table
                JOIN transactions
                     ON transactions.id_tx = ros.transaction_id
            ),
            -- Obtain a count of the notes that the wallet created in each transaction,
            -- not counting change notes.
            sent_note_counts AS (
                SELECT sent_notes.from_account_id     AS account_id,
                       transactions.txid              AS txid,
                       COUNT(DISTINCT sent_notes.id)  AS sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                JOIN transactions
                     ON transactions.id_tx = sent_notes.tx
                LEFT JOIN v_received_outputs ro
                     ON sent_notes.id = ro.sent_note_id
                WHERE COALESCE(ro.is_change, 0) = 0
                GROUP BY account_id, txid
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) AS max_height FROM blocks
            )
            SELECT accounts.uuid                AS account_uuid,
                   notes.mined_height           AS mined_height,
                   notes.txid                   AS txid,
                   transactions.tx_index        AS tx_index,
                   transactions.expiry_height   AS expiry_height,
                   transactions.raw             AS raw,
                   SUM(notes.value)             AS account_balance_delta,
                   SUM(notes.spent_value)       AS total_spent,
                   SUM(notes.received_value)    AS total_received,
                   transactions.fee             AS fee_paid,
                   SUM(notes.change_note_count) > 0  AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        notes.mined_height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined,
                   SUM(notes.spent_note_count) AS spent_note_count,
                   (
                        -- All of the wallet-spent and wallet-received notes are consistent with a
                        -- shielding transaction.
                        SUM(notes.does_not_match_shielding) = 0
                        -- The transaction contains at least one wallet-spent output.
                        AND SUM(notes.spent_note_count) > 0
                        -- The transaction contains at least one wallet-received note.
                        AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
                        -- We do not know about any external outputs of the transaction.
                        AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                   ) AS is_shielding
            FROM notes
            LEFT JOIN accounts ON accounts.id = notes.account_id
            LEFT JOIN transactions
                 ON notes.txid = transactions.txid
            LEFT JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = notes.mined_height
            LEFT JOIN sent_note_counts
                 ON sent_note_counts.account_id = notes.account_id
                 AND sent_note_counts.txid = notes.txid
            GROUP BY notes.account_id, notes.txid"###) }) },
    ] },
    // v_received_output_spends_account; source sha256 95397964fb9251adbe14edfc37777e1a0e1e1b5604b08147945de208fe06364c
    Migration { id: 0x50fd092d97b944cfade986b526e4cd50, dependencies: &[0x547331735f3c4870831ea48a4a93b1d7], effects: &[
        Effect { name: r###"v_received_output_spends"###, object: Some(Object { kind: r###"view"###, table: r###"v_received_output_spends"###, sql: Some(r###"CREATE VIEW v_received_output_spends AS
             SELECT
                 2 AS pool,
                 s.sapling_received_note_id AS received_output_id,
                 s.transaction_id,
                 rn.account_id
             FROM sapling_received_note_spends s
             JOIN sapling_received_notes rn ON rn.id = s.sapling_received_note_id
             UNION
             SELECT
                 3 AS pool,
                 s.orchard_received_note_id AS received_output_id,
                 s.transaction_id,
                 rn.account_id
             FROM orchard_received_note_spends s
             JOIN orchard_received_notes rn ON rn.id = s.orchard_received_note_id
             UNION
             SELECT
                 0 AS pool,
                 s.transparent_received_output_id AS received_output_id,
                 s.transaction_id,
                 rn.account_id
             FROM transparent_received_output_spends s
             JOIN transparent_received_outputs rn ON rn.id = s.transparent_received_output_id"###) }) },
    ] },
    // v_tx_outputs_return_addrs; source sha256 866cd280b40f3d876896ef18d2c7cb8ffd0eb765f44370eefc601ff322104197
    Migration { id: 0x894574e0663e401a8426820b1f75149a, dependencies: &[0x547331735f3c4870831ea48a4a93b1d7], effects: &[
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            WITH unioned AS (
                -- select all outputs received by the wallet
                SELECT transactions.txid            AS txid,
                       ro.pool                      AS output_pool,
                       ro.output_index              AS output_index,
                       from_account.uuid            AS from_account_uuid,
                       to_account.uuid              AS to_account_uuid,
                       a.address                    AS to_address,
                       a.diversifier_index_be       AS diversifier_index_be,
                       ro.value                     AS value,
                       ro.is_change                 AS is_change,
                       ro.memo                      AS memo
                FROM v_received_outputs ro
                JOIN transactions
                    ON transactions.id_tx = ro.transaction_id
                LEFT JOIN addresses a ON a.id = ro.address_id
                -- join to the sent_notes table to obtain `from_account_id`
                LEFT JOIN sent_notes ON sent_notes.id = ro.sent_note_id
                -- join on the accounts table to obtain account UUIDs
                LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
                LEFT JOIN accounts to_account ON to_account.id = ro.account_id
                UNION ALL
                -- select all outputs sent from the wallet to external recipients
                SELECT transactions.txid            AS txid,
                       sent_notes.output_pool       AS output_pool,
                       sent_notes.output_index      AS output_index,
                       from_account.uuid            AS from_account_uuid,
                       NULL                         AS to_account_uuid,
                       sent_notes.to_address        AS to_address,
                       NULL                         AS diversifier_index_be,
                       sent_notes.value             AS value,
                       0                            AS is_change,
                       sent_notes.memo              AS memo
                FROM sent_notes
                JOIN transactions
                    ON transactions.id_tx = sent_notes.tx
                LEFT JOIN v_received_outputs ro ON ro.sent_note_id = sent_notes.id
                -- join on the accounts table to obtain account UUIDs
                LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
            )
            -- merge duplicate rows while retaining maximum information
            SELECT
                txid,
                output_pool,
                output_index,
                max(from_account_uuid) AS from_account_uuid,
                max(to_account_uuid) AS to_account_uuid,
                max(to_address) AS to_address,
                max(value) AS value,
                max(is_change) AS is_change,
                max(memo) AS memo
            FROM unioned
            GROUP BY txid, output_pool, output_index"###) }) },
    ] },
    // tx_observation_height; source sha256 6442ed5461f68b1e7a7832bd0c17f479f78dfcbc2dd9afc08c0c936e12d37325
    Migration { id: 0xab1be47edbfd439a876a55a7e4a0ea0b, dependencies: &[0xb951587c34fd4f02a31305ff7adb6268], effects: &[
        Effect { name: r###"transactions"###, object: Some(Object { kind: r###"table"###, table: r###"transactions"###, sql: Some(r###"CREATE TABLE "transactions" (
                id_tx INTEGER PRIMARY KEY,
                txid BLOB NOT NULL UNIQUE,
                created TEXT,
                block INTEGER,
                mined_height INTEGER,
                tx_index INTEGER,
                expiry_height INTEGER,
                raw BLOB,
                fee INTEGER,
                target_height INTEGER,
                min_observed_height INTEGER NOT NULL,
                confirmed_unmined_at_height INTEGER,
                FOREIGN KEY (block) REFERENCES blocks(height),
                CONSTRAINT height_consistency CHECK (
                    block IS NULL OR mined_height = block
                ),
                CONSTRAINT min_observed_consistency CHECK (
                    mined_height IS NULL OR min_observed_height <= mined_height
                ),
                CONSTRAINT confirmed_unmined_consistency CHECK (
                    confirmed_unmined_at_height IS NULL OR mined_height IS NULL
                )
            )"###) }) },
    ] },
    // add_transaction_trust_marker; source sha256 39c1a5d3354c06cb287c74c57ff46ce44ac0defb936117c2aea3490a5ad2906f
    Migration { id: 0x4e68277f6269467e9437f3853cc4a41f, dependencies: &[0x547331735f3c4870831ea48a4a93b1d7, 0xab1be47edbfd439a876a55a7e4a0ea0b], effects: &[
        Effect { name: r###"transactions"###, object: Some(Object { kind: r###"table"###, table: r###"transactions"###, sql: Some(r###"CREATE TABLE "transactions" (
                id_tx INTEGER PRIMARY KEY,
                txid BLOB NOT NULL UNIQUE,
                created TEXT,
                block INTEGER,
                mined_height INTEGER,
                tx_index INTEGER,
                expiry_height INTEGER,
                raw BLOB,
                fee INTEGER,
                target_height INTEGER,
                min_observed_height INTEGER NOT NULL,
                confirmed_unmined_at_height INTEGER, trust_status INTEGER,
                FOREIGN KEY (block) REFERENCES blocks(height),
                CONSTRAINT height_consistency CHECK (
                    block IS NULL OR mined_height = block
                ),
                CONSTRAINT min_observed_consistency CHECK (
                    mined_height IS NULL OR min_observed_height <= mined_height
                ),
                CONSTRAINT confirmed_unmined_consistency CHECK (
                    confirmed_unmined_at_height IS NULL OR mined_height IS NULL
                )
            )"###) }) },
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                -- Outputs received in this transaction
                SELECT ro.account_id              AS account_id,
                       transactions.mined_height  AS mined_height,
                       transactions.txid          AS txid,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       ro.value                   AS value,
                       ro.value                   AS received_value,
                       0                          AS spent_value,
                       0                          AS spent_note_count,
                       CASE
                            WHEN ro.is_change THEN 1
                            ELSE 0
                       END AS change_note_count,
                       CASE
                            WHEN ro.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (ro.memo IS NULL OR ro.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present,
                       -- The wallet cannot receive transparent outputs in shielding transactions.
                       CASE
                         WHEN ro.pool = 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN transactions
                     ON transactions.id_tx = ro.transaction_id
                UNION
                -- Outputs spent in this transaction
                SELECT ro.account_id              AS account_id,
                       transactions.mined_height  AS mined_height,
                       transactions.txid          AS txid,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       -ro.value                  AS value,
                       0                          AS received_value,
                       ro.value                   AS spent_value,
                       1                          AS spent_note_count,
                       0                          AS change_note_count,
                       0                          AS received_count,
                       0                          AS memo_present,
                       -- The wallet cannot spend shielded outputs in shielding transactions.
                       CASE
                         WHEN ro.pool != 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN v_received_output_spends ros
                     ON ros.pool = ro.pool
                     AND ros.received_output_id = ro.id_within_pool_table
                JOIN transactions
                     ON transactions.id_tx = ros.transaction_id
            ),
            -- Obtain a count of the notes that the wallet created in each transaction,
            -- not counting change notes.
            sent_note_counts AS (
                SELECT sent_notes.from_account_id     AS account_id,
                       transactions.txid              AS txid,
                       COUNT(DISTINCT sent_notes.id)  AS sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                JOIN transactions
                     ON transactions.id_tx = sent_notes.tx
                LEFT JOIN v_received_outputs ro
                     ON sent_notes.id = ro.sent_note_id
                WHERE COALESCE(ro.is_change, 0) = 0
                GROUP BY account_id, txid
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) AS max_height FROM blocks
            )
            SELECT accounts.uuid                AS account_uuid,
                   notes.mined_height           AS mined_height,
                   notes.txid                   AS txid,
                   transactions.tx_index        AS tx_index,
                   transactions.expiry_height   AS expiry_height,
                   transactions.raw             AS raw,
                   SUM(notes.value)             AS account_balance_delta,
                   SUM(notes.spent_value)       AS total_spent,
                   SUM(notes.received_value)    AS total_received,
                   transactions.fee             AS fee_paid,
                   SUM(notes.change_note_count) > 0  AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        notes.mined_height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined,
                   SUM(notes.spent_note_count) AS spent_note_count,
                   (
                        -- All of the wallet-spent and wallet-received notes are consistent with a
                        -- shielding transaction.
                        SUM(notes.does_not_match_shielding) = 0
                        -- The transaction contains at least one wallet-spent output.
                        AND SUM(notes.spent_note_count) > 0
                        -- The transaction contains at least one wallet-received note.
                        AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
                        -- We do not know about any external outputs of the transaction.
                        AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                   ) AS is_shielding,
                   transactions.trust_status
            FROM notes
            LEFT JOIN accounts ON accounts.id = notes.account_id
            LEFT JOIN transactions
                 ON notes.txid = transactions.txid
            LEFT JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = notes.mined_height
            LEFT JOIN sent_note_counts
                 ON sent_note_counts.account_id = notes.account_id
                 AND sent_note_counts.txid = notes.txid
            GROUP BY notes.account_id, notes.txid"###) }) },
    ] },
    // account_delete_cascade; source sha256 2deede8b78c5ab2426afc31f0f22fd2ea4ede6bf463649558988044c60f6cad3
    Migration { id: 0x07770bfdc54940699e05822458f81cc4, dependencies: &[0x9ffe82d43bf5459a9a217affd9e88e95, 0x254d4f20f0f6463580ed9d52c536d5df, 0x50fd092d97b944cfade986b526e4cd50, 0x894574e0663e401a8426820b1f75149a, 0x4e68277f6269467e9437f3853cc4a41f], effects: &[
        Effect { name: r###"addresses"###, object: Some(Object { kind: r###"table"###, table: r###"addresses"###, sql: Some(r###"CREATE TABLE "addresses" (
                id INTEGER NOT NULL PRIMARY KEY,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                key_scope INTEGER NOT NULL,
                diversifier_index_be BLOB,
                address TEXT NOT NULL,
                transparent_child_index INTEGER,
                cached_transparent_receiver_address TEXT,
                exposed_at_height INTEGER,
                receiver_flags INTEGER NOT NULL,
                transparent_receiver_next_check_time INTEGER,
                imported_transparent_receiver_pubkey BLOB,
                UNIQUE (account_id, key_scope, diversifier_index_be),
                UNIQUE (imported_transparent_receiver_pubkey),
                CONSTRAINT ck_addr_transparent_index_consistency CHECK (
                    (transparent_child_index IS NULL OR diversifier_index_be < x'0000000F00000000000000')
                    AND (
                        (
                            cached_transparent_receiver_address IS NULL
                            AND transparent_child_index IS NULL
                            AND imported_transparent_receiver_pubkey IS NULL
                        )
                        OR (
                            cached_transparent_receiver_address IS NOT NULL
                            AND (transparent_child_index IS NULL) == (imported_transparent_receiver_pubkey IS NOT NULL)
                        )
                    )
                ),
                CONSTRAINT ck_addr_foreign_or_diversified CHECK (
                    (diversifier_index_be IS NULL) == (key_scope = -1)
                )
            )"###) }) },
        Effect { name: r###"idx_addresses_accounts"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_accounts ON addresses (account_id ASC)"###) }) },
        Effect { name: r###"idx_addresses_indices"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_indices ON addresses (diversifier_index_be ASC)"###) }) },
        Effect { name: r###"idx_addresses_pubkeys"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_pubkeys ON addresses (imported_transparent_receiver_pubkey ASC)"###) }) },
        Effect { name: r###"idx_addresses_t_indices"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_t_indices ON addresses (transparent_child_index ASC)"###) }) },
        Effect { name: r###"idx_orchard_received_note_spends_note_id"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_note_spends"###, sql: Some(r###"CREATE INDEX idx_orchard_received_note_spends_note_id ON orchard_received_note_spends (orchard_received_note_id ASC)"###) }) },
        Effect { name: r###"idx_orchard_received_note_spends_transaction_id"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_note_spends"###, sql: Some(r###"CREATE INDEX idx_orchard_received_note_spends_transaction_id ON orchard_received_note_spends (transaction_id ASC)"###) }) },
        Effect { name: r###"idx_orchard_received_notes_account"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE INDEX idx_orchard_received_notes_account ON orchard_received_notes (account_id ASC)"###) }) },
        Effect { name: r###"idx_orchard_received_notes_address"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE INDEX idx_orchard_received_notes_address ON orchard_received_notes (address_id ASC)"###) }) },
        Effect { name: r###"idx_orchard_received_notes_tx"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE INDEX idx_orchard_received_notes_tx ON orchard_received_notes (transaction_id ASC)"###) }) },
        Effect { name: r###"idx_sapling_received_note_spends_note_id"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_note_spends"###, sql: Some(r###"CREATE INDEX idx_sapling_received_note_spends_note_id ON sapling_received_note_spends (sapling_received_note_id ASC)"###) }) },
        Effect { name: r###"idx_sapling_received_note_spends_transaction_id"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_note_spends"###, sql: Some(r###"CREATE INDEX idx_sapling_received_note_spends_transaction_id ON sapling_received_note_spends (transaction_id ASC)"###) }) },
        Effect { name: r###"idx_sapling_received_notes_account"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE INDEX idx_sapling_received_notes_account ON sapling_received_notes (account_id ASC)"###) }) },
        Effect { name: r###"idx_sapling_received_notes_address"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE INDEX idx_sapling_received_notes_address ON sapling_received_notes (address_id ASC)"###) }) },
        Effect { name: r###"idx_sapling_received_notes_tx"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE INDEX idx_sapling_received_notes_tx ON sapling_received_notes (transaction_id ASC)"###) }) },
        Effect { name: r###"idx_sent_notes_from_account"###, object: Some(Object { kind: r###"index"###, table: r###"sent_notes"###, sql: Some(r###"CREATE INDEX idx_sent_notes_from_account ON sent_notes (from_account_id)"###) }) },
        Effect { name: r###"idx_sent_notes_to_account"###, object: Some(Object { kind: r###"index"###, table: r###"sent_notes"###, sql: Some(r###"CREATE INDEX idx_sent_notes_to_account ON sent_notes (to_account_id)"###) }) },
        Effect { name: r###"idx_sent_notes_transaction_id"###, object: Some(Object { kind: r###"index"###, table: r###"sent_notes"###, sql: Some(r###"CREATE INDEX idx_sent_notes_transaction_id ON sent_notes (transaction_id)"###) }) },
        Effect { name: r###"idx_transparent_received_output_spends_output_id"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_received_output_spends"###, sql: Some(r###"CREATE INDEX idx_transparent_received_output_spends_output_id ON transparent_received_output_spends (transparent_received_output_id ASC)"###) }) },
        Effect { name: r###"idx_transparent_received_output_spends_transaction_id"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_received_output_spends"###, sql: Some(r###"CREATE INDEX idx_transparent_received_output_spends_transaction_id ON transparent_received_output_spends (transaction_id ASC)"###) }) },
        Effect { name: r###"idx_transparent_received_outputs_account"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_received_outputs"###, sql: Some(r###"CREATE INDEX idx_transparent_received_outputs_account ON transparent_received_outputs (account_id)"###) }) },
        Effect { name: r###"idx_transparent_received_outputs_address"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_received_outputs"###, sql: Some(r###"CREATE INDEX idx_transparent_received_outputs_address ON transparent_received_outputs (address_id)"###) }) },
        Effect { name: r###"idx_transparent_received_outputs_tx"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_received_outputs"###, sql: Some(r###"CREATE INDEX idx_transparent_received_outputs_tx ON transparent_received_outputs (transaction_id)"###) }) },
        Effect { name: r###"idx_transparent_spend_map_transaction_id"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_spend_map"###, sql: Some(r###"CREATE INDEX idx_transparent_spend_map_transaction_id ON transparent_spend_map (spending_transaction_id ASC)"###) }) },
        Effect { name: r###"idx_tssq_transaction_id"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_spend_search_queue"###, sql: Some(r###"CREATE INDEX idx_tssq_transaction_id ON transparent_spend_search_queue (transaction_id)"###) }) },
        Effect { name: r###"idx_tx_retrieval_queue_dependent_tx"###, object: Some(Object { kind: r###"index"###, table: r###"tx_retrieval_queue"###, sql: Some(r###"CREATE INDEX idx_tx_retrieval_queue_dependent_tx ON tx_retrieval_queue (dependent_transaction_id)"###) }) },
        Effect { name: r###"orchard_received_note_spends"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_received_note_spends"###, sql: Some(r###"CREATE TABLE "orchard_received_note_spends" (
                orchard_received_note_id INTEGER NOT NULL
                    REFERENCES orchard_received_notes(id) ON DELETE CASCADE,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                UNIQUE (orchard_received_note_id, transaction_id)
            )"###) }) },
        Effect { name: r###"orchard_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE TABLE "orchard_received_notes" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                action_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rho BLOB NOT NULL,
                rseed BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE,
                UNIQUE (transaction_id, action_index)
            )"###) }) },
        Effect { name: r###"orchard_received_notes_account"###, object: None },
        Effect { name: r###"orchard_received_notes_tx"###, object: None },
        Effect { name: r###"sapling_received_note_spends"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_received_note_spends"###, sql: Some(r###"CREATE TABLE "sapling_received_note_spends" (
                sapling_received_note_id INTEGER NOT NULL
                    REFERENCES sapling_received_notes(id) ON DELETE CASCADE,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                UNIQUE (sapling_received_note_id, transaction_id)
            )"###) }) },
        Effect { name: r###"sapling_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE TABLE "sapling_received_notes" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                output_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rcm BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE,
                UNIQUE (transaction_id, output_index)
            )"###) }) },
        Effect { name: r###"sapling_received_notes_account"###, object: None },
        Effect { name: r###"sapling_received_notes_tx"###, object: None },
        Effect { name: r###"sent_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sent_notes"###, sql: Some(r###"CREATE TABLE "sent_notes" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                output_pool INTEGER NOT NULL,
                output_index INTEGER NOT NULL,
                from_account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                to_address TEXT,
                to_account_id INTEGER
                    REFERENCES accounts(id) ON DELETE SET NULL,
                value INTEGER NOT NULL,
                memo BLOB,
                UNIQUE (transaction_id, output_pool, output_index)
            )"###) }) },
        Effect { name: r###"sent_notes_from_account"###, object: None },
        Effect { name: r###"sent_notes_to_account"###, object: None },
        Effect { name: r###"sent_notes_tx"###, object: None },
        Effect { name: r###"transparent_received_output_spends"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_received_output_spends"###, sql: Some(r###"CREATE TABLE "transparent_received_output_spends" (
                transparent_received_output_id INTEGER NOT NULL
                    REFERENCES transparent_received_outputs(id) ON DELETE CASCADE,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                UNIQUE (transparent_received_output_id, transaction_id)
            )"###) }) },
        Effect { name: r###"transparent_received_outputs"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_received_outputs"###, sql: Some(r###"CREATE TABLE "transparent_received_outputs" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                output_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                address TEXT NOT NULL,
                script BLOB NOT NULL,
                value_zat INTEGER NOT NULL,
                max_observed_unspent_height INTEGER,
                address_id INTEGER NOT NULL
                    REFERENCES addresses(id) ON DELETE CASCADE,
                UNIQUE (transaction_id, output_index)
            )"###) }) },
        Effect { name: r###"transparent_spend_map"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_spend_map"###, sql: Some(r###"CREATE TABLE "transparent_spend_map" (
                spending_transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                prevout_txid BLOB NOT NULL,
                prevout_output_index INTEGER NOT NULL,
                -- NOTE: We can't create a unique constraint on just (prevout_txid, prevout_output_index)
                -- because the same output may be attempted to be spent in multiple transactions, even
                -- though only one will ever be mined.
                UNIQUE (spending_transaction_id, prevout_txid, prevout_output_index)
            )"###) }) },
        Effect { name: r###"transparent_spend_search_queue"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_spend_search_queue"###, sql: Some(r###"CREATE TABLE "transparent_spend_search_queue" (
                address TEXT NOT NULL,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                output_index INTEGER NOT NULL,
                UNIQUE (transaction_id, output_index)
            )"###) }) },
        Effect { name: r###"tx_retrieval_queue"###, object: Some(Object { kind: r###"table"###, table: r###"tx_retrieval_queue"###, sql: Some(r###"CREATE TABLE "tx_retrieval_queue" (
                txid BLOB NOT NULL UNIQUE,
                query_type INTEGER NOT NULL,
                dependent_transaction_id INTEGER
                    REFERENCES transactions(id_tx) ON DELETE CASCADE
            )"###) }) },
        Effect { name: r###"v_address_uses"###, object: Some(Object { kind: r###"view"###, table: r###"v_address_uses"###, sql: Some(r###"CREATE VIEW v_address_uses AS
                SELECT orn.address_id, orn.account_id, orn.transaction_id, t.mined_height,
                       a.key_scope, a.diversifier_index_be, a.transparent_child_index
                FROM orchard_received_notes orn
                JOIN addresses a ON a.id = orn.address_id
                JOIN transactions t ON t.id_tx = orn.transaction_id
            UNION
                SELECT srn.address_id, srn.account_id, srn.transaction_id, t.mined_height,
                       a.key_scope, a.diversifier_index_be, a.transparent_child_index
                FROM sapling_received_notes srn
                JOIN addresses a ON a.id = srn.address_id
                JOIN transactions t ON t.id_tx = srn.transaction_id
            UNION
                SELECT tro.address_id, tro.account_id, tro.transaction_id, t.mined_height,
                       a.key_scope, a.diversifier_index_be, a.transparent_child_index
                FROM transparent_received_outputs tro
                JOIN addresses a ON a.id = tro.address_id
                JOIN transactions t ON t.id_tx = tro.transaction_id"###) }) },
        Effect { name: r###"v_received_output_spends"###, object: Some(Object { kind: r###"view"###, table: r###"v_received_output_spends"###, sql: Some(r###"CREATE VIEW v_received_output_spends AS
            SELECT
                2 AS pool,
                s.sapling_received_note_id AS received_output_id,
                s.transaction_id,
                rn.account_id
            FROM sapling_received_note_spends s
            JOIN sapling_received_notes rn ON rn.id = s.sapling_received_note_id
            UNION
            SELECT
                3 AS pool,
                s.orchard_received_note_id AS received_output_id,
                s.transaction_id,
                rn.account_id
            FROM orchard_received_note_spends s
            JOIN orchard_received_notes rn ON rn.id = s.orchard_received_note_id
            UNION
            SELECT
                0 AS pool,
                s.transparent_received_output_id AS received_output_id,
                s.transaction_id,
                rn.account_id
            FROM transparent_received_output_spends s
            JOIN transparent_received_outputs rn ON rn.id = s.transparent_received_output_id"###) }) },
        Effect { name: r###"v_received_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_received_outputs"###, sql: Some(r###"CREATE VIEW v_received_outputs AS
                SELECT
                    sapling_received_notes.id AS id_within_pool_table,
                    sapling_received_notes.transaction_id,
                    2 AS pool,
                    sapling_received_notes.output_index,
                    account_id,
                    sapling_received_notes.value,
                    is_change,
                    sapling_received_notes.memo,
                    sent_notes.id AS sent_note_id,
                    sapling_received_notes.address_id
                FROM sapling_received_notes
                LEFT JOIN sent_notes
                ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
                   (sapling_received_notes.transaction_id, 2, sapling_received_notes.output_index)
            UNION
                SELECT
                    orchard_received_notes.id AS id_within_pool_table,
                    orchard_received_notes.transaction_id,
                    3 AS pool,
                    orchard_received_notes.action_index AS output_index,
                    account_id,
                    orchard_received_notes.value,
                    is_change,
                    orchard_received_notes.memo,
                    sent_notes.id AS sent_note_id,
                    orchard_received_notes.address_id
                FROM orchard_received_notes
                LEFT JOIN sent_notes
                ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
                   (orchard_received_notes.transaction_id, 3, orchard_received_notes.action_index)
            UNION
                SELECT
                    u.id AS id_within_pool_table,
                    u.transaction_id,
                    0 AS pool,
                    u.output_index,
                    u.account_id,
                    u.value_zat AS value,
                    0 AS is_change,
                    NULL AS memo,
                    sent_notes.id AS sent_note_id,
                    u.address_id
                FROM transparent_received_outputs u
                LEFT JOIN sent_notes
                ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
                   (u.transaction_id, 0, u.output_index)"###) }) },
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                -- Outputs received in this transaction
                SELECT ro.account_id              AS account_id,
                       ro.transaction_id          AS transaction_id,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       ro.value                   AS value,
                       ro.value                   AS received_value,
                       0                          AS spent_value,
                       0                          AS spent_note_count,
                       CASE
                            WHEN ro.is_change THEN 1
                            ELSE 0
                       END AS change_note_count,
                       CASE
                            WHEN ro.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (ro.memo IS NULL OR ro.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present,
                       -- The wallet cannot receive transparent outputs in shielding transactions.
                       CASE
                         WHEN ro.pool = 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                UNION
                -- Outputs spent in this transaction
                SELECT ro.account_id              AS account_id,
                       ros.transaction_id         AS transaction_id,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       -ro.value                  AS value,
                       0                          AS received_value,
                       ro.value                   AS spent_value,
                       1                          AS spent_note_count,
                       0                          AS change_note_count,
                       0                          AS received_count,
                       0                          AS memo_present,
                       -- The wallet cannot spend shielded outputs in shielding transactions.
                       CASE
                         WHEN ro.pool != 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN v_received_output_spends ros
                     ON ros.pool = ro.pool
                     AND ros.received_output_id = ro.id_within_pool_table
            ),
            -- Obtain a count of the notes that the wallet created in each transaction,
            -- not counting change notes.
            sent_note_counts AS (
                SELECT sent_notes.from_account_id     AS account_id,
                       sent_notes.transaction_id      AS transaction_id,
                       COUNT(DISTINCT sent_notes.id)  AS sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                LEFT JOIN v_received_outputs ro ON sent_notes.id = ro.sent_note_id
                WHERE COALESCE(ro.is_change, 0) = 0
                GROUP BY account_id, sent_notes.transaction_id
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) AS max_height FROM blocks
            )
            SELECT accounts.uuid                AS account_uuid,
                   transactions.mined_height    AS mined_height,
                   transactions.txid            AS txid,
                   transactions.tx_index        AS tx_index,
                   transactions.expiry_height   AS expiry_height,
                   transactions.raw             AS raw,
                   SUM(notes.value)             AS account_balance_delta,
                   SUM(notes.spent_value)       AS total_spent,
                   SUM(notes.received_value)    AS total_received,
                   transactions.fee             AS fee_paid,
                   SUM(notes.change_note_count) > 0  AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        transactions.mined_height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined,
                   SUM(notes.spent_note_count) AS spent_note_count,
                   (
                        -- All of the wallet-spent and wallet-received notes are consistent with a
                        -- shielding transaction.
                        SUM(notes.does_not_match_shielding) = 0
                        -- The transaction contains at least one wallet-spent output.
                        AND SUM(notes.spent_note_count) > 0
                        -- The transaction contains at least one wallet-received note.
                        AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
                        -- We do not know about any external outputs of the transaction.
                        AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                   ) AS is_shielding,
                   transactions.trust_status
            FROM notes
            JOIN accounts ON accounts.id = notes.account_id
            JOIN transactions ON transactions.id_tx = notes.transaction_id
            LEFT JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = transactions.mined_height
            LEFT JOIN sent_note_counts
                 ON sent_note_counts.account_id = notes.account_id
                 AND sent_note_counts.transaction_id = notes.transaction_id
            GROUP BY notes.account_id, notes.transaction_id"###) }) },
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            WITH unioned AS (
                -- select all outputs received by the wallet
                SELECT transactions.txid            AS txid,
                       ro.pool                      AS output_pool,
                       ro.output_index              AS output_index,
                       from_account.uuid            AS from_account_uuid,
                       to_account.uuid              AS to_account_uuid,
                       a.address                    AS to_address,
                       a.diversifier_index_be       AS diversifier_index_be,
                       ro.value                     AS value,
                       ro.is_change                 AS is_change,
                       ro.memo                      AS memo
                FROM v_received_outputs ro
                JOIN transactions
                    ON transactions.id_tx = ro.transaction_id
                LEFT JOIN addresses a ON a.id = ro.address_id
                -- join to the sent_notes table to obtain `from_account_id`
                LEFT JOIN sent_notes ON sent_notes.id = ro.sent_note_id
                -- join on the accounts table to obtain account UUIDs
                LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
                LEFT JOIN accounts to_account ON to_account.id = ro.account_id
                UNION ALL
                -- select all outputs sent from the wallet to external recipients
                SELECT transactions.txid            AS txid,
                       sent_notes.output_pool       AS output_pool,
                       sent_notes.output_index      AS output_index,
                       from_account.uuid            AS from_account_uuid,
                       NULL                         AS to_account_uuid,
                       sent_notes.to_address        AS to_address,
                       NULL                         AS diversifier_index_be,
                       sent_notes.value             AS value,
                       0                            AS is_change,
                       sent_notes.memo              AS memo
                FROM sent_notes
                JOIN transactions
                    ON transactions.id_tx = sent_notes.transaction_id
                LEFT JOIN v_received_outputs ro ON ro.sent_note_id = sent_notes.id
                -- join on the accounts table to obtain account UUIDs
                LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
            )
            -- merge duplicate rows while retaining maximum information
            SELECT
                txid,
                output_pool,
                output_index,
                max(from_account_uuid) AS from_account_uuid,
                max(to_account_uuid) AS to_account_uuid,
                max(to_address) AS to_address,
                max(value) AS value,
                max(is_change) AS is_change,
                max(memo) AS memo
            FROM unioned
            GROUP BY txid, output_pool, output_index"###) }) },
    ] },
    // standalone_p2sh; source sha256 04ea8f98906e3c15fa813e2924f3d05c80c62426161f01b0b6ed862ac6d05404
    Migration { id: 0x944f8a1ebdfa4d5290ca663dee8efc62, dependencies: &[0x07770bfdc54940699e05822458f81cc4], effects: &[
        Effect { name: r###"addresses"###, object: Some(Object { kind: r###"table"###, table: r###"addresses"###, sql: Some(r###"CREATE TABLE "addresses" (
                id INTEGER NOT NULL PRIMARY KEY,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                key_scope INTEGER NOT NULL,
                diversifier_index_be BLOB,
                address TEXT NOT NULL,
                transparent_child_index INTEGER,
                cached_transparent_receiver_address TEXT,
                exposed_at_height INTEGER,
                receiver_flags INTEGER NOT NULL,
                transparent_receiver_next_check_time INTEGER,
                imported_transparent_receiver_pubkey BLOB,
                imported_transparent_receiver_script BLOB,
                UNIQUE (account_id, key_scope, diversifier_index_be),
                UNIQUE (imported_transparent_receiver_pubkey),
                UNIQUE (imported_transparent_receiver_script),
                CONSTRAINT ck_addr_transparent_index_consistency CHECK (
                    (transparent_child_index IS NULL OR diversifier_index_be < x'0000000F00000000000000')
                    AND (
                        (
                            cached_transparent_receiver_address IS NULL
                            AND transparent_child_index IS NULL
                            AND imported_transparent_receiver_pubkey IS NULL
                            AND imported_transparent_receiver_script IS NULL
                        )
                        OR (
                            cached_transparent_receiver_address IS NOT NULL
                            AND (
                                (transparent_child_index IS NULL) == (
                                    key_scope = -1 AND (
                                        (imported_transparent_receiver_pubkey IS NULL) !=
                                          (imported_transparent_receiver_script IS NULL)
                                    )
                                )
                            )
                        )
                    )
                ),
                CONSTRAINT ck_addr_foreign_or_diversified CHECK (
                    (diversifier_index_be IS NULL) == (key_scope = -1)
                )
            )"###) }) },
        Effect { name: r###"idx_addresses_accounts"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_accounts ON addresses (
                account_id ASC
            )"###) }) },
        Effect { name: r###"idx_addresses_indices"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_indices ON addresses (
                diversifier_index_be ASC
            )"###) }) },
        Effect { name: r###"idx_addresses_pubkeys"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_pubkeys ON addresses (
                imported_transparent_receiver_pubkey ASC
            )"###) }) },
        Effect { name: r###"idx_addresses_t_indices"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE INDEX idx_addresses_t_indices ON addresses (
                transparent_child_index ASC
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_addresses_3"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: None }) },
    ] },
    // add_transparent_receiver_address_index; source sha256 6dd1303b7668d71766bac844c42c94511822fb04fa2cb203d01a6868b5717315
    Migration { id: 0x3d4f12d63da94aceac65a0dd0a7adc32, dependencies: &[0x944f8a1ebdfa4d5290ca663dee8efc62], effects: &[
        Effect { name: r###"idx_addresses_cached_transparent_receiver_address"###, object: Some(Object { kind: r###"index"###, table: r###"addresses"###, sql: Some(r###"CREATE UNIQUE INDEX idx_addresses_cached_transparent_receiver_address
                 ON addresses (cached_transparent_receiver_address ASC)"###) }) },
    ] },
    // add_transparent_value_index; source sha256 0de3a14ad5a94664159821929c54181e036a9b98c5aff055a566382b764ee044
    Migration { id: 0x47c0e9c22eda4b9cbe1563c636c0e1c7, dependencies: &[0x07770bfdc54940699e05822458f81cc4], effects: &[
        Effect { name: r###"idx_transparent_received_outputs_value_zat"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_received_outputs"###, sql: Some(r###"CREATE INDEX idx_transparent_received_outputs_value_zat
                 ON transparent_received_outputs (value_zat DESC)"###) }) },
    ] },
    // ironwood_shardtree; source sha256 955bc281ceaa8920eeb0b3603eea91bd52a4f8886801426504b6ddec2f8aa490
    Migration { id: 0x1f5420e3f8a04afda9e5e20fc6fae271, dependencies: &[0x3a6487f7e06842bb9d126bb8dbe6da00, 0xc5bf7f71229741ff89e175e07c4e8838], effects: &[
        Effect { name: r###"blocks"###, object: Some(Object { kind: r###"table"###, table: r###"blocks"###, sql: Some(r###"CREATE TABLE blocks (
                height INTEGER PRIMARY KEY,
                hash BLOB NOT NULL,
                time INTEGER NOT NULL,
                sapling_tree BLOB NOT NULL
            , sapling_commitment_tree_size INTEGER, orchard_commitment_tree_size INTEGER, sapling_output_count INTEGER, orchard_action_count INTEGER, ironwood_commitment_tree_size INTEGER, ironwood_action_count INTEGER)"###) }) },
        Effect { name: r###"ironwood_tree_cap"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_tree_cap"###, sql: Some(r###"CREATE TABLE ironwood_tree_cap (
                -- cap_id exists only to be able to take advantage of `ON CONFLICT`
                -- upsert functionality; the table will only ever contain one row
                cap_id INTEGER PRIMARY KEY,
                cap_data BLOB NOT NULL
            )"###) }) },
        Effect { name: r###"ironwood_tree_checkpoint_marks_removed"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_tree_checkpoint_marks_removed"###, sql: Some(r###"CREATE TABLE ironwood_tree_checkpoint_marks_removed (
                checkpoint_id INTEGER NOT NULL,
                mark_removed_position INTEGER NOT NULL,
                FOREIGN KEY (checkpoint_id) REFERENCES ironwood_tree_checkpoints(checkpoint_id)
                ON DELETE CASCADE,
                CONSTRAINT spend_position_unique UNIQUE (checkpoint_id, mark_removed_position)
            )"###) }) },
        Effect { name: r###"ironwood_tree_checkpoints"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_tree_checkpoints"###, sql: Some(r###"CREATE TABLE ironwood_tree_checkpoints (
                checkpoint_id INTEGER PRIMARY KEY,
                position INTEGER
            )"###) }) },
        Effect { name: r###"ironwood_tree_retained_checkpoints"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_tree_retained_checkpoints"###, sql: Some(r###"CREATE TABLE ironwood_tree_retained_checkpoints (
                checkpoint_id INTEGER PRIMARY KEY
            )"###) }) },
        Effect { name: r###"ironwood_tree_shards"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_tree_shards"###, sql: Some(r###"CREATE TABLE ironwood_tree_shards (
                shard_index INTEGER PRIMARY KEY,
                subtree_end_height INTEGER,
                root_hash BLOB,
                shard_data BLOB,
                contains_marked INTEGER,
                CONSTRAINT root_unique UNIQUE (root_hash)
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_ironwood_tree_checkpoint_marks_removed_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_tree_checkpoint_marks_removed"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_ironwood_tree_shards_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_tree_shards"###, sql: None }) },
        Effect { name: r###"v_ironwood_shard_scan_ranges"###, object: Some(Object { kind: r###"view"###, table: r###"v_ironwood_shard_scan_ranges"###, sql: Some(r###"CREATE VIEW v_ironwood_shard_scan_ranges AS
                SELECT
                    shard.shard_index,
                    shard.shard_index << 16 AS start_position,
                    (shard.shard_index + 1) << 16 AS end_position_exclusive,
                    IFNULL(prev_shard.subtree_end_height, @ACTIVATION@) AS subtree_start_height,
                    shard.subtree_end_height,
                    shard.contains_marked,
                    scan_queue.block_range_start,
                    scan_queue.block_range_end,
                    scan_queue.priority
                FROM ironwood_tree_shards shard
                LEFT OUTER JOIN ironwood_tree_shards prev_shard
                    ON shard.shard_index = prev_shard.shard_index + 1
                -- Join with scan ranges that overlap with the subtree's involved blocks.
                INNER JOIN scan_queue ON (
                    subtree_start_height < scan_queue.block_range_end AND
                    (
                        scan_queue.block_range_start <= shard.subtree_end_height OR
                        shard.subtree_end_height IS NULL
                    )
                )"###) }) },
        Effect { name: r###"v_ironwood_shard_unscanned_ranges"###, object: Some(Object { kind: r###"view"###, table: r###"v_ironwood_shard_unscanned_ranges"###, sql: Some(r###"CREATE VIEW v_ironwood_shard_unscanned_ranges AS
                WITH wallet_birthday AS (SELECT MIN(birthday_height) AS height FROM accounts)
                SELECT
                    shard_index,
                    start_position,
                    end_position_exclusive,
                    subtree_start_height,
                    subtree_end_height,
                    contains_marked,
                    block_range_start,
                    block_range_end,
                    priority
                FROM v_ironwood_shard_scan_ranges
                INNER JOIN wallet_birthday
                WHERE priority > 10
                AND block_range_end > wallet_birthday.height"###) }) },
        Effect { name: r###"v_ironwood_shards_scan_state"###, object: Some(Object { kind: r###"view"###, table: r###"v_ironwood_shards_scan_state"###, sql: Some(r###"CREATE VIEW v_ironwood_shards_scan_state AS
            SELECT
                shard_index,
                start_position,
                end_position_exclusive,
                subtree_start_height,
                subtree_end_height,
                contains_marked,
                MAX(priority) AS max_priority
            FROM v_ironwood_shard_scan_ranges
            GROUP BY
                shard_index,
                start_position,
                end_position_exclusive,
                subtree_start_height,
                subtree_end_height,
                contains_marked"###) }) },
    ] },
    // witness_stabilized_notes; source sha256 b4065a1b05f528b963da4595510e6d5a1496c108ff106f0d97c1fefc4f1ca85d
    Migration { id: 0x6492556765ae495eb6cfd5f56e99e422, dependencies: &[0x07770bfdc54940699e05822458f81cc4, 0x1f5420e3f8a04afda9e5e20fc6fae271], effects: &[
        Effect { name: r###"idx_orchard_received_notes_witness_stabilized"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE INDEX idx_orchard_received_notes_witness_stabilized
                 ON orchard_received_notes (witness_stabilized)"###) }) },
        Effect { name: r###"idx_sapling_received_notes_witness_stabilized"###, object: Some(Object { kind: r###"index"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE INDEX idx_sapling_received_notes_witness_stabilized
                 ON sapling_received_notes (witness_stabilized)"###) }) },
        Effect { name: r###"orchard_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE TABLE "orchard_received_notes" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                action_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rho BLOB NOT NULL,
                rseed BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE, witness_stabilized INTEGER NOT NULL DEFAULT 0,
                UNIQUE (transaction_id, action_index)
            )"###) }) },
        Effect { name: r###"sapling_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE TABLE "sapling_received_notes" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                output_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rcm BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE, witness_stabilized INTEGER NOT NULL DEFAULT 0,
                UNIQUE (transaction_id, output_index)
            )"###) }) },
    ] },
    // orchard_note_version; source sha256 6f9286be43fc31d36f0f26e3f4960b8b7136455f8c423186d1e5c75dc039acc2
    Migration { id: 0x2aa44e8ee8a747608de4501956c969ac, dependencies: &[0x6492556765ae495eb6cfd5f56e99e422], effects: &[
        Effect { name: r###"orchard_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE TABLE "orchard_received_notes" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                action_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rho BLOB NOT NULL,
                rseed BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE, witness_stabilized INTEGER NOT NULL DEFAULT 0, note_version INTEGER NOT NULL DEFAULT 2,
                UNIQUE (transaction_id, action_index)
            )"###) }) },
    ] },
    // ironwood_received_notes; source sha256 4ac880a82349f08596ae46d82039e23f3d83db2af3f87aec3d7ebdb9b21b0e30
    Migration { id: 0xdc0d6c91b3db429e9a7bd671cc19656e, dependencies: &[0x2aa44e8ee8a747608de4501956c969ac], effects: &[
        Effect { name: r###"idx_ironwood_received_note_spends_note_id"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_received_note_spends"###, sql: Some(r###"CREATE INDEX idx_ironwood_received_note_spends_note_id ON ironwood_received_note_spends (
                ironwood_received_note_id ASC
            )"###) }) },
        Effect { name: r###"idx_ironwood_received_note_spends_transaction_id"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_received_note_spends"###, sql: Some(r###"CREATE INDEX idx_ironwood_received_note_spends_transaction_id ON ironwood_received_note_spends (
                transaction_id ASC
            )"###) }) },
        Effect { name: r###"idx_ironwood_received_notes_account"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_received_notes"###, sql: Some(r###"CREATE INDEX idx_ironwood_received_notes_account ON ironwood_received_notes (
                account_id ASC
            )"###) }) },
        Effect { name: r###"idx_ironwood_received_notes_address"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_received_notes"###, sql: Some(r###"CREATE INDEX idx_ironwood_received_notes_address ON ironwood_received_notes (
                address_id ASC
            )"###) }) },
        Effect { name: r###"idx_ironwood_received_notes_tx"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_received_notes"###, sql: Some(r###"CREATE INDEX idx_ironwood_received_notes_tx ON ironwood_received_notes (
                transaction_id ASC
            )"###) }) },
        Effect { name: r###"idx_ironwood_received_notes_witness_stabilized"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_received_notes"###, sql: Some(r###"CREATE INDEX idx_ironwood_received_notes_witness_stabilized ON ironwood_received_notes (
                witness_stabilized
            )"###) }) },
        Effect { name: r###"ironwood_received_note_spends"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_received_note_spends"###, sql: Some(r###"CREATE TABLE ironwood_received_note_spends (
                ironwood_received_note_id INTEGER NOT NULL
                    REFERENCES ironwood_received_notes(id) ON DELETE CASCADE,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                UNIQUE (ironwood_received_note_id, transaction_id)
            )"###) }) },
        Effect { name: r###"ironwood_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_received_notes"###, sql: Some(r###"CREATE TABLE ironwood_received_notes (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                action_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rho BLOB NOT NULL,
                rseed BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE,
                witness_stabilized INTEGER NOT NULL DEFAULT 0,
                note_version INTEGER NOT NULL,
                UNIQUE (transaction_id, action_index)
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_ironwood_received_note_spends_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_received_note_spends"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_ironwood_received_notes_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_received_notes"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_ironwood_received_notes_2"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_received_notes"###, sql: None }) },
    ] },
    // fix_bad_ironwood_change_flagging; source sha256 ed359e2853aa5677f39e78f2824bb6c9b89c57b050a0cf6fbf0a5be60f589643
    Migration { id: 0xcc104d0d54d64e079404202676561d94, dependencies: &[0xdc0d6c91b3db429e9a7bd671cc19656e], effects: &[
    ] },
    // ironwood_pool_code_views; source sha256 02d6fa86786e0a09560cb657a46a73eec574905711cd8b2d389e6eef3dc4d3db
    Migration { id: 0xa6ef40c7050a43c6a4e22f034168c979, dependencies: &[0xdc0d6c91b3db429e9a7bd671cc19656e], effects: &[
        Effect { name: r###"v_received_output_spends"###, object: Some(Object { kind: r###"view"###, table: r###"v_received_output_spends"###, sql: Some(r###"CREATE VIEW v_received_output_spends AS
            SELECT
                2 AS pool,
                s.sapling_received_note_id AS received_output_id,
                s.transaction_id,
                rn.account_id
            FROM sapling_received_note_spends s
            JOIN sapling_received_notes rn ON rn.id = s.sapling_received_note_id
            UNION
            SELECT
                3 AS pool,
                s.orchard_received_note_id AS received_output_id,
                s.transaction_id,
                rn.account_id
            FROM orchard_received_note_spends s
            JOIN orchard_received_notes rn ON rn.id = s.orchard_received_note_id
            UNION
            SELECT
                4 AS pool,
                s.ironwood_received_note_id AS received_output_id,
                s.transaction_id,
                rn.account_id
            FROM ironwood_received_note_spends s
            JOIN ironwood_received_notes rn ON rn.id = s.ironwood_received_note_id
            UNION
            SELECT
                0 AS pool,
                s.transparent_received_output_id AS received_output_id,
                s.transaction_id,
                rn.account_id
            FROM transparent_received_output_spends s
            JOIN transparent_received_outputs rn ON rn.id = s.transparent_received_output_id"###) }) },
        Effect { name: r###"v_received_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_received_outputs"###, sql: Some(r###"CREATE VIEW v_received_outputs AS
                SELECT
                    sapling_received_notes.id AS id_within_pool_table,
                    sapling_received_notes.transaction_id,
                    2 AS pool,
                    sapling_received_notes.output_index,
                    account_id,
                    sapling_received_notes.value,
                    is_change,
                    sapling_received_notes.memo,
                    sent_notes.id AS sent_note_id,
                    sapling_received_notes.address_id
                FROM sapling_received_notes
                LEFT JOIN sent_notes
                ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
                   (sapling_received_notes.transaction_id, 2, sapling_received_notes.output_index)
            UNION
                SELECT
                    orchard_received_notes.id AS id_within_pool_table,
                    orchard_received_notes.transaction_id,
                    3 AS pool,
                    orchard_received_notes.action_index AS output_index,
                    account_id,
                    orchard_received_notes.value,
                    is_change,
                    orchard_received_notes.memo,
                    sent_notes.id AS sent_note_id,
                    orchard_received_notes.address_id
                FROM orchard_received_notes
                LEFT JOIN sent_notes
                ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
                   (orchard_received_notes.transaction_id, 3, orchard_received_notes.action_index)
            UNION
                SELECT
                    ironwood_received_notes.id AS id_within_pool_table,
                    ironwood_received_notes.transaction_id,
                    4 AS pool,
                    ironwood_received_notes.action_index AS output_index,
                    account_id,
                    ironwood_received_notes.value,
                    is_change,
                    ironwood_received_notes.memo,
                    sent_notes.id AS sent_note_id,
                    ironwood_received_notes.address_id
                FROM ironwood_received_notes
                LEFT JOIN sent_notes
                ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
                   (ironwood_received_notes.transaction_id, 4, ironwood_received_notes.action_index)
            UNION
                SELECT
                    u.id AS id_within_pool_table,
                    u.transaction_id,
                    0 AS pool,
                    u.output_index,
                    u.account_id,
                    u.value_zat AS value,
                    0 AS is_change,
                    NULL AS memo,
                    sent_notes.id AS sent_note_id,
                    u.address_id
                FROM transparent_received_outputs u
                LEFT JOIN sent_notes
                ON (sent_notes.transaction_id, sent_notes.output_pool, sent_notes.output_index) =
                   (u.transaction_id, 0, u.output_index)"###) }) },
    ] },
    // ivk_item_cache; source sha256 178358bb32d6102db93ed45939a67f2901307e9e25ea7d055c09abb44d5d3af2
    Migration { id: 0x93278b0f77fe473cb88e7f285da38dd3, dependencies: &[0x944f8a1ebdfa4d5290ca663dee8efc62], effects: &[
        Effect { name: r###"accounts"###, object: Some(Object { kind: r###"table"###, table: r###"accounts"###, sql: Some(r###"CREATE TABLE "accounts" (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                uuid BLOB NOT NULL,
                account_kind INTEGER NOT NULL DEFAULT 0,
                key_source TEXT,
                hd_seed_fingerprint BLOB,
                hd_account_index INTEGER,
                ufvk TEXT,
                uivk TEXT NOT NULL,
                orchard_ivk_item_cache BLOB,
                sapling_ivk_item_cache BLOB,
                p2pkh_ivk_item_cache BLOB,
                p2sh_ivk_item_cache BLOB,
                birthday_height INTEGER NOT NULL,
                birthday_sapling_tree_size INTEGER,
                birthday_orchard_tree_size INTEGER,
                recover_until_height INTEGER,
                has_spend_key INTEGER NOT NULL DEFAULT 1,
                zcashd_legacy_address_index INTEGER NOT NULL DEFAULT -1,
                CHECK (
                  (
                    account_kind = 0
                    AND hd_seed_fingerprint IS NOT NULL
                    AND hd_account_index IS NOT NULL
                    AND ufvk IS NOT NULL
                  )
                  OR
                  (
                    account_kind = 1
                    AND (hd_seed_fingerprint IS NULL) = (hd_account_index IS NULL)
                  )
                ),
                CHECK (
                  NOT (p2pkh_ivk_item_cache IS NOT NULL AND p2sh_ivk_item_cache IS NOT NULL)
                )
            )"###) }) },
        Effect { name: r###"accounts_orchard_ivk"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX accounts_orchard_ivk ON accounts (orchard_ivk_item_cache)"###) }) },
        Effect { name: r###"accounts_p2pkh_ivk"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX accounts_p2pkh_ivk ON accounts (p2pkh_ivk_item_cache)"###) }) },
        Effect { name: r###"accounts_p2sh_ivk"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX accounts_p2sh_ivk ON accounts (p2sh_ivk_item_cache)"###) }) },
        Effect { name: r###"accounts_sapling_ivk"###, object: Some(Object { kind: r###"index"###, table: r###"accounts"###, sql: Some(r###"CREATE UNIQUE INDEX accounts_sapling_ivk ON accounts (sapling_ivk_item_cache)"###) }) },
    ] },
    // note_locking; source sha256 3c498f0bad984561eda6636c0681ba33bc83c46e4a83a7660439f6e0fbbedab1
    Migration { id: 0xa1d4a28c75824457b0f4d3f297b62a71, dependencies: &[0xdc0d6c91b3db429e9a7bd671cc19656e], effects: &[
        Effect { name: r###"ironwood_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_received_notes"###, sql: Some(r###"CREATE TABLE ironwood_received_notes (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                action_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rho BLOB NOT NULL,
                rseed BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE,
                witness_stabilized INTEGER NOT NULL DEFAULT 0,
                note_version INTEGER NOT NULL, lock_expiry_height INTEGER, lock_owner BLOB,
                UNIQUE (transaction_id, action_index)
            )"###) }) },
        Effect { name: r###"orchard_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_received_notes"###, sql: Some(r###"CREATE TABLE "orchard_received_notes" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                action_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rho BLOB NOT NULL,
                rseed BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE, witness_stabilized INTEGER NOT NULL DEFAULT 0, note_version INTEGER NOT NULL DEFAULT 2, lock_expiry_height INTEGER, lock_owner BLOB,
                UNIQUE (transaction_id, action_index)
            )"###) }) },
        Effect { name: r###"sapling_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_received_notes"###, sql: Some(r###"CREATE TABLE "sapling_received_notes" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                output_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rcm BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE, witness_stabilized INTEGER NOT NULL DEFAULT 0, lock_expiry_height INTEGER, lock_owner BLOB,
                UNIQUE (transaction_id, output_index)
            )"###) }) },
        Effect { name: r###"transparent_received_outputs"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_received_outputs"###, sql: Some(r###"CREATE TABLE "transparent_received_outputs" (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                output_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                address TEXT NOT NULL,
                script BLOB NOT NULL,
                value_zat INTEGER NOT NULL,
                max_observed_unspent_height INTEGER,
                address_id INTEGER NOT NULL
                    REFERENCES addresses(id) ON DELETE CASCADE, lock_expiry_height INTEGER, lock_owner BLOB,
                UNIQUE (transaction_id, output_index)
            )"###) }) },
    ] },
    // orchard_ironwood_migration_tables; source sha256 8232b8a07111651d78c15e6a76a74f0a0894a5a2fbf783d917ba3413706eb6ae
    Migration { id: 0x7b2f6a419c3d4e588a172f6b9d0c4e11, dependencies: &[0xdc0d6c91b3db429e9a7bd671cc19656e], effects: &[
        Effect { name: r###"idx_orchard_ironwood_migration_tx_due"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_ironwood_migration_transactions"###, sql: Some(r###"CREATE INDEX idx_orchard_ironwood_migration_tx_due ON orchard_ironwood_migration_transactions (state, scheduled_height)"###) }) },
        Effect { name: r###"idx_orchard_ironwood_migrations_account"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_ironwood_migrations"###, sql: Some(r###"CREATE UNIQUE INDEX idx_orchard_ironwood_migrations_account ON orchard_ironwood_migrations (account_id)"###) }) },
        Effect { name: r###"orchard_ironwood_migration_crossing_values"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migration_crossing_values"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migration_crossing_values (
            migration_id INTEGER NOT NULL REFERENCES orchard_ironwood_migrations(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            value INTEGER NOT NULL,
            PRIMARY KEY (migration_id, ordinal)
        )"###) }) },
        Effect { name: r###"orchard_ironwood_migration_prep_direct_funding"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migration_prep_direct_funding"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migration_prep_direct_funding (
            migration_id INTEGER NOT NULL REFERENCES orchard_ironwood_migrations(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            wallet_index INTEGER NOT NULL,
            value INTEGER NOT NULL,
            PRIMARY KEY (migration_id, ordinal)
        )"###) }) },
        Effect { name: r###"orchard_ironwood_migration_prep_inputs"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migration_prep_inputs"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migration_prep_inputs (
            migration_id INTEGER NOT NULL REFERENCES orchard_ironwood_migrations(id) ON DELETE CASCADE,
            layer INTEGER NOT NULL,
            tx_index INTEGER NOT NULL,
            ordinal INTEGER NOT NULL,
            source TEXT NOT NULL,
            wallet_index INTEGER,
            prior_layer INTEGER,
            prior_transaction INTEGER,
            prior_output INTEGER,
            value INTEGER NOT NULL,
            PRIMARY KEY (migration_id, layer, tx_index, ordinal)
        )"###) }) },
        Effect { name: r###"orchard_ironwood_migration_prep_outputs"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migration_prep_outputs"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migration_prep_outputs (
            migration_id INTEGER NOT NULL REFERENCES orchard_ironwood_migrations(id) ON DELETE CASCADE,
            layer INTEGER NOT NULL,
            tx_index INTEGER NOT NULL,
            ordinal INTEGER NOT NULL,
            role TEXT NOT NULL,
            value INTEGER NOT NULL,
            PRIMARY KEY (migration_id, layer, tx_index, ordinal)
        )"###) }) },
        Effect { name: r###"orchard_ironwood_migration_transaction_deps"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migration_transaction_deps"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migration_transaction_deps (
            migration_id INTEGER NOT NULL,
            tx_id INTEGER NOT NULL,
            ordinal INTEGER NOT NULL,
            depends_on_tx_id INTEGER NOT NULL,
            PRIMARY KEY (migration_id, tx_id, ordinal),
            FOREIGN KEY (migration_id, tx_id)
                REFERENCES orchard_ironwood_migration_transactions(migration_id, tx_id) ON DELETE CASCADE
        )"###) }) },
        Effect { name: r###"orchard_ironwood_migration_transactions"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migration_transactions"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migration_transactions (
            migration_id INTEGER NOT NULL REFERENCES orchard_ironwood_migrations(id) ON DELETE CASCADE,
            tx_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            kind_layer INTEGER,
            kind_index INTEGER,
            kind_crossing INTEGER,
            pczt BLOB NOT NULL,
            scheduled_height INTEGER NOT NULL,
            expiry_height INTEGER NOT NULL,
            anchor_boundary INTEGER,
            state TEXT NOT NULL,
            txid TEXT,
            mined_height INTEGER,
            lock_owner BLOB,
            PRIMARY KEY (migration_id, tx_id)
        )"###) }) },
        Effect { name: r###"orchard_ironwood_migrations"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migrations"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migrations (
            id INTEGER PRIMARY KEY,
            account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            status TEXT NOT NULL,
            note_split_fee_buffer INTEGER NOT NULL,
            note_split_change INTEGER,
            note_split_prep_fees INTEGER NOT NULL,
            note_split_total_input INTEGER NOT NULL,
            note_split_total_migratable INTEGER NOT NULL,
            anchor_bucket_interval INTEGER NOT NULL DEFAULT 144
        )"###) }) },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_crossing_values_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_ironwood_migration_crossing_values"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_prep_direct_funding_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_ironwood_migration_prep_direct_funding"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_prep_inputs_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_ironwood_migration_prep_inputs"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_prep_outputs_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_ironwood_migration_prep_outputs"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_transaction_deps_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_ironwood_migration_transaction_deps"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_transactions_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_ironwood_migration_transactions"###, sql: None }) },
    ] },
    // orchard_ironwood_migration_anchor_interval; source sha256 106d0d49bc1f2b30669f56bcc7a4a7b4a4532bdcf0e98a91924d984f760f1158
    Migration { id: 0x1ab3caf9ef1e482c93a3a3f1080038df, dependencies: &[0x7b2f6a419c3d4e588a172f6b9d0c4e11], effects: &[
    ] },
    // orchard_ironwood_migration_unsatisfiability; source sha256 e97304a9c112b0420a637d092636c76f94dc4cb45b730ddbbdb1e6e384ff3424
    Migration { id: 0xd334a9fab9dc46bd9b311fba6aa47f55, dependencies: &[0x1ab3caf9ef1e482c93a3a3f1080038df], effects: &[
        Effect { name: r###"orchard_ironwood_migration_spend_nullifiers"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migration_spend_nullifiers"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migration_spend_nullifiers (
    migration_id INTEGER NOT NULL,
    transfer_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    nullifier BLOB NOT NULL CHECK (length(nullifier) = 32),
    PRIMARY KEY (migration_id, transfer_id, ordinal),
    FOREIGN KEY (migration_id, transfer_id)
        REFERENCES orchard_ironwood_migration_transactions(migration_id, transfer_id) ON DELETE CASCADE
)"###) }) },
        Effect { name: r###"orchard_ironwood_migration_transaction_deps"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migration_transaction_deps"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migration_transaction_deps (
            migration_id INTEGER NOT NULL,
            transfer_id INTEGER NOT NULL,
            ordinal INTEGER NOT NULL,
            depends_on_transfer_id INTEGER NOT NULL,
            PRIMARY KEY (migration_id, transfer_id, ordinal),
            FOREIGN KEY (migration_id, transfer_id)
                REFERENCES orchard_ironwood_migration_transactions(migration_id, transfer_id) ON DELETE CASCADE
        )"###) }) },
        Effect { name: r###"orchard_ironwood_migration_transactions"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migration_transactions"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migration_transactions (
            migration_id INTEGER NOT NULL REFERENCES orchard_ironwood_migrations(id) ON DELETE CASCADE,
            transfer_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            kind_layer INTEGER,
            kind_index INTEGER,
            kind_crossing INTEGER,
            pczt BLOB NOT NULL,
            scheduled_height INTEGER NOT NULL,
            expiry_height INTEGER NOT NULL,
            anchor_boundary INTEGER,
            state TEXT NOT NULL,
            txid TEXT,
            mined_height INTEGER,
            lock_owner BLOB, unsatisfiable_at INTEGER, unsatisfiable_kind TEXT, broadcast_failure_at INTEGER,
            PRIMARY KEY (migration_id, transfer_id)
        )"###) }) },
        Effect { name: r###"orchard_ironwood_migrations"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_ironwood_migrations"###, sql: Some(r###"CREATE TABLE orchard_ironwood_migrations (
            id INTEGER PRIMARY KEY,
            account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            status TEXT NOT NULL,
            note_split_fee_buffer INTEGER NOT NULL,
            note_split_change INTEGER,
            note_split_prep_fees INTEGER NOT NULL,
            note_split_total_input INTEGER NOT NULL,
            note_split_total_migratable INTEGER NOT NULL,
            anchor_bucket_interval INTEGER NOT NULL DEFAULT 144
        , replan_threshold INTEGER NOT NULL DEFAULT 20)"###) }) },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_spend_nullifiers_1"###, object: Some(Object { kind: r###"index"###, table: r###"orchard_ironwood_migration_spend_nullifiers"###, sql: None }) },
    ] },
    // tree_retained_checkpoints; source sha256 1a7eca1b8c940ebf587fa5fe6dc9df5a2932f69b58f7a76c147459bc2aa28e97
    Migration { id: 0x62032f4a88b5454da59110f3d4c4d2b7, dependencies: &[0x6492556765ae495eb6cfd5f56e99e422], effects: &[
        Effect { name: r###"orchard_tree_retained_checkpoints"###, object: Some(Object { kind: r###"table"###, table: r###"orchard_tree_retained_checkpoints"###, sql: Some(r###"CREATE TABLE orchard_tree_retained_checkpoints (
                checkpoint_id INTEGER PRIMARY KEY
            )"###) }) },
        Effect { name: r###"sapling_tree_retained_checkpoints"###, object: Some(Object { kind: r###"table"###, table: r###"sapling_tree_retained_checkpoints"###, sql: Some(r###"CREATE TABLE sapling_tree_retained_checkpoints (
                checkpoint_id INTEGER PRIMARY KEY
            )"###) }) },
    ] },
    // tx_status_observation_intent; source sha256 2a59961f326f764e77d9f74d4a88405b87b3bff7b4b4276525fa71a45f3334b2
    Migration { id: 0xd7ab0ab214874cb7ba7472ece5fdba2f, dependencies: &[0xa1d4a28c75824457b0f4d3f297b62a71, 0xfec02b6139884b4f969998977fac9e7f], effects: &[
        Effect { name: r###"idx_tx_retrieval_queue_dependent_tx"###, object: Some(Object { kind: r###"index"###, table: r###"tx_retrieval_queue"###, sql: Some(r###"CREATE INDEX idx_tx_retrieval_queue_dependent_tx
            ON tx_retrieval_queue (dependent_transaction_id)"###) }) },
        Effect { name: r###"tx_retrieval_queue"###, object: Some(Object { kind: r###"table"###, table: r###"tx_retrieval_queue"###, sql: Some(r###"CREATE TABLE "tx_retrieval_queue" (
                txid BLOB NOT NULL,
                query_type INTEGER NOT NULL,
                dependent_transaction_id INTEGER
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                CONSTRAINT tx_retrieval_intent UNIQUE (txid, query_type)
            )"###) }) },
    ] },
    // v_address_uses_ironwood; source sha256 858290dfc472840a2b8c5ecb217393bd496c9fb342c3bf393e00d9b0a9300b2d
    Migration { id: 0xdab89587cd0543b0a5b58cb64a702791, dependencies: &[0xdc0d6c91b3db429e9a7bd671cc19656e], effects: &[
        Effect { name: r###"v_address_uses"###, object: Some(Object { kind: r###"view"###, table: r###"v_address_uses"###, sql: Some(r###"CREATE VIEW v_address_uses AS
                SELECT orn.address_id, orn.account_id, orn.transaction_id, t.mined_height,
                       a.key_scope, a.diversifier_index_be, a.transparent_child_index
                FROM orchard_received_notes orn
                JOIN addresses a ON a.id = orn.address_id
                JOIN transactions t ON t.id_tx = orn.transaction_id
            UNION
                SELECT irn.address_id, irn.account_id, irn.transaction_id, t.mined_height,
                       a.key_scope, a.diversifier_index_be, a.transparent_child_index
                FROM ironwood_received_notes irn
                JOIN addresses a ON a.id = irn.address_id
                JOIN transactions t ON t.id_tx = irn.transaction_id
            UNION
                SELECT srn.address_id, srn.account_id, srn.transaction_id, t.mined_height,
                       a.key_scope, a.diversifier_index_be, a.transparent_child_index
                FROM sapling_received_notes srn
                JOIN addresses a ON a.id = srn.address_id
                JOIN transactions t ON t.id_tx = srn.transaction_id
            UNION
                SELECT tro.address_id, tro.account_id, tro.transaction_id, t.mined_height,
                       a.key_scope, a.diversifier_index_be, a.transparent_child_index
                FROM transparent_received_outputs tro
                JOIN addresses a ON a.id = tro.address_id
                JOIN transactions t ON t.id_tx = tro.transaction_id"###) }) },
    ] },
    // v_transactions_pool_crossing; source sha256 dcd0f215de8c96ae71d3cac863d84b461046904eb9f837613ad7860652ce0823
    Migration { id: 0x835d61e15b884f4492b3746fb9173360, dependencies: &[0x07770bfdc54940699e05822458f81cc4, 0xa6ef40c7050a43c6a4e22f034168c979], effects: &[
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                -- Outputs received in this transaction
                SELECT ro.account_id              AS account_id,
                       ro.transaction_id          AS transaction_id,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       ro.value                   AS value,
                       ro.value                   AS received_value,
                       0                          AS spent_value,
                       0                          AS spent_note_count,
                       CASE
                            WHEN ro.is_change THEN 1
                            ELSE 0
                       END AS change_note_count,
                       CASE
                            WHEN ro.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (ro.memo IS NULL OR ro.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present,
                       -- The wallet cannot receive transparent outputs in shielding transactions.
                       CASE
                         WHEN ro.pool = 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                UNION
                -- Outputs spent in this transaction
                SELECT ro.account_id              AS account_id,
                       ros.transaction_id         AS transaction_id,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       -ro.value                  AS value,
                       0                          AS received_value,
                       ro.value                   AS spent_value,
                       1                          AS spent_note_count,
                       0                          AS change_note_count,
                       0                          AS received_count,
                       0                          AS memo_present,
                       -- The wallet cannot spend shielded outputs in shielding transactions.
                       CASE
                         WHEN ro.pool != 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN v_received_output_spends ros
                     ON ros.pool = ro.pool
                     AND ros.received_output_id = ro.id_within_pool_table
            ),
            -- What each account spent and received in each pool, per transaction. A pool the account
            -- received value in but spent nothing from is a pool that value crossed into from
            -- elsewhere, which is what `pool_crossings` below is built on.
            notes_by_pool AS (
                SELECT account_id, transaction_id, pool,
                       SUM(spent_note_count)                   AS spent_note_count,
                       SUM(received_count + change_note_count) AS received_note_count,
                       SUM(received_value)                     AS received_value
                FROM notes
                GROUP BY account_id, transaction_id, pool
            ),
            -- Obtain a count of the notes that the wallet created in each transaction,
            -- not counting change notes.
            sent_note_counts AS (
                SELECT sent_notes.from_account_id     AS account_id,
                       sent_notes.transaction_id      AS transaction_id,
                       COUNT(DISTINCT sent_notes.id)  AS sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                LEFT JOIN v_received_outputs ro ON sent_notes.id = ro.sent_note_id
                WHERE COALESCE(ro.is_change, 0) = 0
                GROUP BY account_id, sent_notes.transaction_id
            ),
            -- Identifies the transactions that are wallet-internal transfers moving an account's own
            -- funds between shielded pools, and reports the value that crossed. `crossing_value` is
            -- non-NULL exactly for such a transaction, so it carries both the classification and the
            -- amount; see the `pool_crossing_value` column below.
            pool_crossings AS (
                SELECT notes_by_pool.account_id     AS account_id,
                       notes_by_pool.transaction_id AS transaction_id,
                       CASE WHEN (
                            -- Every note spent and every output received by the wallet is shielded.
                            SUM(CASE WHEN notes_by_pool.pool = 0 THEN notes_by_pool.spent_note_count + notes_by_pool.received_note_count ELSE 0 END) = 0
                            -- The transaction spends at least one of the account's notes.
                            AND SUM(notes_by_pool.spent_note_count) > 0
                            -- At least one output was received in a pool the account spent nothing
                            -- from, so value crossed between pools.
                            AND SUM(CASE WHEN notes_by_pool.spent_note_count = 0 THEN notes_by_pool.received_note_count ELSE 0 END) > 0
                            -- We do not know about any external outputs of the transaction.
                            AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                       )
                       -- The total value received in the pools the account did not spend from. The
                       -- condition above guarantees at least one such output, so when this branch is
                       -- taken the sum is never NULL.
                       THEN SUM(CASE WHEN notes_by_pool.spent_note_count = 0 THEN notes_by_pool.received_value ELSE 0 END)
                       END AS crossing_value
                FROM notes_by_pool
                LEFT JOIN sent_note_counts
                     ON sent_note_counts.account_id = notes_by_pool.account_id
                     AND sent_note_counts.transaction_id = notes_by_pool.transaction_id
                GROUP BY notes_by_pool.account_id, notes_by_pool.transaction_id
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) AS max_height FROM blocks
            )
            SELECT accounts.uuid                AS account_uuid,
                   transactions.mined_height    AS mined_height,
                   transactions.txid            AS txid,
                   transactions.tx_index        AS tx_index,
                   transactions.expiry_height   AS expiry_height,
                   transactions.raw             AS raw,
                   SUM(notes.value)             AS account_balance_delta,
                   SUM(notes.spent_value)       AS total_spent,
                   SUM(notes.received_value)    AS total_received,
                   transactions.fee             AS fee_paid,
                   SUM(notes.change_note_count) > 0  AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        transactions.mined_height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined,
                   SUM(notes.spent_note_count) AS spent_note_count,
                   (
                        -- All of the wallet-spent and wallet-received notes are consistent with a
                        -- shielding transaction.
                        SUM(notes.does_not_match_shielding) = 0
                        -- The transaction contains at least one wallet-spent output.
                        AND SUM(notes.spent_note_count) > 0
                        -- The transaction contains at least one wallet-received note.
                        AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
                        -- We do not know about any external outputs of the transaction.
                        AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                   ) AS is_shielding,
                   -- The value that crossed pools, when this transaction is a wallet-internal transfer
                   -- between shielded pools; NULL when it is not such a transfer. A transaction is one
                   -- exactly when this column is non-NULL.
                   pool_crossings.crossing_value AS pool_crossing_value,
                   transactions.trust_status
            FROM notes
            JOIN accounts ON accounts.id = notes.account_id
            JOIN transactions ON transactions.id_tx = notes.transaction_id
            LEFT JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = transactions.mined_height
            LEFT JOIN sent_note_counts
                 ON sent_note_counts.account_id = notes.account_id
                 AND sent_note_counts.transaction_id = notes.transaction_id
            LEFT JOIN pool_crossings
                 ON pool_crossings.account_id = notes.account_id
                 AND pool_crossings.transaction_id = notes.transaction_id
            GROUP BY notes.account_id, notes.transaction_id"###) }) },
    ] },
    // zip318_classification; source sha256 41bbf28acb666afdecff069a3315f81a2997381e42a4a1b547f0e7be79cb4f86
    Migration { id: 0x0a35a9e46c1d4f7a9c0251b8de4f7c33, dependencies: &[0x835d61e15b884f4492b3746fb9173360], effects: &[
        Effect { name: r###"transactions"###, object: Some(Object { kind: r###"table"###, table: r###"transactions"###, sql: Some(r###"CREATE TABLE "transactions" (
                id_tx INTEGER PRIMARY KEY,
                txid BLOB NOT NULL UNIQUE,
                created TEXT,
                block INTEGER,
                mined_height INTEGER,
                tx_index INTEGER,
                expiry_height INTEGER,
                raw BLOB,
                fee INTEGER,
                target_height INTEGER,
                min_observed_height INTEGER NOT NULL,
                confirmed_unmined_at_height INTEGER, trust_status INTEGER, zip318_kind INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (block) REFERENCES blocks(height),
                CONSTRAINT height_consistency CHECK (
                    block IS NULL OR mined_height = block
                ),
                CONSTRAINT min_observed_consistency CHECK (
                    mined_height IS NULL OR min_observed_height <= mined_height
                ),
                CONSTRAINT confirmed_unmined_consistency CHECK (
                    confirmed_unmined_at_height IS NULL OR mined_height IS NULL
                )
            )"###) }) },
    ] },
    // v_transactions_zip318_kind; source sha256 4ed1110cf82fec53f0222cd3e91d3c1c0208c3d12be3ff5872df22f638a4a334
    Migration { id: 0x6f2b1c849a3d4e50b7c62d9f1a4e83b7, dependencies: &[0x0a35a9e46c1d4f7a9c0251b8de4f7c33], effects: &[
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                -- Outputs received in this transaction
                SELECT ro.account_id              AS account_id,
                       ro.transaction_id          AS transaction_id,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       ro.value                   AS value,
                       ro.value                   AS received_value,
                       0                          AS spent_value,
                       0                          AS spent_note_count,
                       CASE
                            WHEN ro.is_change THEN 1
                            ELSE 0
                       END AS change_note_count,
                       CASE
                            WHEN ro.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (ro.memo IS NULL OR ro.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present,
                       -- The wallet cannot receive transparent outputs in shielding transactions.
                       CASE
                         WHEN ro.pool = 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                UNION
                -- Outputs spent in this transaction
                SELECT ro.account_id              AS account_id,
                       ros.transaction_id         AS transaction_id,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       -ro.value                  AS value,
                       0                          AS received_value,
                       ro.value                   AS spent_value,
                       1                          AS spent_note_count,
                       0                          AS change_note_count,
                       0                          AS received_count,
                       0                          AS memo_present,
                       -- The wallet cannot spend shielded outputs in shielding transactions.
                       CASE
                         WHEN ro.pool != 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN v_received_output_spends ros
                     ON ros.pool = ro.pool
                     AND ros.received_output_id = ro.id_within_pool_table
            ),
            -- What each account spent and received in each pool, per transaction. A pool the account
            -- received value in but spent nothing from is a pool that value crossed into from
            -- elsewhere, which is what `pool_crossings` below is built on.
            notes_by_pool AS (
                SELECT account_id, transaction_id, pool,
                       SUM(spent_note_count)                   AS spent_note_count,
                       SUM(received_count + change_note_count) AS received_note_count,
                       SUM(received_value)                     AS received_value
                FROM notes
                GROUP BY account_id, transaction_id, pool
            ),
            -- Obtain a count of the notes that the wallet created in each transaction,
            -- not counting change notes.
            sent_note_counts AS (
                SELECT sent_notes.from_account_id     AS account_id,
                       sent_notes.transaction_id      AS transaction_id,
                       COUNT(DISTINCT sent_notes.id)  AS sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                LEFT JOIN v_received_outputs ro ON sent_notes.id = ro.sent_note_id
                WHERE COALESCE(ro.is_change, 0) = 0
                GROUP BY account_id, sent_notes.transaction_id
            ),
            -- Identifies the transactions that are wallet-internal transfers moving an account's own
            -- funds between shielded pools, and reports the value that crossed. `crossing_value` is
            -- non-NULL exactly for such a transaction, so it carries both the classification and the
            -- amount; see the `pool_crossing_value` column below.
            pool_crossings AS (
                SELECT notes_by_pool.account_id     AS account_id,
                       notes_by_pool.transaction_id AS transaction_id,
                       CASE WHEN (
                            -- Every note spent and every output received by the wallet is shielded.
                            SUM(CASE WHEN notes_by_pool.pool = 0 THEN notes_by_pool.spent_note_count + notes_by_pool.received_note_count ELSE 0 END) = 0
                            -- The transaction spends at least one of the account's notes.
                            AND SUM(notes_by_pool.spent_note_count) > 0
                            -- At least one output was received in a pool the account spent nothing
                            -- from, so value crossed between pools.
                            AND SUM(CASE WHEN notes_by_pool.spent_note_count = 0 THEN notes_by_pool.received_note_count ELSE 0 END) > 0
                            -- We do not know about any external outputs of the transaction.
                            AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                       )
                       -- The total value received in the pools the account did not spend from. The
                       -- condition above guarantees at least one such output, so when this branch is
                       -- taken the sum is never NULL.
                       THEN SUM(CASE WHEN notes_by_pool.spent_note_count = 0 THEN notes_by_pool.received_value ELSE 0 END)
                       END AS crossing_value
                FROM notes_by_pool
                LEFT JOIN sent_note_counts
                     ON sent_note_counts.account_id = notes_by_pool.account_id
                     AND sent_note_counts.transaction_id = notes_by_pool.transaction_id
                GROUP BY notes_by_pool.account_id, notes_by_pool.transaction_id
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) AS max_height FROM blocks
            )
            SELECT accounts.uuid                AS account_uuid,
                   transactions.mined_height    AS mined_height,
                   transactions.txid            AS txid,
                   transactions.tx_index        AS tx_index,
                   transactions.expiry_height   AS expiry_height,
                   transactions.raw             AS raw,
                   SUM(notes.value)             AS account_balance_delta,
                   SUM(notes.spent_value)       AS total_spent,
                   SUM(notes.received_value)    AS total_received,
                   transactions.fee             AS fee_paid,
                   SUM(notes.change_note_count) > 0  AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        transactions.mined_height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined,
                   SUM(notes.spent_note_count) AS spent_note_count,
                   (
                        -- All of the wallet-spent and wallet-received notes are consistent with a
                        -- shielding transaction.
                        SUM(notes.does_not_match_shielding) = 0
                        -- The transaction contains at least one wallet-spent output.
                        AND SUM(notes.spent_note_count) > 0
                        -- The transaction contains at least one wallet-received note.
                        AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
                        -- We do not know about any external outputs of the transaction.
                        AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                   ) AS is_shielding,
                   -- The value that crossed pools, when this transaction is a wallet-internal transfer
                   -- between shielded pools; NULL when it is not such a transfer. A transaction is one
                   -- exactly when this column is non-NULL.
                   pool_crossings.crossing_value AS pool_crossing_value,
                   transactions.trust_status,
                   transactions.zip318_kind
            FROM notes
            JOIN accounts ON accounts.id = notes.account_id
            JOIN transactions ON transactions.id_tx = notes.transaction_id
            LEFT JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = transactions.mined_height
            LEFT JOIN sent_note_counts
                 ON sent_note_counts.account_id = notes.account_id
                 AND sent_note_counts.transaction_id = notes.transaction_id
            LEFT JOIN pool_crossings
                 ON pool_crossings.account_id = notes.account_id
                 AND pool_crossings.transaction_id = notes.transaction_id
            GROUP BY notes.account_id, notes.transaction_id"###) }) },
    ] },
    // v_tx_outputs_key_scopes; source sha256 6f659332c9ad52c109307cf0f544f11a3e22f33ef6f7b424d5a98b4578b4f6bb
    Migration { id: 0x97ac36a9196f4dd9993d722bde95bebc, dependencies: &[0x07770bfdc54940699e05822458f81cc4], effects: &[
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            WITH unioned AS (
                -- select all outputs received by the wallet
                SELECT t.id_tx                      AS transaction_id,
                       t.txid                       AS txid,
                       t.mined_height               AS mined_height,
                       IFNULL(t.trust_status, 0)    AS trust_status,
                       ro.pool                      AS output_pool,
                       ro.output_index              AS output_index,
                       from_account.uuid            AS from_account_uuid,
                       to_account.uuid              AS to_account_uuid,
                       a.address                    AS to_address,
                       a.diversifier_index_be       AS diversifier_index_be,
                       ro.value                     AS value,
                       ro.is_change                 AS is_change,
                       ro.memo                      AS memo,
                       a.key_scope                  AS recipient_key_scope
                FROM v_received_outputs ro
                JOIN transactions t
                    ON t.id_tx = ro.transaction_id
                LEFT JOIN addresses a ON a.id = ro.address_id
                -- join to the sent_notes table to obtain `from_account_id`
                LEFT JOIN sent_notes ON sent_notes.id = ro.sent_note_id
                -- join on the accounts table to obtain account UUIDs
                LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
                LEFT JOIN accounts to_account ON to_account.id = ro.account_id
                UNION ALL
                -- select all outputs sent from the wallet to external recipients
                SELECT t.id_tx                      AS transaction_id,
                       t.txid                       AS txid,
                       t.mined_height               AS mined_height,
                       IFNULL(t.trust_status, 0)    AS trust_status,
                       sent_notes.output_pool       AS output_pool,
                       sent_notes.output_index      AS output_index,
                       from_account.uuid            AS from_account_uuid,
                       NULL                         AS to_account_uuid,
                       sent_notes.to_address        AS to_address,
                       NULL                         AS diversifier_index_be,
                       sent_notes.value             AS value,
                       0                            AS is_change,
                       sent_notes.memo              AS memo,
                       NULL                         AS recipient_key_scope
                FROM sent_notes
                JOIN transactions t
                    ON t.id_tx = sent_notes.transaction_id
                LEFT JOIN v_received_outputs ro ON ro.sent_note_id = sent_notes.id
                -- join on the accounts table to obtain account UUIDs
                LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
            )
            -- merge duplicate rows while retaining maximum information
            SELECT
                transaction_id,
                MAX(txid)                   AS txid,
                MAX(mined_height)           AS tx_mined_height,
                MIN(trust_status)           AS tx_trust_status,
                output_pool,
                output_index,
                MAX(from_account_uuid)      AS from_account_uuid,
                MAX(to_account_uuid)        AS to_account_uuid,
                MAX(to_address)             AS to_address,
                MAX(value)                  AS value,
                MAX(is_change)              AS is_change,
                MAX(memo)                   AS memo,
                MAX(recipient_key_scope)    AS recipient_key_scope
            FROM unioned
            GROUP BY transaction_id, output_pool, output_index"###) }) },
    ] },
    // v_tx_outputs_transparent_addresses; source sha256 b81ac7b38f5d52c1d3fbb5ab0ba4094ce9cbcb1ddb1acba4ce9b5e908d6ea10d
    Migration { id: 0x856ecde7c67047c19345b80ba5b12c4f, dependencies: &[0x97ac36a9196f4dd9993d722bde95bebc, 0xa6ef40c7050a43c6a4e22f034168c979], effects: &[
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
            WITH unioned AS (
                -- select all outputs received by the wallet
                SELECT t.id_tx                      AS transaction_id,
                       t.txid                       AS txid,
                       t.mined_height               AS mined_height,
                       IFNULL(t.trust_status, 0)    AS trust_status,
                       ro.pool                      AS output_pool,
                       ro.output_index              AS output_index,
                       from_account.uuid            AS from_account_uuid,
                       to_account.uuid              AS to_account_uuid,
                       -- for a transparent output, the address at which it was received is
                       -- the transparent receiver itself, not a unified address containing it
                       CASE ro.pool
                            WHEN 0 THEN a.cached_transparent_receiver_address
                            ELSE a.address
                       END                          AS to_address,
                       0                            AS is_sent_row,
                       a.diversifier_index_be       AS diversifier_index_be,
                       ro.value                     AS value,
                       ro.is_change                 AS is_change,
                       ro.memo                      AS memo,
                       a.key_scope                  AS recipient_key_scope
                FROM v_received_outputs ro
                JOIN transactions t
                    ON t.id_tx = ro.transaction_id
                LEFT JOIN addresses a ON a.id = ro.address_id
                -- join to the sent_notes table to obtain `from_account_id`
                LEFT JOIN sent_notes ON sent_notes.id = ro.sent_note_id
                -- join on the accounts table to obtain account UUIDs
                LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
                LEFT JOIN accounts to_account ON to_account.id = ro.account_id
                UNION ALL
                -- select all outputs sent by the wallet
                SELECT t.id_tx                      AS transaction_id,
                       t.txid                       AS txid,
                       t.mined_height               AS mined_height,
                       IFNULL(t.trust_status, 0)    AS trust_status,
                       sent_notes.output_pool       AS output_pool,
                       sent_notes.output_index      AS output_index,
                       from_account.uuid            AS from_account_uuid,
                       NULL                         AS to_account_uuid,
                       sent_notes.to_address        AS to_address,
                       1                            AS is_sent_row,
                       NULL                         AS diversifier_index_be,
                       sent_notes.value             AS value,
                       0                            AS is_change,
                       sent_notes.memo              AS memo,
                       NULL                         AS recipient_key_scope
                FROM sent_notes
                JOIN transactions t
                    ON t.id_tx = sent_notes.transaction_id
                LEFT JOIN v_received_outputs ro ON ro.sent_note_id = sent_notes.id
                -- join on the accounts table to obtain account UUIDs
                LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
            )
            -- merge duplicate rows while retaining maximum information
            SELECT
                transaction_id,
                MAX(txid)                   AS txid,
                MAX(mined_height)           AS tx_mined_height,
                MIN(trust_status)           AS tx_trust_status,
                output_pool,
                output_index,
                MAX(from_account_uuid)      AS from_account_uuid,
                MAX(to_account_uuid)        AS to_account_uuid,
                -- the recipient address recorded when the wallet created the output is
                -- authoritative; the receiving address is reported only for outputs the
                -- wallet did not create
                COALESCE(
                    MAX(CASE WHEN is_sent_row THEN to_address END),
                    MAX(CASE WHEN NOT is_sent_row THEN to_address END)
                )                           AS to_address,
                MAX(value)                  AS value,
                MAX(is_change)              AS is_change,
                MAX(memo)                   AS memo,
                MAX(recipient_key_scope)    AS recipient_key_scope
            FROM unioned
            GROUP BY transaction_id, output_pool, output_index"###) }) },
    ] },
    // ironwood_enhance; source sha256 fa05ccffd8a73cc9516702e10e263c3c9f95789cf4758f70517e064e46d40c7c
    Migration { id: 0xcf147152694f47e88c05c6dd853ac329, dependencies: &[0xa1d4a28c75824457b0f4d3f297b62a71, 0xd7ab0ab214874cb7ba7472ece5fdba2f, 0x6f2b1c849a3d4e50b7c62d9f1a4e83b7], effects: &[
        Effect { name: r###"ironwood_enhance_discovery_queue"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_enhance_discovery_queue"###, sql: Some(r###"CREATE TABLE ironwood_enhance_discovery_queue (
                transaction_id INTEGER PRIMARY KEY
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1))
            )"###) }) },
        Effect { name: r###"ironwood_enhance_metadata_queue"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_enhance_metadata_queue"###, sql: Some(r###"CREATE TABLE ironwood_enhance_metadata_queue (
                transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id_tx) ON DELETE CASCADE,
                commitment_tree_position INTEGER UNIQUE CHECK (commitment_tree_position >= 0),
                output_index INTEGER CHECK (output_index >= 0),
                compact_bound INTEGER NOT NULL DEFAULT 0 CHECK (compact_bound IN (0, 1)),
                CHECK ((commitment_tree_position IS NULL) = (output_index IS NULL)),
                CHECK (compact_bound = 0 OR commitment_tree_position IS NOT NULL)
            )"###) }) },
        Effect { name: r###"ironwood_enhance_outgoing_accounts"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_enhance_outgoing_accounts"###, sql: Some(r###"CREATE TABLE ironwood_enhance_outgoing_accounts (
                commitment_tree_position INTEGER NOT NULL
                    REFERENCES ironwood_enhance_outgoing_queue(commitment_tree_position)
                    ON DELETE CASCADE,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                PRIMARY KEY(commitment_tree_position, account_id)
            )"###) }) },
        Effect { name: r###"ironwood_enhance_outgoing_queue"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_enhance_outgoing_queue"###, sql: Some(r###"CREATE TABLE ironwood_enhance_outgoing_queue (
                commitment_tree_position INTEGER PRIMARY KEY
                    CHECK (commitment_tree_position >= 0),
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                output_index INTEGER NOT NULL CHECK (output_index >= 0),
                nullifier BLOB NOT NULL CHECK (length(nullifier) = 32),
                cmx BLOB NOT NULL CHECK (length(cmx) = 32),
                ephemeral_key BLOB NOT NULL CHECK (length(ephemeral_key) = 32),
                compact_ciphertext BLOB NOT NULL CHECK (length(compact_ciphertext) = 52),
                not_recoverable INTEGER NOT NULL DEFAULT 0 CHECK (not_recoverable IN (0, 1)),
                UNIQUE(transaction_id, output_index)
            )"###) }) },
        Effect { name: r###"ironwood_enhance_routing"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_enhance_routing"###, sql: Some(r###"CREATE TABLE ironwood_enhance_routing (
                transaction_id INTEGER PRIMARY KEY
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                route INTEGER NOT NULL CHECK (route IN (0, 1)),
                history_expiry_height INTEGER
                    CHECK (history_expiry_height >= 0 AND history_expiry_height < 500000000)
            )"###) }) },
        Effect { name: r###"ironwood_memo_retrieval_queue"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_memo_retrieval_queue"###, sql: Some(r###"CREATE TABLE ironwood_memo_retrieval_queue (
                received_note_id INTEGER PRIMARY KEY
                    REFERENCES ironwood_received_notes(id) ON DELETE CASCADE,
                commitment_tree_position INTEGER NOT NULL UNIQUE
                    CHECK (commitment_tree_position >= 0)
            )"###) }) },
        Effect { name: r###"ironwood_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_received_notes"###, sql: Some(r###"CREATE TABLE ironwood_received_notes (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                action_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rho BLOB NOT NULL,
                rseed BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE,
                witness_stabilized INTEGER NOT NULL DEFAULT 0,
                note_version INTEGER NOT NULL, lock_expiry_height INTEGER, lock_owner BLOB, ephemeral_key BLOB, compact_ciphertext BLOB
                CHECK ((ephemeral_key IS NULL AND compact_ciphertext IS NULL) OR
                       (ephemeral_key IS NOT NULL AND compact_ciphertext IS NOT NULL AND
                        length(ephemeral_key) = 32 AND length(compact_ciphertext) = 52)),
                UNIQUE (transaction_id, action_index)
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_ironwood_enhance_metadata_queue_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_enhance_metadata_queue"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_ironwood_enhance_outgoing_accounts_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_enhance_outgoing_accounts"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_ironwood_enhance_outgoing_queue_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_enhance_outgoing_queue"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_ironwood_memo_retrieval_queue_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_memo_retrieval_queue"###, sql: None }) },
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
            WITH
            notes AS (
                -- Outputs received in this transaction
                SELECT ro.account_id              AS account_id,
                       ro.transaction_id          AS transaction_id,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       ro.value                   AS value,
                       ro.value                   AS received_value,
                       0                          AS spent_value,
                       0                          AS spent_note_count,
                       CASE
                            WHEN ro.is_change THEN 1
                            ELSE 0
                       END AS change_note_count,
                       CASE
                            WHEN ro.is_change THEN 0
                            ELSE 1
                       END AS received_count,
                       CASE
                         WHEN (ro.memo IS NULL OR ro.memo = X'F6')
                           THEN 0
                         ELSE 1
                       END AS memo_present,
                       -- The wallet cannot receive transparent outputs in shielding transactions.
                       CASE
                         WHEN ro.pool = 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                UNION
                -- Outputs spent in this transaction
                SELECT ro.account_id              AS account_id,
                       ros.transaction_id         AS transaction_id,
                       ro.pool                    AS pool,
                       id_within_pool_table,
                       -ro.value                  AS value,
                       0                          AS received_value,
                       ro.value                   AS spent_value,
                       1                          AS spent_note_count,
                       0                          AS change_note_count,
                       0                          AS received_count,
                       0                          AS memo_present,
                       -- The wallet cannot spend shielded outputs in shielding transactions.
                       CASE
                         WHEN ro.pool != 0
                           THEN 1
                         ELSE 0
                       END AS does_not_match_shielding
                FROM v_received_outputs ro
                JOIN v_received_output_spends ros
                     ON ros.pool = ro.pool
                     AND ros.received_output_id = ro.id_within_pool_table
            ),
            -- What each account spent and received in each pool, per transaction. A pool the account
            -- received value in but spent nothing from is a pool that value crossed into from
            -- elsewhere, which is what `pool_crossings` below is built on.
            notes_by_pool AS (
                SELECT account_id, transaction_id, pool,
                       SUM(spent_note_count)                   AS spent_note_count,
                       SUM(received_count + change_note_count) AS received_note_count,
                       SUM(received_value)                     AS received_value
                FROM notes
                GROUP BY account_id, transaction_id, pool
            ),
            -- Obtain a count of the notes that the wallet created in each transaction,
            -- not counting change notes.
            sent_note_counts AS (
                SELECT sent_notes.from_account_id     AS account_id,
                       sent_notes.transaction_id      AS transaction_id,
                       COUNT(DISTINCT sent_notes.id)  AS sent_notes,
                       SUM(
                         CASE
                           WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                             THEN 0
                           ELSE 1
                         END
                       ) AS memo_count
                FROM sent_notes
                LEFT JOIN v_received_outputs ro ON sent_notes.id = ro.sent_note_id
                WHERE COALESCE(ro.is_change, 0) = 0
                GROUP BY account_id, sent_notes.transaction_id
            ),
            -- Identifies the transactions that are wallet-internal transfers moving an account's own
            -- funds between shielded pools, and reports the value that crossed. `crossing_value` is
            -- non-NULL exactly for such a transaction, so it carries both the classification and the
            -- amount; see the `pool_crossing_value` column below.
            pool_crossings AS (
                SELECT notes_by_pool.account_id     AS account_id,
                       notes_by_pool.transaction_id AS transaction_id,
                       CASE WHEN (
                            -- Every note spent and every output received by the wallet is shielded.
                            SUM(CASE WHEN notes_by_pool.pool = 0 THEN notes_by_pool.spent_note_count + notes_by_pool.received_note_count ELSE 0 END) = 0
                            -- The transaction spends at least one of the account's notes.
                            AND SUM(notes_by_pool.spent_note_count) > 0
                            -- At least one output was received in a pool the account spent nothing
                            -- from, so value crossed between pools.
                            AND SUM(CASE WHEN notes_by_pool.spent_note_count = 0 THEN notes_by_pool.received_note_count ELSE 0 END) > 0
                            -- We do not know about any external outputs of the transaction.
                            AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                       )
                       -- The total value received in the pools the account did not spend from. The
                       -- condition above guarantees at least one such output, so when this branch is
                       -- taken the sum is never NULL.
                       THEN SUM(CASE WHEN notes_by_pool.spent_note_count = 0 THEN notes_by_pool.received_value ELSE 0 END)
                       END AS crossing_value
                FROM notes_by_pool
                LEFT JOIN sent_note_counts
                     ON sent_note_counts.account_id = notes_by_pool.account_id
                     AND sent_note_counts.transaction_id = notes_by_pool.transaction_id
                GROUP BY notes_by_pool.account_id, notes_by_pool.transaction_id
            ),
            blocks_max_height AS (
                SELECT MAX(blocks.height) AS max_height FROM blocks
            )
            SELECT accounts.uuid                AS account_uuid,
                   transactions.mined_height    AS mined_height,
                   transactions.txid            AS txid,
                   transactions.tx_index        AS tx_index,
                   COALESCE(transactions.expiry_height, (SELECT history_expiry_height FROM ironwood_enhance_routing WHERE transaction_id = transactions.id_tx AND route = 0)) AS expiry_height,
                   transactions.raw             AS raw,
                   SUM(notes.value)             AS account_balance_delta,
                   SUM(notes.spent_value)       AS total_spent,
                   SUM(notes.received_value)    AS total_received,
                   transactions.fee             AS fee_paid,
                   SUM(notes.change_note_count) > 0  AS has_change,
                   MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
                   SUM(notes.received_count)         AS received_note_count,
                   SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
                   blocks.time                       AS block_time,
                   (
                        transactions.mined_height IS NULL
                        AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
                   ) AS expired_unmined,
                   SUM(notes.spent_note_count) AS spent_note_count,
                   (
                        -- All of the wallet-spent and wallet-received notes are consistent with a
                        -- shielding transaction.
                        SUM(notes.does_not_match_shielding) = 0
                        -- The transaction contains at least one wallet-spent output.
                        AND SUM(notes.spent_note_count) > 0
                        -- The transaction contains at least one wallet-received note.
                        AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
                        -- We do not know about any external outputs of the transaction.
                        AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
                   ) AS is_shielding,
                   -- The value that crossed pools, when this transaction is a wallet-internal transfer
                   -- between shielded pools; NULL when it is not such a transfer. A transaction is one
                   -- exactly when this column is non-NULL.
                   pool_crossings.crossing_value AS pool_crossing_value,
                   transactions.trust_status,
                   transactions.zip318_kind
            FROM notes
            JOIN accounts ON accounts.id = notes.account_id
            JOIN transactions ON transactions.id_tx = notes.transaction_id
            LEFT JOIN blocks_max_height
            LEFT JOIN blocks ON blocks.height = transactions.mined_height
            LEFT JOIN sent_note_counts
                 ON sent_note_counts.account_id = notes.account_id
                 AND sent_note_counts.transaction_id = notes.transaction_id
            LEFT JOIN pool_crossings
                 ON pool_crossings.account_id = notes.account_id
                 AND pool_crossings.transaction_id = notes.transaction_id
            GROUP BY notes.account_id, notes.transaction_id"###) }) },
    ] },
    // one_time_ivk; source sha256 07f12a13863e2b94feb8efc01b4d6a82cd193bda494abfb04d8859b6693dd4b1
    Migration { id: 0x5775610295834af5b4115eead49fc9f0, dependencies: &[0xcf147152694f47e88c05c6dd853ac329], effects: &[
        Effect { name: r###"idx_ironwood_one_time_keys_account_receiver"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_one_time_keys"###, sql: Some(r###"CREATE INDEX idx_ironwood_one_time_keys_account_receiver
                ON ironwood_one_time_keys(account_id, receiver)"###) }) },
        Effect { name: r###"idx_ironwood_one_time_operations_key"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_one_time_operations"###, sql: Some(r###"CREATE INDEX idx_ironwood_one_time_operations_key
                ON ironwood_one_time_operations(one_time_key_id)"###) }) },
        Effect { name: r###"idx_ironwood_received_notes_one_time_key"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_received_notes"###, sql: Some(r###"CREATE INDEX idx_ironwood_received_notes_one_time_key ON ironwood_received_notes (
                one_time_key_id ASC
            ) WHERE one_time_key_id IS NOT NULL"###) }) },
        Effect { name: r###"ironwood_one_time_keys"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_one_time_keys"###, sql: Some(r###"CREATE TABLE ironwood_one_time_keys (
                id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                purpose INTEGER NOT NULL CHECK (purpose BETWEEN 0 AND 255),
                key_index BLOB NOT NULL CHECK (typeof(key_index) = 'blob' AND length(key_index) = 8),
                receiver BLOB NOT NULL CHECK (typeof(receiver) = 'blob' AND length(receiver) = 43),
                funding_height INTEGER CHECK (funding_height BETWEEN 0 AND 4294967295),
                used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1)),
                prebirthday_height INTEGER CHECK (prebirthday_height BETWEEN 0 AND 4294967295),
                registered_at INTEGER NOT NULL DEFAULT 0,
                reserved_at INTEGER,
                released_at INTEGER,
                reservation_floor INTEGER,
                UNIQUE (account_id, purpose, key_index)
            )"###) }) },
        Effect { name: r###"ironwood_one_time_operations"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_one_time_operations"###, sql: Some(r###"CREATE TABLE ironwood_one_time_operations (
                id INTEGER PRIMARY KEY,
                one_time_key_id INTEGER NOT NULL REFERENCES ironwood_one_time_keys(id) ON DELETE CASCADE,
                request TEXT UNIQUE,
                reference TEXT,
                memo TEXT,
                deadline INTEGER NOT NULL,
                begun_at INTEGER NOT NULL,
                started INTEGER NOT NULL DEFAULT 0 CHECK (started IN (0, 1)),
                funded INTEGER NOT NULL DEFAULT 0 CHECK (funded IN (0, 1)),
                rejected INTEGER NOT NULL DEFAULT 0 CHECK (rejected IN (0, 1)),
                observed_at INTEGER NOT NULL DEFAULT 0,
                expectation INTEGER NOT NULL DEFAULT 0 CHECK (expectation BETWEEN 0 AND 255),
                expected_value INTEGER CHECK (expected_value > 0),
                CHECK (request IS NOT NULL OR reference IS NOT NULL)
            )"###) }) },
        Effect { name: r###"ironwood_received_notes"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_received_notes"###, sql: Some(r###"CREATE TABLE ironwood_received_notes (
                id INTEGER PRIMARY KEY,
                transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                action_index INTEGER NOT NULL,
                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,
                diversifier BLOB NOT NULL,
                value INTEGER NOT NULL,
                rho BLOB NOT NULL,
                rseed BLOB NOT NULL,
                nf BLOB UNIQUE,
                is_change INTEGER NOT NULL,
                memo BLOB,
                commitment_tree_position INTEGER,
                recipient_key_scope INTEGER,
                address_id INTEGER
                    REFERENCES addresses(id) ON DELETE CASCADE,
                witness_stabilized INTEGER NOT NULL DEFAULT 0,
                note_version INTEGER NOT NULL, lock_expiry_height INTEGER, lock_owner BLOB, ephemeral_key BLOB, compact_ciphertext BLOB
                CHECK ((ephemeral_key IS NULL AND compact_ciphertext IS NULL) OR
                       (ephemeral_key IS NOT NULL AND compact_ciphertext IS NOT NULL AND
                        length(ephemeral_key) = 32 AND length(compact_ciphertext) = 52)), one_time_key_id INTEGER
                REFERENCES ironwood_one_time_keys(id),
                UNIQUE (transaction_id, action_index)
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_ironwood_one_time_keys_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_one_time_keys"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_ironwood_one_time_operations_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_one_time_operations"###, sql: None }) },
    ] },
    // one_time_ivk_discovery; source sha256 388c0b0aa771e2529c8940446eaa2ee6c9c361cb223d0f5ab8dfcab85814961e
    Migration { id: 0xc5b63b3b81904d0fb2173921d7aac225, dependencies: &[0x5775610295834af5b4115eead49fc9f0], effects: &[
        Effect { name: r###"idx_ironwood_spend_journal_nullifiers_nf"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_spend_journal_nullifiers"###, sql: Some(r###"CREATE INDEX idx_ironwood_spend_journal_nullifiers_nf
                ON ironwood_spend_journal_nullifiers(nf)"###) }) },
        Effect { name: r###"ironwood_journal_coverage"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_journal_coverage"###, sql: Some(r###"CREATE TABLE ironwood_journal_coverage (
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                start_height INTEGER NOT NULL CHECK (start_height BETWEEN 0 AND 4294967295),
                end_height INTEGER NOT NULL
                    CHECK (end_height > start_height AND end_height <= 4294967296),
                PRIMARY KEY (account_id, start_height)
            )"###) }) },
        Effect { name: r###"ironwood_one_time_lookups"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_one_time_lookups"###, sql: Some(r###"CREATE TABLE ironwood_one_time_lookups (
                one_time_key_id INTEGER PRIMARY KEY REFERENCES ironwood_one_time_keys(id) ON DELETE CASCADE,
                target_height INTEGER CHECK (target_height BETWEEN 0 AND 4294967295),
                reasons INTEGER NOT NULL DEFAULT 0 CHECK (reasons BETWEEN 0 AND 7),
                done_height INTEGER CHECK (done_height BETWEEN 0 AND 4294967295),
                done_from INTEGER CHECK (done_from BETWEEN 0 AND 4294967295),
                start_height INTEGER NOT NULL DEFAULT 0 CHECK (start_height BETWEEN 0 AND 4294967295),
                checked_height INTEGER CHECK (checked_height BETWEEN 0 AND 4294967295),
                inventory BLOB CHECK (length(inventory) = 32),
                shard INTEGER CHECK (shard BETWEEN 0 AND 4294967295),
                segment INTEGER CHECK (segment BETWEEN 0 AND 4294967295),
                last_record BLOB CHECK (length(last_record) = 289),
                read_complete INTEGER NOT NULL DEFAULT 0 CHECK (read_complete IN (0, 1)),
                attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
                next_attempt_at INTEGER NOT NULL DEFAULT 0,
                CHECK ((inventory IS NULL) = (shard IS NULL)
                    AND (inventory IS NULL) = (segment IS NULL)),
                CHECK (inventory IS NOT NULL OR last_record IS NULL)
            )"###) }) },
        Effect { name: r###"ironwood_one_time_payment_recovery"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_one_time_payment_recovery"###, sql: Some(r###"CREATE TABLE ironwood_one_time_payment_recovery (
                one_time_key_id INTEGER NOT NULL REFERENCES ironwood_one_time_keys(id) ON DELETE CASCADE,
                txid BLOB NOT NULL CHECK (length(txid) = 32),
                action_index INTEGER NOT NULL CHECK (action_index BETWEEN 0 AND 4294967295),
                height INTEGER NOT NULL CHECK (height BETWEEN 0 AND 4294967295),
                block_hash BLOB NOT NULL CHECK (length(block_hash) = 32),
                tx_index INTEGER NOT NULL CHECK (tx_index BETWEEN 0 AND 65535),
                position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4294967295),
                encrypted_note BLOB NOT NULL CHECK (length(encrypted_note) = 148),
                payments BLOB CHECK (length(payments) = 32),
                witnesses BLOB CHECK (length(witnesses) = 32),
                ordinal INTEGER CHECK (ordinal BETWEEN 0 AND 4294967295),
                witness BLOB CHECK (length(witness) = 512),
                witness_height INTEGER CHECK (witness_height BETWEEN 0 AND 4294967295),
                witness_hash BLOB CHECK (length(witness_hash) = 32),
                witness_size INTEGER CHECK (witness_size BETWEEN 0 AND 4294967296),
                PRIMARY KEY (txid, action_index),
                CHECK ((payments IS NULL) = (ordinal IS NULL)
                    AND (payments IS NULL) = (witnesses IS NULL)),
                CHECK ((witness IS NULL OR payments IS NOT NULL)
                    AND (witness IS NULL) = (witness_height IS NULL)
                    AND (witness IS NULL) = (witness_hash IS NULL)
                    AND (witness IS NULL) = (witness_size IS NULL))
            )"###) }) },
        Effect { name: r###"ironwood_one_time_recovery"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_one_time_recovery"###, sql: Some(r###"CREATE TABLE ironwood_one_time_recovery (
                account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
                enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
                generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
                history_revision BLOB NOT NULL DEFAULT X'0000000000000000'
                    CHECK (length(history_revision) = 8),
                filter_height INTEGER CHECK (filter_height BETWEEN 0 AND 4294967295),
                filter_hash BLOB CHECK (length(filter_hash) = 32),
                skipped_height INTEGER CHECK (skipped_height BETWEEN 0 AND 4294967295),
                restore_height INTEGER CHECK (restore_height BETWEEN 0 AND 4294967295),
                restore_next BLOB NOT NULL DEFAULT X'0000000000000000' CHECK (length(restore_next) = 8),
                restore_gap INTEGER NOT NULL DEFAULT 0 CHECK (restore_gap BETWEEN 0 AND 4),
                restore_done INTEGER NOT NULL DEFAULT 0 CHECK (restore_done IN (0, 1)),
                manual_active INTEGER NOT NULL DEFAULT 0 CHECK (manual_active IN (0, 1)),
                manual_purpose INTEGER NOT NULL DEFAULT 0 CHECK (manual_purpose IN (0, 1)),
                manual_next BLOB NOT NULL DEFAULT X'0000000000000000' CHECK (length(manual_next) = 8),
                manual_end BLOB CHECK (length(manual_end) = 8),
                manual_height INTEGER CHECK (manual_height BETWEEN 0 AND 4294967295),
                CHECK ((filter_height IS NULL) = (filter_hash IS NULL))
            )"###) }) },
        Effect { name: r###"ironwood_spend_journal"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_spend_journal"###, sql: Some(r###"CREATE TABLE ironwood_spend_journal (
                block_height INTEGER NOT NULL CHECK (block_height BETWEEN 0 AND 4294967295),
                tx_index INTEGER NOT NULL CHECK (tx_index BETWEEN 0 AND 65535),
                txid BLOB NOT NULL CHECK (length(txid) = 32),
                PRIMARY KEY (block_height, tx_index)
            )"###) }) },
        Effect { name: r###"ironwood_spend_journal_nullifiers"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_spend_journal_nullifiers"###, sql: Some(r###"CREATE TABLE ironwood_spend_journal_nullifiers (
                block_height INTEGER NOT NULL,
                tx_index INTEGER NOT NULL,
                action_index INTEGER NOT NULL CHECK (action_index >= 0),
                nf BLOB NOT NULL CHECK (length(nf) = 32),
                PRIMARY KEY (block_height, tx_index, action_index),
                FOREIGN KEY (block_height, tx_index)
                    REFERENCES ironwood_spend_journal(block_height, tx_index) ON DELETE CASCADE
            )"###) }) },
        Effect { name: r###"sqlite_autoindex_ironwood_journal_coverage_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_journal_coverage"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_ironwood_one_time_payment_recovery_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_one_time_payment_recovery"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_ironwood_spend_journal_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_spend_journal"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_ironwood_spend_journal_nullifiers_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_spend_journal_nullifiers"###, sql: None }) },
    ] },
    // status_inclusion_evidence; source sha256 013e8c403afe53369237c581c03406784a2246d50a7c04f719651fdc2f654e27
    Migration { id: 0xb6f3d060803a4b17aecd6a02d9cb2249, dependencies: &[0xcf147152694f47e88c05c6dd853ac329, 0xd334a9fab9dc46bd9b311fba6aa47f55, 0xdab89587cd0543b0a5b58cb64a702791, 0xcc104d0d54d64e079404202676561d94, 0x62032f4a88b5454da59110f3d4c4d2b7], effects: &[
    ] },
    // drop_zip318_pool_migration; source sha256 d8933220c03d746aa7bedc7c8d20c9c60e7e2b41d773d72748169a970a74dfd8
    Migration { id: 0x772a06323d0e4dffb1f8c64863eefaaa, dependencies: &[0xb6f3d060803a4b17aecd6a02d9cb2249], effects: &[
        Effect { name: r###"idx_orchard_ironwood_migration_tx_due"###, object: None },
        Effect { name: r###"idx_orchard_ironwood_migrations_account"###, object: None },
        Effect { name: r###"orchard_ironwood_migration_crossing_values"###, object: None },
        Effect { name: r###"orchard_ironwood_migration_prep_direct_funding"###, object: None },
        Effect { name: r###"orchard_ironwood_migration_prep_inputs"###, object: None },
        Effect { name: r###"orchard_ironwood_migration_prep_outputs"###, object: None },
        Effect { name: r###"orchard_ironwood_migration_spend_nullifiers"###, object: None },
        Effect { name: r###"orchard_ironwood_migration_transaction_deps"###, object: None },
        Effect { name: r###"orchard_ironwood_migration_transactions"###, object: None },
        Effect { name: r###"orchard_ironwood_migrations"###, object: None },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_crossing_values_1"###, object: None },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_prep_direct_funding_1"###, object: None },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_prep_inputs_1"###, object: None },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_prep_outputs_1"###, object: None },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_spend_nullifiers_1"###, object: None },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_transaction_deps_1"###, object: None },
        Effect { name: r###"sqlite_autoindex_orchard_ironwood_migration_transactions_1"###, object: None },
    ] },
    // transparent_ledger_schema; source sha256 b0bf10834d7b5c35c905aed4afd9582bebbb648623508832b3a2b218919d5036
    Migration { id: 0x8f290af0eb5a4f1e88d43550fc0ff911, dependencies: &[0x772a06323d0e4dffb1f8c64863eefaaa, 0x856ecde7c67047c19345b80ba5b12c4f, 0x93278b0f77fe473cb88e7f285da38dd3, 0x3d4f12d63da94aceac65a0dd0a7adc32, 0x47c0e9c22eda4b9cbe1563c636c0e1c7], effects: &[
        Effect { name: r###"sqlite_autoindex_tpir_output_origins_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_output_origins"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tpir_spend_origins_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_spend_origins"###, sql: None }) },
        Effect { name: r###"tpir_meta"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_meta"###, sql: Some(r###"CREATE TABLE tpir_meta (
                id INTEGER PRIMARY KEY CHECK (id = 0),
                applied_mode INTEGER NOT NULL CHECK (applied_mode IN (0, 2)),
                policy_generation INTEGER NOT NULL CHECK (policy_generation >= 0),
                min_reader_version INTEGER NOT NULL CHECK (min_reader_version >= 1)
            )"###) }) },
        Effect { name: r###"tpir_output_origins"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_output_origins"###, sql: Some(r###"CREATE TABLE tpir_output_origins (
                output_id INTEGER NOT NULL
                    REFERENCES transparent_received_outputs(id) ON DELETE CASCADE,
                origin INTEGER NOT NULL CHECK (origin IN (0, 1, 2, 3)),
                UNIQUE (output_id, origin)
            )"###) }) },
        Effect { name: r###"tpir_spend_origins"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_spend_origins"###, sql: Some(r###"CREATE TABLE tpir_spend_origins (
                spending_transaction_id INTEGER NOT NULL
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                prevout_txid BLOB NOT NULL,
                prevout_output_index INTEGER NOT NULL,
                origin INTEGER NOT NULL CHECK (origin IN (0, 1, 2, 3)),
                UNIQUE (spending_transaction_id, prevout_txid, prevout_output_index, origin)
            )"###) }) },
    ] },
    // transparent_policy_generation; source sha256 77a142f445e887fd4eb03bea2b7c17116b868b6b3ddd1f6c23adf2967657aeb6
    Migration { id: 0xb7c4e2a19d3f4e8ba6c51f0e8d7c6b5a, dependencies: &[0x8f290af0eb5a4f1e88d43550fc0ff911], effects: &[
        Effect { name: r###"ironwood_enhance_routing"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_enhance_routing"###, sql: Some(r###"CREATE TABLE "ironwood_enhance_routing" (
                transaction_id INTEGER PRIMARY KEY
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                route INTEGER NOT NULL CHECK (route IN (0, 1, 2)),
                history_expiry_height INTEGER
                    CHECK (history_expiry_height >= 0 AND history_expiry_height < 500000000)
            )"###) }) },
        Effect { name: r###"tx_retrieval_queue"###, object: Some(Object { kind: r###"table"###, table: r###"tx_retrieval_queue"###, sql: Some(r###"CREATE TABLE "tx_retrieval_queue" (
                txid BLOB NOT NULL,
                query_type INTEGER NOT NULL,
                dependent_transaction_id INTEGER
                    REFERENCES transactions(id_tx) ON DELETE CASCADE, policy_generation INTEGER NOT NULL DEFAULT 0,
                CONSTRAINT tx_retrieval_intent UNIQUE (txid, query_type)
            )"###) }) },
    ] },
    // transparent_recovery_schema; source sha256 eccb93498cef315a4e7d19df39c6cb9e0f93703a66a1b4a82aaf89cbaf2e6021
    Migration { id: 0x9302bbcf425a426b9074084d626e45bd, dependencies: &[0xb7c4e2a19d3f4e8ba6c51f0e8d7c6b5a], effects: &[
        Effect { name: r###"idx_tpir_coverage_script"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_coverage"###, sql: Some(r###"CREATE INDEX idx_tpir_coverage_script ON tpir_coverage (account_id, script)"###) }) },
        Effect { name: r###"idx_tpir_receive_events_account"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_receive_events"###, sql: Some(r###"CREATE INDEX idx_tpir_receive_events_account ON tpir_receive_events (account_id)"###) }) },
        Effect { name: r###"idx_tpir_spend_events_account"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_spend_events"###, sql: Some(r###"CREATE INDEX idx_tpir_spend_events_account ON tpir_spend_events (account_id)"###) }) },
        Effect { name: r###"idx_tpir_spend_events_prevout"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_spend_events"###, sql: Some(r###"CREATE INDEX idx_tpir_spend_events_prevout ON tpir_spend_events (prevout_txid, prevout_output_index)"###) }) },
        Effect { name: r###"sqlite_autoindex_tpir_candidate_windows_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_candidate_windows"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tpir_pending_page_scripts_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_pending_page_scripts"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tpir_pending_pages_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_pending_pages"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tpir_receive_events_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_receive_events"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tpir_receive_observations_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_receive_observations"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tpir_revisions_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_revisions"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tpir_revisions_2"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_revisions"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tpir_spend_events_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_spend_events"###, sql: None }) },
        Effect { name: r###"sqlite_autoindex_tpir_spend_observations_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_spend_observations"###, sql: None }) },
        Effect { name: r###"tpir_candidate_windows"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_candidate_windows"###, sql: Some(r###"CREATE TABLE tpir_candidate_windows (
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                key_scope INTEGER NOT NULL CHECK (key_scope IN (0, 1, 2)),
                end_index INTEGER NOT NULL CHECK (end_index >= 0 AND end_index <= 2147483648),
                PRIMARY KEY (account_id, key_scope)
            )"###) }) },
        Effect { name: r###"tpir_coverage"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_coverage"###, sql: Some(r###"CREATE TABLE tpir_coverage (
                id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                script BLOB NOT NULL,
                from_height INTEGER NOT NULL CHECK (from_height >= 0),
                through_height INTEGER NOT NULL,
                anchor_height INTEGER NOT NULL,
                anchor_hash BLOB NOT NULL,
                revision_id INTEGER NOT NULL REFERENCES tpir_revisions(id),
                supported INTEGER NOT NULL CHECK (supported IN (0, 1)),
                CHECK (from_height <= through_height AND through_height <= anchor_height)
            )"###) }) },
        Effect { name: r###"tpir_pending_page_scripts"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_pending_page_scripts"###, sql: Some(r###"CREATE TABLE tpir_pending_page_scripts (
                page_id INTEGER NOT NULL REFERENCES tpir_pending_pages(id) ON DELETE CASCADE,
                script BLOB NOT NULL,
                PRIMARY KEY (page_id, script)
            )"###) }) },
        Effect { name: r###"tpir_pending_pages"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_pending_pages"###, sql: Some(r###"CREATE TABLE tpir_pending_pages (
                id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                revision_id INTEGER NOT NULL REFERENCES tpir_revisions(id),
                page BLOB NOT NULL,
                from_height INTEGER NOT NULL CHECK (from_height >= 0),
                through_height INTEGER NOT NULL,
                target_height INTEGER NOT NULL,
                target_hash BLOB NOT NULL,
                UNIQUE (account_id, revision_id, page),
                CHECK (from_height <= through_height AND through_height <= target_height)
            )"###) }) },
        Effect { name: r###"tpir_receive_events"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_receive_events"###, sql: Some(r###"CREATE TABLE tpir_receive_events (
                id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                txid BLOB NOT NULL,
                output_index INTEGER NOT NULL CHECK (output_index >= 0),
                script BLOB NOT NULL,
                value_zat INTEGER NOT NULL CHECK (value_zat >= 0),
                coinbase INTEGER NOT NULL CHECK (coinbase IN (0, 1)),
                mined_height INTEGER CHECK (mined_height >= 0),
                UNIQUE (txid, output_index)
            )"###) }) },
        Effect { name: r###"tpir_receive_observations"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_receive_observations"###, sql: Some(r###"CREATE TABLE tpir_receive_observations (
                receive_id INTEGER NOT NULL REFERENCES tpir_receive_events(id) ON DELETE CASCADE,
                revision_id INTEGER NOT NULL REFERENCES tpir_revisions(id),
                PRIMARY KEY (receive_id, revision_id)
            )"###) }) },
        Effect { name: r###"tpir_revisions"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_revisions"###, sql: Some(r###"CREATE TABLE tpir_revisions (
                id INTEGER PRIMARY KEY,
                source BLOB NOT NULL,
                revision BLOB NOT NULL,
                lineage INTEGER NOT NULL CHECK (lineage >= 0),
                sealed INTEGER NOT NULL CHECK (sealed IN (0, 1)),
                publication_height INTEGER NOT NULL CHECK (publication_height >= 0),
                publication_hash BLOB NOT NULL,
                UNIQUE (source, revision),
                UNIQUE (source, lineage)
            )"###) }) },
        Effect { name: r###"tpir_spend_events"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_spend_events"###, sql: Some(r###"CREATE TABLE tpir_spend_events (
                id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                spending_txid BLOB NOT NULL,
                input_index INTEGER NOT NULL CHECK (input_index >= 0),
                prevout_txid BLOB NOT NULL,
                prevout_output_index INTEGER NOT NULL CHECK (prevout_output_index >= 0),
                prevout_script BLOB NOT NULL,
                mined_height INTEGER CHECK (mined_height >= 0),
                UNIQUE (spending_txid, input_index)
            )"###) }) },
        Effect { name: r###"tpir_spend_observations"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_spend_observations"###, sql: Some(r###"CREATE TABLE tpir_spend_observations (
                spend_id INTEGER NOT NULL REFERENCES tpir_spend_events(id) ON DELETE CASCADE,
                revision_id INTEGER NOT NULL REFERENCES tpir_revisions(id),
                PRIMARY KEY (spend_id, revision_id)
            )"###) }) },
    ] },
    // transparent_activation_schema; source sha256 6e5e877ce315b4a84ac30e1a5bc380894bab0aac00dd7743c3ca56a97508f551
    Migration { id: 0x88cad11149144382a78fd85bb3507c5c, dependencies: &[0x9302bbcf425a426b9074084d626e45bd], effects: &[
        Effect { name: r###"sqlite_autoindex_tpir_quarantined_sources_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_quarantined_sources"###, sql: None }) },
        Effect { name: r###"tpir_active_accounts"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_active_accounts"###, sql: Some(r###"CREATE TABLE tpir_active_accounts (
                account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE
            )"###) }) },
        Effect { name: r###"tpir_qualified_revisions"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_qualified_revisions"###, sql: Some(r###"CREATE TABLE tpir_qualified_revisions (
                revision_id INTEGER PRIMARY KEY REFERENCES tpir_revisions(id)
            )"###) }) },
        Effect { name: r###"tpir_quarantined_accounts"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_quarantined_accounts"###, sql: Some(r###"CREATE TABLE tpir_quarantined_accounts (
                account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE
            )"###) }) },
        Effect { name: r###"tpir_quarantined_sources"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_quarantined_sources"###, sql: Some(r###"CREATE TABLE tpir_quarantined_sources (
                source BLOB PRIMARY KEY
            )"###) }) },
    ] },
    // transparent_activity_metadata; source sha256 adcdbb6e92d0df1e9d3f5518076349ee6341e29961b932497d5081ceef4df15c
    Migration { id: 0x935cd43609fd4f4fa808260ee399cb21, dependencies: &[0x88cad11149144382a78fd85bb3507c5c], effects: &[
        Effect { name: r###"sqlite_autoindex_tpir_transaction_metadata_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_transaction_metadata"###, sql: None }) },
        Effect { name: r###"tpir_transaction_metadata"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_transaction_metadata"###, sql: Some(r###"CREATE TABLE tpir_transaction_metadata (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    txid BLOB NOT NULL CHECK (length(txid) = 32),
    revision_id INTEGER NOT NULL REFERENCES tpir_revisions(id) ON DELETE CASCADE,
    mined_height INTEGER NOT NULL CHECK (mined_height >= 0),
    fee_state INTEGER NOT NULL CHECK (fee_state IN (0, 1, 2)),
    fee_zat INTEGER CHECK (fee_zat >= 0 AND fee_zat <= 2100000000000000),
    input_count INTEGER NOT NULL CHECK (input_count >= 0 AND input_count <= 4294967295),
    shielded INTEGER NOT NULL CHECK (shielded IN (0, 1)),
    CHECK ((fee_state = 0 AND fee_zat IS NOT NULL) OR (fee_state != 0 AND fee_zat IS NULL)),
    CHECK (fee_state != 2 OR input_count = 0),
    PRIMARY KEY (account_id, txid, revision_id)
)"###) }) },
    ] },
    // transparent_shared_derivations; source sha256 ff43ee53c9c12cf515322568429e6e08d71ffdbef1938708194076ca57539ca4
    Migration { id: 0xa03b0d6a60854859ae77bce948345214, dependencies: &[0x935cd43609fd4f4fa808260ee399cb21], effects: &[
        Effect { name: r###"sqlite_autoindex_tpir_shared_derivations_1"###, object: Some(Object { kind: r###"index"###, table: r###"tpir_shared_derivations"###, sql: None }) },
        Effect { name: r###"tpir_shared_derivations"###, object: Some(Object { kind: r###"table"###, table: r###"tpir_shared_derivations"###, sql: Some(r###"CREATE TABLE tpir_shared_derivations (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key_scope INTEGER NOT NULL CHECK (key_scope IN (0, 1, 2)),
    child_index INTEGER NOT NULL CHECK (child_index >= 0 AND child_index < 2147483648),
    PRIMARY KEY (account_id, key_scope, child_index)
)"###) }) },
    ] },
    // v_transactions_sender_grouping; source sha256 8201e49be95a493fac738854c51f6e836f18c60c3a7be6d5231f06e22a604489
    Migration { id: 0x0eaf99b94db74d0bb0bd00a9a6bbd8cf, dependencies: &[0xa03b0d6a60854859ae77bce948345214], effects: &[
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
WITH
notes AS (
    -- Outputs received in this transaction
    SELECT ro.account_id              AS account_id,
           ro.transaction_id          AS transaction_id,
           ro.pool                    AS pool,
           id_within_pool_table,
           ro.value                   AS value,
           ro.value                   AS received_value,
           0                          AS spent_value,
           0                          AS spent_note_count,
           CASE
                WHEN ro.is_change THEN 1
                ELSE 0
           END AS change_note_count,
           CASE
                WHEN ro.is_change THEN 0
                ELSE 1
           END AS received_count,
           CASE
             WHEN (ro.memo IS NULL OR ro.memo = X'F6')
               THEN 0
             ELSE 1
           END AS memo_present,
           -- The wallet cannot receive transparent outputs in shielding transactions.
           CASE
             WHEN ro.pool = 0
               THEN 1
             ELSE 0
           END AS does_not_match_shielding
    FROM v_received_outputs ro
    UNION
    -- Outputs spent in this transaction
    SELECT ro.account_id              AS account_id,
           ros.transaction_id         AS transaction_id,
           ro.pool                    AS pool,
           id_within_pool_table,
           -ro.value                  AS value,
           0                          AS received_value,
           ro.value                   AS spent_value,
           1                          AS spent_note_count,
           0                          AS change_note_count,
           0                          AS received_count,
           0                          AS memo_present,
           -- The wallet cannot spend shielded outputs in shielding transactions.
           CASE
             WHEN ro.pool != 0
               THEN 1
             ELSE 0
           END AS does_not_match_shielding
    FROM v_received_outputs ro
    JOIN v_received_output_spends ros
         ON ros.pool = ro.pool
         AND ros.received_output_id = ro.id_within_pool_table
),
-- What each account spent and received in each pool, per transaction. A pool the account
-- received value in but spent nothing from is a pool that value crossed into from
-- elsewhere, which is what `pool_crossings` below is built on.
notes_by_pool AS (
    SELECT account_id, transaction_id, pool,
           SUM(spent_note_count)                   AS spent_note_count,
           SUM(received_count + change_note_count) AS received_note_count,
           SUM(received_value)                     AS received_value
    FROM notes
    GROUP BY account_id, transaction_id, pool
),
-- Obtain a count of the notes that the wallet created in each transaction,
-- not counting change notes.
sent_note_counts AS (
    SELECT sent_notes.from_account_id     AS account_id,
           sent_notes.transaction_id      AS transaction_id,
           COUNT(DISTINCT sent_notes.id)  AS sent_notes,
           SUM(
             CASE
               WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                 THEN 0
               ELSE 1
             END
           ) AS memo_count
    FROM sent_notes
    LEFT JOIN v_received_outputs ro ON sent_notes.id = ro.sent_note_id
    WHERE COALESCE(ro.is_change, 0) = 0
    -- Group by the sending account. A bare `account_id` here would resolve to the joined
    -- `ro.account_id`, splitting one sender's notes into a group per receiving account.
    GROUP BY sent_notes.from_account_id, sent_notes.transaction_id
),
-- Identifies the transactions that are wallet-internal transfers moving an account's own
-- funds between shielded pools, and reports the value that crossed. `crossing_value` is
-- non-NULL exactly for such a transaction, so it carries both the classification and the
-- amount; see the `pool_crossing_value` column below.
pool_crossings AS (
    SELECT notes_by_pool.account_id     AS account_id,
           notes_by_pool.transaction_id AS transaction_id,
           CASE WHEN (
                -- Every note spent and every output received by the wallet is shielded.
                SUM(CASE WHEN notes_by_pool.pool = 0 THEN notes_by_pool.spent_note_count + notes_by_pool.received_note_count ELSE 0 END) = 0
                -- The transaction spends at least one of the account's notes.
                AND SUM(notes_by_pool.spent_note_count) > 0
                -- At least one output was received in a pool the account spent nothing
                -- from, so value crossed between pools.
                AND SUM(CASE WHEN notes_by_pool.spent_note_count = 0 THEN notes_by_pool.received_note_count ELSE 0 END) > 0
                -- We do not know about any external outputs of the transaction.
                AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
           )
           -- The total value received in the pools the account did not spend from. The
           -- condition above guarantees at least one such output, so when this branch is
           -- taken the sum is never NULL.
           THEN SUM(CASE WHEN notes_by_pool.spent_note_count = 0 THEN notes_by_pool.received_value ELSE 0 END)
           END AS crossing_value
    FROM notes_by_pool
    LEFT JOIN sent_note_counts
         ON sent_note_counts.account_id = notes_by_pool.account_id
         AND sent_note_counts.transaction_id = notes_by_pool.transaction_id
    GROUP BY notes_by_pool.account_id, notes_by_pool.transaction_id
),
blocks_max_height AS (
    SELECT MAX(blocks.height) AS max_height FROM blocks
)
SELECT accounts.uuid                AS account_uuid,
       transactions.mined_height    AS mined_height,
       transactions.txid            AS txid,
       transactions.tx_index        AS tx_index,
       COALESCE(transactions.expiry_height, (SELECT history_expiry_height
        FROM ironwood_enhance_routing WHERE transaction_id = transactions.id_tx AND route = 0))
           AS expiry_height,
       transactions.raw             AS raw,
       SUM(notes.value)             AS account_balance_delta,
       SUM(notes.spent_value)       AS total_spent,
       SUM(notes.received_value)    AS total_received,
       transactions.fee             AS fee_paid,
       SUM(notes.change_note_count) > 0  AS has_change,
       MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
       SUM(notes.received_count)         AS received_note_count,
       SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
       blocks.time                       AS block_time,
       (
            transactions.mined_height IS NULL
            AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
       ) AS expired_unmined,
       SUM(notes.spent_note_count) AS spent_note_count,
       (
            -- All of the wallet-spent and wallet-received notes are consistent with a
            -- shielding transaction.
            SUM(notes.does_not_match_shielding) = 0
            -- The transaction contains at least one wallet-spent output.
            AND SUM(notes.spent_note_count) > 0
            -- The transaction contains at least one wallet-received note.
            AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
            -- We do not know about any external outputs of the transaction.
            AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
       ) AS is_shielding,
       -- The value that crossed pools, when this transaction is a wallet-internal transfer
       -- between shielded pools; NULL when it is not such a transfer. A transaction is one
       -- exactly when this column is non-NULL.
       pool_crossings.crossing_value AS pool_crossing_value,
       transactions.trust_status,
       transactions.zip318_kind
FROM notes
JOIN accounts ON accounts.id = notes.account_id
JOIN transactions ON transactions.id_tx = notes.transaction_id
LEFT JOIN blocks_max_height
LEFT JOIN blocks ON blocks.height = transactions.mined_height
LEFT JOIN sent_note_counts
     ON sent_note_counts.account_id = notes.account_id
     AND sent_note_counts.transaction_id = notes.transaction_id
LEFT JOIN pool_crossings
     ON pool_crossings.account_id = notes.account_id
     AND pool_crossings.transaction_id = notes.transaction_id
GROUP BY notes.account_id, notes.transaction_id"###) }) },
    ] },
    // unmined_status_obligations; source sha256 4b7437f399851f1963ec13a213880a9a77de311c703331b3f368b5da3b556227
    Migration { id: 0x31eeaa720c174e22b8023f8161d6accd, dependencies: &[0x0eaf99b94db74d0bb0bd00a9a6bbd8cf], effects: &[
    ] },
    // status_reconfirmation; source sha256 467f6fd68943f6316248637f116cc1b6039206272dc2ed7f6d6205b12f08c135
    Migration { id: 0x6ad71499aa45439d8b4b3f7cff9c0017, dependencies: &[0x31eeaa720c174e22b8023f8161d6accd], effects: &[
        Effect { name: r###"tx_retrieval_queue"###, object: Some(Object { kind: r###"table"###, table: r###"tx_retrieval_queue"###, sql: Some(r###"CREATE TABLE "tx_retrieval_queue" (
                txid BLOB NOT NULL,
                query_type INTEGER NOT NULL,
                dependent_transaction_id INTEGER
                    REFERENCES transactions(id_tx) ON DELETE CASCADE, policy_generation INTEGER NOT NULL DEFAULT 0, reconfirm_mined INTEGER NOT NULL DEFAULT 0,
                CONSTRAINT tx_retrieval_intent UNIQUE (txid, query_type)
            )"###) }) },
    ] },
    // transaction_reconfirmation_receipts; source sha256 863bd755cb953c2d9861defe75746d69d98905349863a1b4e3ba9a055fa450b2
    Migration { id: 0x96bc0e7251cf4cdbb11f85a460db37ab, dependencies: &[0x6ad71499aa45439d8b4b3f7cff9c0017], effects: &[
        Effect { name: r###"idx_tx_reconfirmation_receipts_height"###, object: Some(Object { kind: r###"index"###, table: r###"tx_reconfirmation_receipts"###, sql: Some(r###"CREATE INDEX idx_tx_reconfirmation_receipts_height ON tx_reconfirmation_receipts(mined_height)"###) }) },
        Effect { name: r###"tx_reconfirmation_receipts"###, object: Some(Object { kind: r###"table"###, table: r###"tx_reconfirmation_receipts"###, sql: Some(r###"CREATE TABLE tx_reconfirmation_receipts (
        transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id_tx) ON DELETE CASCADE,
        mined_height INTEGER NOT NULL CHECK (typeof(mined_height) = 'integer' AND mined_height BETWEEN 0 AND 4294967295),
        block_hash BLOB NOT NULL CHECK (typeof(block_hash) = 'blob' AND length(block_hash) = 32),
        tx_index INTEGER CHECK (tx_index IS NULL OR (typeof(tx_index) = 'integer' AND tx_index BETWEEN 0 AND 65535)),
        replacement_observed INTEGER NOT NULL DEFAULT 0 CHECK (replacement_observed IN (0, 1))
    )"###) }) },
    ] },
    // v_transactions_legacy_projection; source sha256 2b2d53ac08f857e4d7204910156617ae635a6256d47359a72d7524ce853aaf08
    Migration { id: 0xcbf88891ba834329a798c986649d77e8, dependencies: &[0x0eaf99b94db74d0bb0bd00a9a6bbd8cf], effects: &[
    ] },
    // ironwood_unsupported_memo_retry; source sha256 756ebc0b7fd99bee0f79052b4343da9a345144b92875e6edfdfc542d33797561
    Migration { id: 0x3d1c7a528e0b4f6d9a475be2c0f19e84, dependencies: &[0xcbf88891ba834329a798c986649d77e8, 0x96bc0e7251cf4cdbb11f85a460db37ab], effects: &[
    ] },
    // ironwood_transparent_output_shape; source sha256 2ed0dca5e891fb40bbb48959b425aecf95c5bd67c8bebd06c9f960265b32942c
    Migration { id: 0x8f4c321004e149eb9de2d713ee0a8426, dependencies: &[0x3d1c7a528e0b4f6d9a475be2c0f19e84], effects: &[
        Effect { name: r###"ironwood_enhance_routing"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_enhance_routing"###, sql: Some(r###"CREATE TABLE "ironwood_enhance_routing" (
                transaction_id INTEGER PRIMARY KEY
                    REFERENCES transactions(id_tx) ON DELETE CASCADE,
                route INTEGER NOT NULL CHECK (route IN (0, 1, 2)),
                history_expiry_height INTEGER
                    CHECK (history_expiry_height >= 0 AND history_expiry_height < 500000000)
            , has_transparent_outputs INTEGER
                 CHECK (has_transparent_outputs IN (0, 1)))"###) }) },
    ] },
    // one_time_pir; source sha256 b7035abd41344870ab457ee48bccd3769778f6ee35a395a6aa9b0286e8bcece5
    Migration { id: 0x2eed2da721764d729461c9ae27491b0a, dependencies: &[0xc5b63b3b81904d0fb2173921d7aac225, 0xcbf88891ba834329a798c986649d77e8, 0x856ecde7c67047c19345b80ba5b12c4f], effects: &[
        Effect { name: r###"idx_ironwood_one_time_keys_account_receiver"###, object: None },
        Effect { name: r###"ironwood_one_time_disputed_receipts"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_one_time_disputed_receipts"###, sql: Some(r###"CREATE TABLE ironwood_one_time_disputed_receipts (
                note_id INTEGER PRIMARY KEY REFERENCES ironwood_received_notes(id) ON DELETE CASCADE
             )"###) }) },
        Effect { name: r###"ironwood_one_time_keys"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_one_time_keys"###, sql: Some(r###"CREATE TABLE ironwood_one_time_keys (
                id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                purpose INTEGER NOT NULL CHECK (purpose BETWEEN 0 AND 255),
                key_index BLOB NOT NULL CHECK (typeof(key_index) = 'blob' AND length(key_index) = 8),
                receiver BLOB NOT NULL CHECK (typeof(receiver) = 'blob' AND length(receiver) = 43),
                funding_height INTEGER CHECK (funding_height BETWEEN 0 AND 4294967295),
                used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1)),
                prebirthday_height INTEGER CHECK (prebirthday_height BETWEEN 0 AND 4294967295),
                reserved_at INTEGER,
                released_at INTEGER,
                reservation_floor INTEGER,
                UNIQUE (account_id, purpose, key_index)
            )"###) }) },
        Effect { name: r###"ironwood_one_time_operation_receipts"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_one_time_operation_receipts"###, sql: Some(r###"CREATE TABLE ironwood_one_time_operation_receipts (
                operation_id INTEGER NOT NULL REFERENCES ironwood_one_time_operations(id) ON DELETE CASCADE,
                txid BLOB NOT NULL CHECK (length(txid) = 32),
                PRIMARY KEY (operation_id, txid)
             )"###) }) },
        Effect { name: r###"ironwood_one_time_recovery"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_one_time_recovery"###, sql: Some(r###"CREATE TABLE ironwood_one_time_recovery (
                account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
                enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
                generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
                history_revision BLOB NOT NULL DEFAULT X'0000000000000000'
                    CHECK (length(history_revision) = 8),
                filter_height INTEGER CHECK (filter_height BETWEEN 0 AND 4294967295),
                filter_hash BLOB CHECK (length(filter_hash) = 32),
                skipped_height INTEGER CHECK (skipped_height BETWEEN 0 AND 4294967295),
                restore_height INTEGER CHECK (restore_height BETWEEN 0 AND 4294967295),
                restore_next BLOB NOT NULL DEFAULT X'0000000000000000' CHECK (length(restore_next) = 8),
                restore_gap INTEGER NOT NULL DEFAULT 0 CHECK (restore_gap BETWEEN 0 AND 4),
                restore_done INTEGER NOT NULL DEFAULT 0 CHECK (restore_done IN (0, 1)),
                manual_active INTEGER NOT NULL DEFAULT 0 CHECK (manual_active IN (0, 1)),
                manual_purpose INTEGER NOT NULL DEFAULT 0 CHECK (manual_purpose IN (0, 1)),
                manual_next BLOB NOT NULL DEFAULT X'0000000000000000' CHECK (length(manual_next) = 8),
                manual_end BLOB CHECK (length(manual_end) = 8),
                manual_height INTEGER CHECK (manual_height BETWEEN 0 AND 4294967295), receive_end BLOB NOT NULL
                DEFAULT X'0000000000000000' CHECK (length(receive_end) = 8), upgrade_required INTEGER NOT NULL
                DEFAULT 0 CHECK (upgrade_required IN (0, 1)),
                CHECK ((filter_height IS NULL) = (filter_hash IS NULL))
            )"###) }) },
        Effect { name: r###"ironwood_one_time_unchecked_raw"###, object: Some(Object { kind: r###"table"###, table: r###"ironwood_one_time_unchecked_raw"###, sql: Some(r###"CREATE TABLE ironwood_one_time_unchecked_raw (
                transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id_tx) ON DELETE CASCADE
             )"###) }) },
        Effect { name: r###"sqlite_autoindex_ironwood_one_time_operation_receipts_1"###, object: Some(Object { kind: r###"index"###, table: r###"ironwood_one_time_operation_receipts"###, sql: None }) },
        Effect { name: r###"v_transactions"###, object: Some(Object { kind: r###"view"###, table: r###"v_transactions"###, sql: Some(r###"CREATE VIEW v_transactions AS
WITH
notes AS (
    -- Outputs received in this transaction
    SELECT ro.account_id              AS account_id,
           ro.transaction_id          AS transaction_id,
           ro.pool                    AS pool,
           id_within_pool_table,
           ro.value                   AS value,
           ro.value                   AS received_value,
           0                          AS spent_value,
           0                          AS spent_note_count,
           CASE
                WHEN ro.is_change THEN 1
                ELSE 0
           END AS change_note_count,
           CASE
                WHEN ro.is_change THEN 0
                ELSE 1
           END AS received_count,
           CASE
             WHEN (ro.memo IS NULL OR ro.memo = X'F6')
               THEN 0
             ELSE 1
           END AS memo_present,
           -- The wallet cannot receive transparent outputs in shielding transactions.
           CASE
             WHEN ro.pool = 0
               THEN 1
             ELSE 0
           END AS does_not_match_shielding
    -- A private receipt whose transaction label raw bytes disproved is not received in it.
    FROM (SELECT * FROM v_received_outputs
          WHERE NOT (pool = 4 AND id_within_pool_table IN
              (SELECT note_id FROM ironwood_one_time_disputed_receipts))) ro
    UNION
    -- Outputs spent in this transaction
    SELECT ro.account_id              AS account_id,
           ros.transaction_id         AS transaction_id,
           ro.pool                    AS pool,
           id_within_pool_table,
           -ro.value                  AS value,
           0                          AS received_value,
           ro.value                   AS spent_value,
           1                          AS spent_note_count,
           0                          AS change_note_count,
           0                          AS received_count,
           0                          AS memo_present,
           -- The wallet cannot spend shielded outputs in shielding transactions.
           CASE
             WHEN ro.pool != 0
               THEN 1
             ELSE 0
           END AS does_not_match_shielding
    FROM v_received_outputs ro
    JOIN v_received_output_spends ros
         ON ros.pool = ro.pool
         AND ros.received_output_id = ro.id_within_pool_table
),
-- What each account spent and received in each pool, per transaction. A pool the account
-- received value in but spent nothing from is a pool that value crossed into from
-- elsewhere, which is what `pool_crossings` below is built on.
notes_by_pool AS (
    SELECT account_id, transaction_id, pool,
           SUM(spent_note_count)                   AS spent_note_count,
           SUM(received_count + change_note_count) AS received_note_count,
           SUM(received_value)                     AS received_value
    FROM notes
    GROUP BY account_id, transaction_id, pool
),
-- Obtain a count of the notes that the wallet created in each transaction,
-- not counting change notes.
sent_note_counts AS (
    SELECT sent_notes.from_account_id     AS account_id,
           sent_notes.transaction_id      AS transaction_id,
           COUNT(DISTINCT sent_notes.id)  AS sent_notes,
           SUM(
             CASE
               WHEN (sent_notes.memo IS NULL OR sent_notes.memo = X'F6' OR ro.transaction_id IS NOT NULL)
                 THEN 0
               ELSE 1
             END
           ) AS memo_count
    FROM sent_notes
    LEFT JOIN v_received_outputs ro ON sent_notes.id = ro.sent_note_id
    WHERE COALESCE(ro.is_change, 0) = 0
    -- Group by the sending account. A bare `account_id` here would resolve to the joined
    -- `ro.account_id`, splitting one sender's notes into a group per receiving account.
    GROUP BY sent_notes.from_account_id, sent_notes.transaction_id
),
-- Identifies the transactions that are wallet-internal transfers moving an account's own
-- funds between shielded pools, and reports the value that crossed. `crossing_value` is
-- non-NULL exactly for such a transaction, so it carries both the classification and the
-- amount; see the `pool_crossing_value` column below.
pool_crossings AS (
    SELECT notes_by_pool.account_id     AS account_id,
           notes_by_pool.transaction_id AS transaction_id,
           CASE WHEN (
                -- Every note spent and every output received by the wallet is shielded.
                SUM(CASE WHEN notes_by_pool.pool = 0 THEN notes_by_pool.spent_note_count + notes_by_pool.received_note_count ELSE 0 END) = 0
                -- The transaction spends at least one of the account's notes.
                AND SUM(notes_by_pool.spent_note_count) > 0
                -- At least one output was received in a pool the account spent nothing
                -- from, so value crossed between pools.
                AND SUM(CASE WHEN notes_by_pool.spent_note_count = 0 THEN notes_by_pool.received_note_count ELSE 0 END) > 0
                -- We do not know about any external outputs of the transaction.
                AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
           )
           -- The total value received in the pools the account did not spend from. The
           -- condition above guarantees at least one such output, so when this branch is
           -- taken the sum is never NULL.
           THEN SUM(CASE WHEN notes_by_pool.spent_note_count = 0 THEN notes_by_pool.received_value ELSE 0 END)
           END AS crossing_value
    FROM notes_by_pool
    LEFT JOIN sent_note_counts
         ON sent_note_counts.account_id = notes_by_pool.account_id
         AND sent_note_counts.transaction_id = notes_by_pool.transaction_id
    GROUP BY notes_by_pool.account_id, notes_by_pool.transaction_id
),
blocks_max_height AS (
    SELECT MAX(blocks.height) AS max_height FROM blocks
)
SELECT accounts.uuid                AS account_uuid,
       transactions.mined_height    AS mined_height,
       transactions.txid            AS txid,
       transactions.tx_index        AS tx_index,
       COALESCE(transactions.expiry_height, (SELECT history_expiry_height
        FROM ironwood_enhance_routing WHERE transaction_id = transactions.id_tx AND route = 0))
           AS expiry_height,
       transactions.raw             AS raw,
       SUM(notes.value)             AS account_balance_delta,
       SUM(notes.spent_value)       AS total_spent,
       SUM(notes.received_value)    AS total_received,
       transactions.fee             AS fee_paid,
       SUM(notes.change_note_count) > 0  AS has_change,
       MAX(COALESCE(sent_note_counts.sent_notes, 0))  AS sent_note_count,
       SUM(notes.received_count)         AS received_note_count,
       SUM(notes.memo_present) + MAX(COALESCE(sent_note_counts.memo_count, 0)) AS memo_count,
       blocks.time                       AS block_time,
       (
            transactions.mined_height IS NULL
            AND transactions.expiry_height BETWEEN 1 AND blocks_max_height.max_height
       ) AS expired_unmined,
       SUM(notes.spent_note_count) AS spent_note_count,
       (
            -- All of the wallet-spent and wallet-received notes are consistent with a
            -- shielding transaction.
            SUM(notes.does_not_match_shielding) = 0
            -- The transaction contains at least one wallet-spent output.
            AND SUM(notes.spent_note_count) > 0
            -- The transaction contains at least one wallet-received note.
            AND (SUM(notes.received_count) + SUM(notes.change_note_count)) > 0
            -- We do not know about any external outputs of the transaction.
            AND MAX(COALESCE(sent_note_counts.sent_notes, 0)) = 0
       ) AS is_shielding,
       -- The value that crossed pools, when this transaction is a wallet-internal transfer
       -- between shielded pools; NULL when it is not such a transfer. A transaction is one
       -- exactly when this column is non-NULL.
       pool_crossings.crossing_value AS pool_crossing_value,
       transactions.trust_status,
       transactions.zip318_kind
FROM notes
JOIN accounts ON accounts.id = notes.account_id
JOIN transactions ON transactions.id_tx = notes.transaction_id
LEFT JOIN blocks_max_height
LEFT JOIN blocks ON blocks.height = transactions.mined_height
LEFT JOIN sent_note_counts
     ON sent_note_counts.account_id = notes.account_id
     AND sent_note_counts.transaction_id = notes.transaction_id
LEFT JOIN pool_crossings
     ON pool_crossings.account_id = notes.account_id
     AND pool_crossings.transaction_id = notes.transaction_id
GROUP BY notes.account_id, notes.transaction_id"###) }) },
        Effect { name: r###"v_tx_outputs"###, object: Some(Object { kind: r###"view"###, table: r###"v_tx_outputs"###, sql: Some(r###"CREATE VIEW v_tx_outputs AS
WITH unioned AS (
    -- select all outputs received by the wallet
    SELECT t.id_tx                      AS transaction_id,
           t.txid                       AS txid,
           t.mined_height               AS mined_height,
           IFNULL(t.trust_status, 0)    AS trust_status,
           ro.pool                      AS output_pool,
           ro.output_index              AS output_index,
           from_account.uuid            AS from_account_uuid,
           to_account.uuid              AS to_account_uuid,
           -- for a transparent output, the address at which it was received is
           -- the transparent receiver itself, not a unified address containing it
           CASE ro.pool
                WHEN 0 THEN a.cached_transparent_receiver_address
                ELSE a.address
           END                          AS to_address,
           0                            AS is_sent_row,
           a.diversifier_index_be       AS diversifier_index_be,
           ro.value                     AS value,
           ro.is_change                 AS is_change,
           ro.memo                      AS memo,
           a.key_scope                  AS recipient_key_scope
    -- A private receipt whose transaction label raw bytes disproved is not an output of it.
    FROM (SELECT * FROM v_received_outputs
          WHERE NOT (pool = 4 AND id_within_pool_table IN
              (SELECT note_id FROM ironwood_one_time_disputed_receipts))) ro
    JOIN transactions t
        ON t.id_tx = ro.transaction_id
    LEFT JOIN addresses a ON a.id = ro.address_id
    -- join to the sent_notes table to obtain `from_account_id`
    LEFT JOIN sent_notes ON sent_notes.id = ro.sent_note_id
    -- join on the accounts table to obtain account UUIDs
    LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
    LEFT JOIN accounts to_account ON to_account.id = ro.account_id
    UNION ALL
    -- select all outputs sent by the wallet
    SELECT t.id_tx                      AS transaction_id,
           t.txid                       AS txid,
           t.mined_height               AS mined_height,
           IFNULL(t.trust_status, 0)    AS trust_status,
           sent_notes.output_pool       AS output_pool,
           sent_notes.output_index      AS output_index,
           from_account.uuid            AS from_account_uuid,
           NULL                         AS to_account_uuid,
           sent_notes.to_address        AS to_address,
           1                            AS is_sent_row,
           NULL                         AS diversifier_index_be,
           sent_notes.value             AS value,
           0                            AS is_change,
           sent_notes.memo              AS memo,
           NULL                         AS recipient_key_scope
    FROM sent_notes
    JOIN transactions t
        ON t.id_tx = sent_notes.transaction_id
    LEFT JOIN v_received_outputs ro ON ro.sent_note_id = sent_notes.id
    -- join on the accounts table to obtain account UUIDs
    LEFT JOIN accounts from_account ON from_account.id = sent_notes.from_account_id
)
-- merge duplicate rows while retaining maximum information
SELECT
    transaction_id,
    MAX(txid)                   AS txid,
    MAX(mined_height)           AS tx_mined_height,
    MIN(trust_status)           AS tx_trust_status,
    output_pool,
    output_index,
    MAX(from_account_uuid)      AS from_account_uuid,
    MAX(to_account_uuid)        AS to_account_uuid,
    -- the recipient address recorded when the wallet created the output is
    -- authoritative; the receiving address is reported only for outputs the
    -- wallet did not create
    COALESCE(
        MAX(CASE WHEN is_sent_row THEN to_address END),
        MAX(CASE WHEN NOT is_sent_row THEN to_address END)
    )                           AS to_address,
    MAX(value)                  AS value,
    MAX(is_change)              AS is_change,
    MAX(memo)                   AS memo,
    MAX(recipient_key_scope)    AS recipient_key_scope
FROM unioned
GROUP BY transaction_id, output_pool, output_index"###) }) },
    ] },
    // transparent_txid_enhancement; source sha256 135c0895571727a9d76d35a6b54e42bc0f860e16bd0cfd63f367157498a0da47
    Migration { id: 0x73d751a3dbdc461a9154e061903aae4f, dependencies: &[0x8f4c321004e149eb9de2d713ee0a8426], effects: &[
        Effect { name: r###"sqlite_autoindex_transparent_tx_display_outputs_1"###, object: Some(Object { kind: r###"index"###, table: r###"transparent_tx_display_outputs"###, sql: None }) },
        Effect { name: r###"transparent_detail_work"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_detail_work"###, sql: Some(r###"CREATE TABLE transparent_detail_work (
                transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id_tx) ON DELETE CASCADE,
                reasons INTEGER NOT NULL CHECK (reasons > 0 AND reasons < 8),
                attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
                next_attempt_at INTEGER NOT NULL DEFAULT 0,
                attempted_at INTEGER,
                attempted_height INTEGER CHECK (attempted_height >= 0),
                last_outcome INTEGER CHECK (last_outcome BETWEEN 0 AND 6),
                last_map_sha256 BLOB CHECK (length(last_map_sha256) = 32)
            )"###) }) },
        Effect { name: r###"transparent_tx_display"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_tx_display"###, sql: Some(r###"CREATE TABLE transparent_tx_display (
                transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id_tx) ON DELETE CASCADE,
                coinbase INTEGER NOT NULL CHECK (coinbase IN (0, 1)),
                fee_zat INTEGER NOT NULL CHECK (fee_zat >= 0 AND fee_zat <= 2100000000000000),
                input_count INTEGER NOT NULL CHECK (input_count >= 0 AND input_count <= 4294967295),
                output_count INTEGER NOT NULL CHECK (output_count >= 0 AND output_count <= 4294967295),
                shielded INTEGER NOT NULL CHECK (shielded IN (0, 1)),
                sender_kind INTEGER NOT NULL CHECK (sender_kind IN (0, 1, 2, 3)),
                sender_hash BLOB CHECK (length(sender_hash) = 20),
                multiple_source_scripts INTEGER NOT NULL CHECK (multiple_source_scripts IN (0, 1)),
                shielded_and_transparent_funding INTEGER NOT NULL
                    CHECK (shielded_and_transparent_funding IN (0, 1)),
                shard_id INTEGER NOT NULL,
                revision INTEGER NOT NULL CHECK (revision >= 0),
                map_sha256 BLOB NOT NULL CHECK (length(map_sha256) = 32),
                looked_up_height INTEGER NOT NULL CHECK (looked_up_height >= 0),
                stored_at INTEGER NOT NULL,
                CHECK ((sender_kind IN (1, 2)) = (sender_hash IS NOT NULL)),
                CHECK ((sender_kind = 0) = (input_count = 0)),
                CHECK (coinbase = 0 OR (fee_zat = 0 AND input_count = 0)),
                CHECK (coinbase = 1 OR input_count > 0 OR shielded = 1),
                CHECK (multiple_source_scripts = 0 OR input_count >= 2),
                CHECK (shielded_and_transparent_funding = 0 OR (input_count > 0 AND shielded = 1))
            )"###) }) },
        Effect { name: r###"transparent_tx_display_outputs"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_tx_display_outputs"###, sql: Some(r###"CREATE TABLE transparent_tx_display_outputs (
                transaction_id INTEGER NOT NULL
                    REFERENCES transparent_tx_display(transaction_id) ON DELETE CASCADE,
                output_index INTEGER NOT NULL CHECK (output_index IN (0, 1)),
                value_zat INTEGER NOT NULL CHECK (value_zat >= 0 AND value_zat <= 2100000000000000),
                address_kind INTEGER NOT NULL CHECK (address_kind IN (1, 2, 3)),
                address_hash BLOB CHECK (length(address_hash) = 20),
                CHECK ((address_kind = 3) = (address_hash IS NULL)),
                PRIMARY KEY (transaction_id, output_index)
            )"###) }) },
    ] },
    // transparent_detail_content_failures; source sha256 120b30495f3894b9b02975368570c1ae75291d3f5d2ac72a8f46739ba7e7bbe0
    Migration { id: 0xe5339f96a98a4047827428efdb9107ce, dependencies: &[0x73d751a3dbdc461a9154e061903aae4f], effects: &[
        Effect { name: r###"transparent_detail_work"###, object: Some(Object { kind: r###"table"###, table: r###"transparent_detail_work"###, sql: Some(r###"CREATE TABLE transparent_detail_work (
                transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id_tx) ON DELETE CASCADE,
                reasons INTEGER NOT NULL CHECK (reasons > 0 AND reasons < 8),
                attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
                next_attempt_at INTEGER NOT NULL DEFAULT 0,
                attempted_at INTEGER,
                attempted_height INTEGER CHECK (attempted_height >= 0),
                last_outcome INTEGER CHECK (last_outcome BETWEEN 0 AND 6),
                last_map_sha256 BLOB CHECK (length(last_map_sha256) = 32)
            , content_failures INTEGER NOT NULL
                DEFAULT 0 CHECK (content_failures >= 0))"###) }) },
    ] },
];
