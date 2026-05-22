use launcher_core::{LauncherPathLayout, PayloadEntry};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LauncherPlatformError {
    #[error("required environment variable is missing: {0}")]
    MissingEnv(&'static str),
    #[error("launcher lock is already held: {0}")]
    LockAlreadyHeld(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct LauncherLock {
    path: PathBuf,
}

impl LauncherLock {
    pub fn acquire(path: impl AsRef<Path>) -> Result<Self, LauncherPlatformError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    LauncherPlatformError::LockAlreadyHeld(path.display().to_string())
                } else {
                    LauncherPlatformError::Io(error)
                }
            })?;
        writeln!(file, "pid={}", std::process::id())?;
        Ok(Self { path })
    }
}

impl Drop for LauncherLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub fn default_data_root() -> Result<PathBuf, LauncherPlatformError> {
    if cfg!(target_os = "windows") {
        env_path("APPDATA")
    } else if cfg!(target_os = "macos") {
        Ok(env_path("HOME")?.join("Library").join("Application Support"))
    } else if let Some(value) = env::var_os("XDG_DATA_HOME") {
        Ok(PathBuf::from(value))
    } else {
        Ok(env_path("HOME")?.join(".local").join("share"))
    }
}

pub fn ensure_launcher_layout(paths: &LauncherPathLayout) -> Result<(), LauncherPlatformError> {
    for directory in [
        &paths.downloads_root,
        &paths.installer_observations_root,
        &paths.launcher_observations_root,
        &paths.state_root,
        &paths.staging_root,
        &paths.update_logs_root,
        &paths.updater_observations_root,
        &paths.versions_root,
    ] {
        fs::create_dir_all(directory)?;
    }
    Ok(())
}

pub fn spawn_payload(entry: &PayloadEntry, payload_root: impl AsRef<Path>) -> Result<Child, LauncherPlatformError> {
    let payload_root = payload_root.as_ref();
    let executable = resolve_payload_path(payload_root, &entry.executable);
    let mut command = Command::new(executable);
    command.args(&entry.args);
    command.envs(&entry.env);
    command.current_dir(match &entry.cwd {
        Some(cwd) => resolve_payload_path(payload_root, cwd),
        None => payload_root.to_path_buf(),
    });
    Ok(command.spawn()?)
}

pub fn write_observation(path: impl AsRef<Path>, payload: &str) -> Result<(), LauncherPlatformError> {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = File::create(path)?;
    file.write_all(payload.as_bytes())?;
    file.write_all(b"\n")?;
    Ok(())
}

fn env_path(name: &'static str) -> Result<PathBuf, LauncherPlatformError> {
    env::var_os(name)
        .map(PathBuf::from)
        .ok_or(LauncherPlatformError::MissingEnv(name))
}

fn resolve_payload_path(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}
