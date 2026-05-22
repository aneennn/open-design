use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use thiserror::Error;

pub const PRODUCT_DATA_DIR_NAME: &str = "Open Design";
pub const LAUNCHER_STATE_SCHEMA_VERSION: u32 = 1;
pub const PAYLOAD_MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LauncherCoreError {
    #[error("unsupported release channel: {0}")]
    UnsupportedChannel(String),
    #[error("namespace must not be empty")]
    EmptyNamespace,
    #[error("namespace must not contain leading or trailing whitespace: {0}")]
    NamespaceWhitespace(String),
    #[error("namespace contains unsupported characters: {0}")]
    NamespaceCharacters(String),
    #[error("namespace must not contain path separators: {0}")]
    NamespacePathSeparator(String),
    #[error("{field} must not be empty")]
    EmptyField { field: &'static str },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReleaseChannel {
    Beta,
    Nightly,
    Preview,
    Stable,
}

impl ReleaseChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Beta => "beta",
            Self::Nightly => "nightly",
            Self::Preview => "preview",
            Self::Stable => "stable",
        }
    }
}

impl fmt::Display for ReleaseChannel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for ReleaseChannel {
    type Err = LauncherCoreError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "beta" => Ok(Self::Beta),
            "nightly" => Ok(Self::Nightly),
            "preview" => Ok(Self::Preview),
            "stable" => Ok(Self::Stable),
            _ => Err(LauncherCoreError::UnsupportedChannel(value.to_owned())),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Namespace(String);

impl Namespace {
    pub fn new(value: impl Into<String>) -> Result<Self, LauncherCoreError> {
        let value = value.into();
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(LauncherCoreError::EmptyNamespace);
        }
        if trimmed != value {
            return Err(LauncherCoreError::NamespaceWhitespace(value));
        }
        if value.contains(['/', '\\']) {
            return Err(LauncherCoreError::NamespacePathSeparator(value));
        }
        let mut chars = value.chars();
        let Some(first) = chars.next() else {
            return Err(LauncherCoreError::EmptyNamespace);
        };
        if !first.is_ascii_alphanumeric()
            || value.len() > 128
            || !chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        {
            return Err(LauncherCoreError::NamespaceCharacters(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Namespace {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for Namespace {
    type Err = LauncherCoreError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherIdentity {
    pub channel: ReleaseChannel,
    pub namespace: Namespace,
}

impl LauncherIdentity {
    pub fn new(channel: ReleaseChannel, namespace: Namespace) -> Self {
        Self { channel, namespace }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherPathLayout {
    pub channel_root: PathBuf,
    pub current_state_path: PathBuf,
    pub downloads_root: PathBuf,
    pub installation_path: PathBuf,
    pub installer_observations_root: PathBuf,
    pub launcher_observations_root: PathBuf,
    pub namespace_root: PathBuf,
    pub pending_state_path: PathBuf,
    pub previous_state_path: PathBuf,
    pub product_root: PathBuf,
    pub state_lock_path: PathBuf,
    pub state_root: PathBuf,
    pub staging_root: PathBuf,
    pub update_logs_root: PathBuf,
    pub updates_root: PathBuf,
    pub updater_observations_root: PathBuf,
    pub versions_root: PathBuf,
}

impl LauncherPathLayout {
    pub fn from_data_root(data_root: impl AsRef<Path>, identity: &LauncherIdentity) -> Self {
        let product_root = data_root.as_ref().join(PRODUCT_DATA_DIR_NAME);
        let channel_root = product_root.join(identity.channel.as_str());
        let namespace_root = channel_root
            .join("namespaces")
            .join(identity.namespace.as_str());
        let state_root = namespace_root.join("state");
        let versions_root = namespace_root.join("versions");
        let updates_root = namespace_root.join("updates");
        let observations_root = namespace_root.join("observations");

        Self {
            channel_root: channel_root.clone(),
            current_state_path: state_root.join("current.json"),
            downloads_root: updates_root.join("downloads"),
            installation_path: channel_root.join("installation.json"),
            installer_observations_root: observations_root.join("installer"),
            launcher_observations_root: observations_root.join("launcher"),
            namespace_root,
            pending_state_path: state_root.join("pending.json"),
            previous_state_path: state_root.join("previous.json"),
            product_root,
            state_lock_path: state_root.join("lock"),
            state_root,
            staging_root: updates_root.join("staging"),
            update_logs_root: updates_root.join("logs"),
            updates_root,
            updater_observations_root: observations_root.join("updater"),
            versions_root,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadManifest {
    pub arch: String,
    pub entry: PayloadEntry,
    pub integrity: Option<PayloadIntegrity>,
    pub platform: String,
    pub schema_version: u32,
    pub version: String,
}

impl PayloadManifest {
    pub fn new(
        version: impl Into<String>,
        platform: impl Into<String>,
        arch: impl Into<String>,
        entry: PayloadEntry,
    ) -> Result<Self, LauncherCoreError> {
        let version = require_non_empty(version.into(), "version")?;
        let platform = require_non_empty(platform.into(), "platform")?;
        let arch = require_non_empty(arch.into(), "arch")?;
        Ok(Self {
            arch,
            entry,
            integrity: None,
            platform,
            schema_version: PAYLOAD_MANIFEST_SCHEMA_VERSION,
            version,
        })
    }

    pub fn is_compatible_with(&self, platform: &str, arch: &str) -> bool {
        self.platform == platform && self.arch == arch
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadEntry {
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: BTreeMap<String, String>,
    pub executable: String,
}

impl PayloadEntry {
    pub fn new(executable: impl Into<String>) -> Result<Self, LauncherCoreError> {
        Ok(Self {
            args: Vec::new(),
            cwd: None,
            env: BTreeMap::new(),
            executable: require_non_empty(executable.into(), "executable")?,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadIntegrity {
    pub algorithm: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePointer {
    pub manifest_path: String,
    pub payload_root: String,
    pub schema_version: u32,
    pub updated_at: String,
    pub version: String,
}

impl StatePointer {
    pub fn new(
        version: impl Into<String>,
        payload_root: impl Into<String>,
        manifest_path: impl Into<String>,
        updated_at: impl Into<String>,
    ) -> Result<Self, LauncherCoreError> {
        Ok(Self {
            manifest_path: require_non_empty(manifest_path.into(), "manifestPath")?,
            payload_root: require_non_empty(payload_root.into(), "payloadRoot")?,
            schema_version: LAUNCHER_STATE_SCHEMA_VERSION,
            updated_at: require_non_empty(updated_at.into(), "updatedAt")?,
            version: require_non_empty(version.into(), "version")?,
        })
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherStateSnapshot {
    pub current: Option<StatePointer>,
    pub pending: Option<StatePointer>,
    pub previous: Option<StatePointer>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromotionPlan {
    pub current: Option<StatePointer>,
    pub previous: Option<StatePointer>,
    pub promote: bool,
    pub remove_pending: bool,
}

pub fn plan_pending_promotion(snapshot: &LauncherStateSnapshot) -> PendingPromotionPlan {
    let Some(pending) = snapshot.pending.clone() else {
        return PendingPromotionPlan {
            current: snapshot.current.clone(),
            previous: snapshot.previous.clone(),
            promote: false,
            remove_pending: false,
        };
    };

    PendingPromotionPlan {
        current: Some(pending),
        previous: snapshot.current.clone().or_else(|| snapshot.previous.clone()),
        promote: true,
        remove_pending: true,
    }
}

fn require_non_empty(value: String, field: &'static str) -> Result<String, LauncherCoreError> {
    if value.trim().is_empty() {
        return Err(LauncherCoreError::EmptyField { field });
    }
    Ok(value)
}
