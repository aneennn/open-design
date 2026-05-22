use std::env;
use std::path::PathBuf;

fn default_windows_icon_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tools")
        .join("pack")
        .join("resources")
        .join("win")
        .join("icon.ico")
}

#[cfg(windows)]
fn main() {
    println!("cargo:rerun-if-env-changed=OD_LAUNCHER_WIN_ICON");

    let icon_path = env::var_os("OD_LAUNCHER_WIN_ICON")
        .map(PathBuf::from)
        .unwrap_or_else(default_windows_icon_path);
    println!("cargo:rerun-if-changed={}", icon_path.display());

    if !icon_path.is_file() {
        panic!(
            "Windows launcher icon does not exist: {}. Set OD_LAUNCHER_WIN_ICON to an .ico file.",
            icon_path.display()
        );
    }

    let icon = icon_path
        .to_str()
        .expect("Windows launcher icon path must be valid UTF-8");
    let mut resource = winresource::WindowsResource::new();
    resource.set_icon(icon);
    resource.set("FileDescription", "Open Design Launcher");
    resource.set("ProductName", "Open Design");
    resource.set("OriginalFilename", "Open Design.exe");
    resource
        .compile()
        .expect("failed to compile Windows launcher resources");
}

#[cfg(not(windows))]
fn main() {
    println!("cargo:rerun-if-env-changed=OD_LAUNCHER_WIN_ICON");
    let icon_path = env::var_os("OD_LAUNCHER_WIN_ICON")
        .map(PathBuf::from)
        .unwrap_or_else(default_windows_icon_path);
    println!("cargo:rerun-if-changed={}", icon_path.display());
}
