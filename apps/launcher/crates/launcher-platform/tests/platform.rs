use launcher_core::{LauncherIdentity, LauncherPathLayout, Namespace, ReleaseChannel};
use launcher_platform::{LauncherLock, ensure_launcher_layout};
use std::fs;
use std::path::PathBuf;

fn temp_root(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "open-design-launcher-test-{}-{}",
        name,
        std::process::id()
    ))
}

#[test]
fn lock_is_exclusive_until_dropped() {
    let root = temp_root("lock");
    let lock_path = root.join("state").join("lock");
    let lock = LauncherLock::acquire(&lock_path).unwrap();

    assert!(LauncherLock::acquire(&lock_path).is_err());
    drop(lock);
    assert!(LauncherLock::acquire(&lock_path).is_ok());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn ensure_layout_creates_launcher_directories() {
    let root = temp_root("layout");
    let identity = LauncherIdentity::new(ReleaseChannel::Preview, Namespace::new("preview-local").unwrap());
    let paths = LauncherPathLayout::from_data_root(&root, &identity);

    ensure_launcher_layout(&paths).unwrap();

    assert!(paths.state_root.is_dir());
    assert!(paths.versions_root.is_dir());
    assert!(paths.staging_root.is_dir());
    assert!(paths.launcher_observations_root.is_dir());

    let _ = fs::remove_dir_all(root);
}
