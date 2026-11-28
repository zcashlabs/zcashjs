use super::*;
fn lifecycle(g:u32,op:&str,input:Value)->std::result::Result<Value,String>{crate::wallet::account_lifecycle::account_lifecycle_call(g,op,&input.to_string()).map(|s|serde_json::from_str(&s).unwrap())}
#[test]
fn lifecycle_correspondence_remove_reopen() {
    let (path,g)=open();let input=fixture(3);
    let account=call(g,"account_import",input.clone()).unwrap();let id=&account["id"];
    let before=call(g,"account_get",json!({"accountId":id})).unwrap();
    assert_eq!(lifecycle(g,"account_viewing_key",json!({"accountId":id})).unwrap(),input["viewingKey"]);
    assert_eq!(call(g,"account_get",json!({"accountId":id})).unwrap(),before);
    assert_eq!(lifecycle(g,"account_check_key",json!({"accountId":id,"viewingKey":input["viewingKey"]})).unwrap(),"ready");
    assert_eq!(lifecycle(g,"account_check_key",json!({"accountId":id,"viewingKey":fixture(4)["viewingKey"]})).unwrap_err(),"SIGNER_MISMATCH");
    assert_eq!(lifecycle(g,"account_remove",json!({"accountId":id,"acknowledge":"wrong"})).unwrap_err(),"INVALID_ARGUMENT");
    assert!(call(g,"account_get",json!({"accountId":id})).unwrap().is_object());
    lifecycle(g,"account_remove",json!({"accountId":id,"acknowledge":"deletes-local-history"})).unwrap();
    assert!(call(g,"account_get",json!({"accountId":id})).unwrap().is_null());
    crate::wallet::storage_close(g).unwrap();
    let reopened=crate::wallet::initialize_path(&path,"zcash-js-network/1",PARAMS,&[3;32]).unwrap();
    assert_eq!(call(reopened,"account_list",json!({})).unwrap(),json!([]));
    crate::wallet::storage_close(reopened).unwrap();
}
