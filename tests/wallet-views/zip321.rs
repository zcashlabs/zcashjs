//! Exercise the shared codec re-export used by wallet proposals and URI admission.
#![allow(deprecated)]

use zcash_address::{ToAddress, ZcashAddress};
use zcash_client_backend::zip321::TransactionRequest;
use zcash_protocol::consensus::NetworkType;

fn address() -> String {
    ZcashAddress::from_transparent_p2pkh(NetworkType::Regtest, [7; 20]).encode()
}

#[test]
fn optional_flags_match_empty_values_and_roundtrip() {
    let address = address();
    for index in ["", ".3", ".9999"] {
        let prefix = format!("zcash:?address{index}={address}&amount{index}=0.0001");
        let bare = TransactionRequest::from_uri(&format!("{prefix}&merchantflag{index}")).unwrap();
        let empty =
            TransactionRequest::from_uri(&format!("{prefix}&merchantflag{index}=")).unwrap();
        assert_eq!(
            bare, empty,
            "same canonical proposal intent for index {index}"
        );
        assert_eq!(bare.to_uri(), empty.to_uri());
        assert_eq!(TransactionRequest::from_uri(&bare.to_uri()).unwrap(), bare);
    }
}

#[test]
fn optional_flags_preserve_case_and_neighboring_values() {
    let address = address();
    let bare = TransactionRequest::from_uri(&format!(
        "zcash:{address}?merchantflag&amount=0.0001&MerchantFlag&label=Keep%20CASE&message=A%26B"
    ))
    .unwrap();
    let empty = TransactionRequest::from_uri(&format!(
        "zcash:{address}?merchantflag=&amount=0.0001&MerchantFlag=&label=Keep%20CASE&message=A%26B"
    ))
    .unwrap();
    assert_eq!(bare, empty);
    let payment = &bare.payments()[&0];
    assert_eq!(payment.label().map(String::as_str), Some("Keep CASE"));
    assert_eq!(payment.message().map(String::as_str), Some("A&B"));
    assert_eq!(
        payment.other_params(),
        &[
            ("merchantflag".to_owned(), String::new()),
            ("MerchantFlag".to_owned(), String::new()),
        ]
    );
}

#[test]
fn optional_flags_do_not_relax_required_or_payment_validation() {
    let address = address();
    for query in [
        "amount=1&req-unknown",
        "amount=1&REQ-unknown",
        "amount=1&req-unknown=",
        "amount=1&req-asset",
        "amount=1&req-asset=AA",
        "amount",
        "amount=1&address",
        "amount=1&memo",
        "amount=1&label",
        "amount=1&message",
        "amount=1&AMOUNT",
        "amount=1&LABEL",
        "amount=1&merchantflag&merchantflag=",
        "amount=1&amount=2&merchantflag",
        "amount=-1&merchantflag",
        "amount=0.000000001&merchantflag",
        "amount=21000000.00000001&merchantflag",
        "amount=1&memo=AA&merchantflag",
        "amount=1&merchantflag.0",
        "amount=1&merchantflag.01",
        "amount=1&merchantflag.10000",
        "amount=1&merchantflag#fragment",
    ] {
        assert!(
            TransactionRequest::from_uri(&format!("zcash:{address}?{query}")).is_err(),
            "{query}"
        );
    }
}
