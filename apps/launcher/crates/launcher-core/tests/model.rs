use launcher_core::{
    LauncherIdentity, LauncherPathLayout, LauncherStateSnapshot, Namespace, PayloadEntry,
    PayloadManifest, ReleaseChannel, StatePointer, plan_pending_promotion,
};
use std::path::PathBuf;

#[test]
fn namespace_matches_sidecar_namespace_rules() {
    assert_eq!(Namespace::new("release-beta-win").unwrap().as_str(), "release-beta-win");
    assert!(Namespace::new("").is_err());
    assert!(Namespace::new(" beta").is_err());
    assert!(Namespace::new("beta/local").is_err());
    assert!(Namespace::new("-beta").is_err());
}

#[test]
fn path_layout_is_channel_then_namespace_scoped() {
    let identity = LauncherIdentity::new(ReleaseChannel::Beta, Namespace::new("release-beta-win").unwrap());
    let paths = LauncherPathLayout::from_data_root(PathBuf::from("C:/Users/example/AppData/Roaming"), &identity);

    assert!(paths.channel_root.ends_with(PathBuf::from("Open Design/beta")));
    assert!(paths.namespace_root.ends_with(PathBuf::from(
        "Open Design/beta/namespaces/release-beta-win"
    )));
    assert!(paths.current_state_path.ends_with(PathBuf::from(
        "Open Design/beta/namespaces/release-beta-win/state/current.json"
    )));
    assert!(paths.installation_path.ends_with(PathBuf::from("Open Design/beta/installation.json")));
}

#[test]
fn pending_plan_promotes_pending_and_keeps_current_as_previous() {
    let current = StatePointer::new(
        "0.8.0-beta.6",
        "versions/0.8.0-beta.6/payload",
        "versions/0.8.0-beta.6/manifest.json",
        "2026-05-22T00:00:00Z",
    )
    .unwrap();
    let pending = StatePointer::new(
        "0.8.0-beta.7",
        "versions/0.8.0-beta.7/payload",
        "versions/0.8.0-beta.7/manifest.json",
        "2026-05-22T00:01:00Z",
    )
    .unwrap();
    let plan = plan_pending_promotion(&LauncherStateSnapshot {
        current: Some(current.clone()),
        pending: Some(pending.clone()),
        previous: None,
    });

    assert!(plan.promote);
    assert!(plan.remove_pending);
    assert_eq!(plan.current, Some(pending));
    assert_eq!(plan.previous, Some(current));
}

#[test]
fn payload_manifest_is_target_agnostic_but_platform_bound() {
    let manifest = PayloadManifest::new(
        "0.8.0-beta.7",
        "win32",
        "x64",
        PayloadEntry::new("payload/Open Design.exe").unwrap(),
    )
    .unwrap();

    assert!(manifest.is_compatible_with("win32", "x64"));
    assert!(!manifest.is_compatible_with("darwin", "arm64"));
}
